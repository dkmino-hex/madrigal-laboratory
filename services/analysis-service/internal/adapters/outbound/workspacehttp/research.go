package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/research"
)

func (c *Client) ResearchActions(ctx context.Context, project string) ([]research.Action, bool, error) {
	result := []research.Action{}
	bytesRead := 0
	cursor := ""
	seen := map[string]bool{}
	for len(result) < 2000 {
		if seen[cursor] {
			return nil, false, fmt.Errorf("repeated journal cursor")
		}
		seen[cursor] = true
		request, err := http.NewRequestWithContext(ctx, "GET", c.Base+"/api/v1/projects/"+url.PathEscape(project)+"/actions?limit=100&cursor="+url.QueryEscape(cursor), nil)
		if err != nil {
			return nil, false, err
		}
		response, err := c.HTTP.Do(request)
		if err != nil {
			return nil, false, err
		}
		var page struct {
			Items      []research.Action `json:"items"`
			NextCursor string            `json:"nextCursor"`
		}
		if response.StatusCode != 200 {
			response.Body.Close()
			return nil, false, fmt.Errorf("workspace journal: %s", response.Status)
		}
		err = json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&page)
		response.Body.Close()
		if err != nil {
			return nil, false, err
		}
		for _, action := range page.Items {
			bytesRead += len(action.Parameters) + len(action.Observed) + len(action.CapturePath) + len(action.Name) + 128
			if bytesRead > 2<<20 {
				return result, false, nil
			}
			result = append(result, action)
		}
		cursor = page.NextCursor
		if cursor == "" {
			return result, true, nil
		}
	}
	return result, false, nil
}
