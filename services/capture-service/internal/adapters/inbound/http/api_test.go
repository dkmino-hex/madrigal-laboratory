package api_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/platform/testdatabase"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/inbound/http"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/pcap"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/adapters/outbound/sqlite"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/application/captures"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain/reassembly"
)

func TestCaptureReadCancellationAndLimit(t *testing.T) {
	fixture := filepath.Join("..", "..", "..", "..", "..", "..", "testdata", "sample_protocol", "research", "01_configuration.pcap")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := pcap.ReadCaptureContext(ctx, fixture, 250000); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	if _, _, err := pcap.ReadCaptureContext(context.Background(), fixture, 1); err == nil || !strings.Contains(err.Error(), "packet limit") {
		t.Fatalf("packet limit: %v", err)
	}
	content, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	broken := filepath.Join(t.TempDir(), "broken.pcap")
	if err = os.WriteFile(broken, content[:30], 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err = pcap.ReadCaptureContext(context.Background(), broken, 250000); err == nil {
		t.Fatal("truncated capture was accepted")
	}
	packets := make([]reassembly.Packet, 0, 4097)
	packets = append(packets, reassembly.Packet{Number: 1, SourceIP: "10.0.0.1", DestinationIP: "10.0.0.2", SourcePort: 1234, DestinationPort: 5678, Sequence: 100000, Flags: 2})
	for i := 0; i < 4096; i++ {
		packets = append(packets, reassembly.Packet{Number: i + 2, SourceIP: "10.0.0.1", DestinationIP: "10.0.0.2", SourcePort: 1234, DestinationPort: 5678, Sequence: uint32(100001 + i), Frame: []byte{byte(i)}, PayloadLength: 1})
	}
	sessions := reassembly.BuildSessions("long-capture", "long-assembly", packets)
	if len(sessions) != 1 || sessions[0].Streams[0].Length != 4096 || !sessions[0].Streams[0].KnownStart {
		t.Fatalf("long stream: %+v", sessions)
	}
}

func BenchmarkReassemblyCorpus(b *testing.B) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "..", "..", "..", "..", "testdata", "sample_protocol", "*", "*.pcap*"))
	if err != nil || len(paths) != 12 {
		b.Fatalf("fixtures: %d %v", len(paths), err)
	}
	b.ReportAllocs()
	for n := 0; n < b.N; n++ {
		for _, path := range paths {
			_, packets, e := pcap.ReadCaptureContext(context.Background(), path, 250000)
			if e != nil {
				b.Fatal(e)
			}
			_ = reassembly.BuildSessions("capture", "assembly", packets)
		}
	}
}

func TestJobStatusAndCancelHTTP(t *testing.T) {
	ctx := context.Background()
	db, err := storage.Open(ctx, testdatabase.New(t))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := captures.Store{Repository: storage.Store{DB: db}}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	j, err := store.Jobs().EnqueueTx(ctx, tx, "p1", captures.ImportKind, nil, map[string]any{})
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	handler := api.New(store)
	for _, tt := range []struct {
		method, path, status string
		code                 int
	}{
		{http.MethodGet, "/api/v1/jobs/" + j.ID, "QUEUED", 200},
		{http.MethodPost, "/api/v1/jobs/" + j.ID + "/cancel", "CANCELLED", 200},
		{http.MethodPost, "/api/v1/jobs/" + j.ID + "/cancel", "CANCELLED", 200},
		{http.MethodGet, "/api/v1/jobs/" + j.ID, "CANCELLED", 200},
		{http.MethodGet, "/api/v1/jobs/cap_missing", "", 404},
		{http.MethodGet, "/api/v1/jobs/ws_missing", "", 404},
	} {
		request := httptest.NewRequest(tt.method, tt.path, nil)
		request.Header.Set("X-Request-ID", "defense-request")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != tt.code || response.Header().Get("X-Request-ID") != "defense-request" {
			t.Fatalf("HTTP response: %d %s", response.Code, response.Body.String())
		}
		if tt.code == 200 {
			var got jobs.Job
			if err = json.Unmarshal(response.Body.Bytes(), &got); err != nil || got.Status != tt.status {
				t.Fatalf("job: %+v %v", got, err)
			}
			if !strings.Contains(response.Body.String(), `"completed":"0"`) {
				t.Fatal("counter is not a decimal string")
			}
		}
	}
}
