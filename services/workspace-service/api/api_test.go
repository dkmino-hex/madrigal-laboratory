package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/internal/testdatabase"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/api"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/projects"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/storage"
)

func TestProjectsHTTPPersistenceAndIdempotency(t *testing.T) {
	ctx := context.Background()
	dsn := testdatabase.New(t)
	db, err := storage.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.Close() }()
	server := httptest.NewServer(api.New(db))
	defer server.Close()
	request := func(method, path, key, body string) (int, []byte) {
		t.Helper()
		req, err := http.NewRequest(method, server.URL+path, bytes.NewBufferString(body))
		if err != nil {
			t.Fatal(err)
		}
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		if res.Header.Get("X-Request-ID") == "" {
			t.Error("missing request ID")
		}
		return res.StatusCode, data
	}
	var wg sync.WaitGroup
	ids := make(chan string, 12)
	for range 12 {
		wg.Go(func() {
			status, data := request("POST", "/api/v1/projects", "same-key", `{"name":"Thermostand","settings":{"endian":"big"}}`)
			if status != 201 {
				t.Errorf("create: %d %s", status, data)
				return
			}
			var p projects.Project
			if err := json.Unmarshal(data, &p); err != nil {
				t.Error(err)
				return
			}
			ids <- p.ID
		})
	}
	wg.Wait()
	close(ids)
	var id string
	for got := range ids {
		if id != "" && got != id {
			t.Errorf("duplicate project: %s %s", id, got)
		}
		id = got
	}
	var count int
	if err = db.QueryRow("SELECT count(*) FROM projects").Scan(&count); err != nil || count != 1 {
		t.Fatalf("projects=%d err=%v", count, err)
	}
	for _, tt := range []struct {
		body, key string
		status    int
	}{
		{`{"name":"Other"}`, "same-key", 409},
		{`{"name":"Valid"}`, "", 400},
		{`{"name":"   "}`, "empty", 400},
		{`{"name":"Valid","extra":true}`, "extra", 400},
		{`{"name":"Valid"} {}`, "trailing", 400},
		{`null`, "null", 400},
	} {
		status, data := request("POST", "/api/v1/projects", tt.key, tt.body)
		if status != tt.status {
			t.Errorf("%s: %d %s", tt.key, status, data)
		}
	}
	status, _ := request("GET", "/api/v1/projects/missing", "", "")
	if status != 404 {
		t.Fatalf("missing status=%d", status)
	}
	for i := range 4 {
		status, data := request("POST", "/api/v1/projects", fmt.Sprint("p", i), fmt.Sprintf(`{"name":"Project %d"}`, i))
		if status != 201 {
			t.Fatalf("%d %s", status, data)
		}
	}
	if _, err = db.Exec("INSERT INTO projects(id,name,status) VALUES('importing','Incoming','IMPORTING'),('broken','Broken','ERROR')"); err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{}
	token := ""
	for range 5 {
		status, data := request("GET", "/api/v1/projects?limit=2&cursor="+token, "", "")
		if status != 200 {
			t.Fatalf("list: %d %s", status, data)
		}
		var page projects.Page
		if err = json.Unmarshal(data, &page); err != nil {
			t.Fatal(err)
		}
		for _, p := range page.Items {
			if _, ok := seen[p.ID]; ok {
				t.Fatal("duplicate page item")
			}
			seen[p.ID] = p.Status
		}
		token = page.NextCursor
		if token == "" {
			break
		}
	}
	if len(seen) != 7 || seen["importing"] != "IMPORTING" || seen["broken"] != "ERROR" {
		t.Fatalf("list: %#v", seen)
	}
	for _, path := range []string{"/api/v1/projects?limit=0", "/api/v1/projects?cursor=garbage"} {
		status, _ = request("GET", path, "", "")
		if status != 400 {
			t.Fatalf("bad cursor/limit: %d", status)
		}
	}
	server.Close()
	db.Close()
	db, err = storage.Open(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	p, err := (projects.Store{DB: db}).Get(ctx, id)
	if err != nil || p.SettingsVersion == nil || p.Name != "Thermostand" {
		t.Fatalf("restart: %+v %v", p, err)
	}
}
