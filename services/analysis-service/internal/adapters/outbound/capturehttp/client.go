package capture

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
)

// Client accesses Capture's internal, non-public assembly-view API.
type Client struct {
	Base string
	HTTP *http.Client
}

func New(base string) *Client {
	return &Client{Base: strings.TrimRight(base, "/"), HTTP: &http.Client{Timeout: 25 * time.Second}}
}

type viewCreated struct {
	ViewID  string `json:"viewId"`
	DataURL string `json:"dataUrl"`
}
type viewData struct {
	Blocks     []domain.Block `json:"blocks"`
	NextCursor string         `json:"nextCursor"`
}
type Session struct {
	SessionID string          `json:"sessionId"`
	Streams   []domain.Stream `json:"streams"`
}

func (c *Client) request(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		b, e := json.Marshal(body)
		if e != nil {
			return e
		}
		reader = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, method, c.Base+path, reader)
	if e != nil {
		return e
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, e := c.HTTP.Do(req)
	if e != nil {
		return fmt.Errorf("%w: %v", domain.ErrCaptureUnavailable, e)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("%w: %s: %s", domain.ErrCaptureUnavailable, resp.Status, string(b))
	}
	if e = json.NewDecoder(io.LimitReader(resp.Body, 64<<20)).Decode(out); e != nil {
		return fmt.Errorf("%w: decode: %v", domain.ErrCaptureUnavailable, e)
	}
	return nil
}
func (c *Client) Read(ctx context.Context, project string, ranges []domain.Range) ([]domain.Block, error) {
	if len(ranges) == 0 || len(ranges) > 256 {
		return nil, errors.New("ranges must contain 1..256 entries")
	}
	for _, r := range ranges {
		if r.Length == 0 || r.Length > 1<<20 {
			return nil, errors.New("range length must be 1..1048576")
		}
	}
	var created viewCreated
	if err := c.request(ctx, "POST", "/internal/v1/projects/"+url.PathEscape(project)+"/assembly-views", map[string]any{"ranges": ranges}, &created); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(created.DataURL, "/internal/v1/assembly-views/") || strings.Contains(created.DataURL, "//") {
		return nil, fmt.Errorf("invalid dataUrl from Capture")
	}
	blocks := make([]domain.Block, 0, len(ranges))
	cursor := "0"
	seen := map[string]bool{}
	for {
		if seen[cursor] {
			return nil, fmt.Errorf("repeated Capture cursor")
		}
		seen[cursor] = true
		var page viewData
		path := created.DataURL + "?cursor=" + url.QueryEscape(cursor) + "&limit=16"
		if err := c.request(ctx, "GET", path, nil, &page); err != nil {
			return nil, err
		}
		blocks = append(blocks, page.Blocks...)
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
		if len(seen) > 100000 {
			return nil, errors.New("too many Capture pages")
		}
	}
	return blocks, nil
}
func (c *Client) Streams(ctx context.Context, project, assembly string) ([]domain.Stream, error) {
	cursor := ""
	seen := map[string]bool{}
	result := []domain.Stream{}
	for {
		if seen[cursor] {
			return nil, errors.New("repeated sessions cursor")
		}
		seen[cursor] = true
		var page struct {
			Items      []Session `json:"items"`
			NextCursor string    `json:"nextCursor"`
			Page       struct {
				NextCursor string `json:"nextCursor"`
			} `json:"page"`
		}
		path := "/api/v1/projects/" + url.PathEscape(project) + "/sessions?assemblyId=" + url.QueryEscape(assembly) + "&limit=100"
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		if err := c.request(ctx, "GET", path, nil, &page); err != nil {
			return nil, err
		}
		for _, s := range page.Items {
			var detail Session
			detailPath := "/api/v1/projects/" + url.PathEscape(project) + "/sessions/" + url.PathEscape(s.SessionID) + "?assemblyId=" + url.QueryEscape(assembly)
			if err := c.request(ctx, "GET", detailPath, nil, &detail); err != nil {
				return nil, err
			}
			for _, stream := range detail.Streams {
				stream.SessionID = s.SessionID
				result = append(result, stream)
			}
		}
		next := page.NextCursor
		if next == "" {
			next = page.Page.NextCursor
		}
		if next == "" {
			break
		}
		cursor = next
		if len(seen) > 100000 {
			return nil, errors.New("too many sessions pages")
		}
	}
	return result, nil
}

// domain.AssemblyMetadata identifies the exact Capture assembly used by a Run.

func (c *Client) Assembly(ctx context.Context, project, assembly string) (domain.CaptureMetadata, domain.AssemblyMetadata, error) {
	var captureCursor string
	seen := map[string]bool{}
	for {
		if seen[captureCursor] {
			return domain.CaptureMetadata{}, domain.AssemblyMetadata{}, fmt.Errorf("repeated captures cursor")
		}
		seen[captureCursor] = true
		var page struct {
			Items      []domain.CaptureMetadata `json:"items"`
			NextCursor string                   `json:"nextCursor"`
		}
		path := "/api/v1/projects/" + url.PathEscape(project) + "/captures?limit=100"
		if captureCursor != "" {
			path += "&cursor=" + url.QueryEscape(captureCursor)
		}
		if e := c.request(ctx, "GET", path, nil, &page); e != nil {
			return domain.CaptureMetadata{}, domain.AssemblyMetadata{}, e
		}
		for _, item := range page.Items {
			var assemblies struct {
				Items []domain.AssemblyMetadata `json:"items"`
			}
			path := "/api/v1/projects/" + url.PathEscape(project) + "/captures/" + url.PathEscape(item.CaptureID) + "/assemblies"
			if e := c.request(ctx, "GET", path, nil, &assemblies); e != nil {
				return domain.CaptureMetadata{}, domain.AssemblyMetadata{}, e
			}
			for _, a := range assemblies.Items {
				if a.AssemblyID == assembly {
					return item, a, nil
				}
			}
		}
		if page.NextCursor == "" {
			break
		}
		captureCursor = page.NextCursor
	}
	return domain.CaptureMetadata{}, domain.AssemblyMetadata{}, fmt.Errorf("assembly %s not found in Capture", assembly)
}
