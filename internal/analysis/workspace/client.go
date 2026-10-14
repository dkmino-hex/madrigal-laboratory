package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Context struct {
	ProjectID       string          `json:"projectId"`
	Status          string          `json:"status"`
	SettingsVersion string          `json:"settingsVersion"`
	Version         int             `json:"version"`
	Settings        json.RawMessage `json:"settings"`
}
type Client struct {
	Base string
	HTTP *http.Client
}

func New(base string) *Client {
	return &Client{Base: strings.TrimRight(base, "/"), HTTP: &http.Client{Timeout: 15 * time.Second}}
}
func (c *Client) Get(ctx context.Context, project, version string) (Context, error) {
	var result Context
	path := "/internal/v1/projects/" + url.PathEscape(project) + "/context?settingsVersion=" + url.QueryEscape(version)
	req, e := http.NewRequestWithContext(ctx, "GET", c.Base+path, nil)
	if e != nil {
		return result, e
	}
	resp, e := c.HTTP.Do(req)
	if e != nil {
		return result, e
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return result, fmt.Errorf("workspace context: %s", resp.Status)
	}
	e = json.NewDecoder(resp.Body).Decode(&result)
	return result, e
}
