package capture

import (
	"context"
	"fmt"
	"net/url"

	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain"
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/internal/domain/research"
)

func (c *Client) ResearchCaptures(ctx context.Context, project string, selections []research.CaptureSelection) ([]research.CaptureData, bool, error) {
	complete := true
	if len(selections) == 0 {
		var page struct {
			Items []struct {
				CaptureID string `json:"captureId"`
				Status    string `json:"status"`
			}
			NextCursor string `json:"nextCursor"`
		}
		if err := c.request(ctx, "GET", "/api/v1/projects/"+url.PathEscape(project)+"/captures?limit=100", nil, &page); err != nil {
			return nil, false, err
		}
		for _, capture := range page.Items {
			if capture.Status == "READY" {
				selections = append(selections, research.CaptureSelection{CaptureID: capture.CaptureID})
			}
		}
		if len(selections) > 8 {
			selections = selections[:8]
			complete = false
		}
		if page.NextCursor != "" {
			complete = false
		}
	}
	result := []research.CaptureData{}
	for _, selection := range selections {
		var data research.CaptureData
		path := "/internal/v1/projects/" + url.PathEscape(project) + "/captures/" + url.PathEscape(selection.CaptureID) + "/research-data?maxBytes=262144&assemblyId=" + url.QueryEscape(selection.AssemblyID)
		if err := c.request(ctx, "GET", path, nil, &data); err != nil {
			return nil, false, err
		}
		if data.CaptureID != selection.CaptureID || selection.AssemblyID != "" && data.AssemblyID != selection.AssemblyID {
			return nil, false, fmt.Errorf("%w: research source mismatch", domain.ErrCaptureUnavailable)
		}
		result = append(result, data)
	}
	return result, complete, nil
}
