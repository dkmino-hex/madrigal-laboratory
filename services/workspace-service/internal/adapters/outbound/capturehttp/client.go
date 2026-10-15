package capturehttp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

var client = &http.Client{Timeout: 5 * time.Second}

// Capture validates the proof against its indexed packet and SourceMap in one
// request. Workspace does not repeat Capture's lookup and range rules.
func ValidateEvidence(ctx context.Context, projectID string, e domain.EvidenceInput) error {
	if err := e.Validate(); err != nil {
		return err
	}
	base := strings.TrimRight(os.Getenv("CAPTURE_INTERNAL_URL"), "/")
	if base == "" {
		base = "http://127.0.0.1:8082"
	}
	data, err := json.Marshal(map[string]any{"evidence": []domain.EvidenceInput{e}})
	if err != nil {
		return domain.ErrInvalid
	}
	req, err := http.NewRequestWithContext(ctx, "POST", base+"/internal/v1/projects/"+url.PathEscape(projectID)+"/evidence/validate", bytes.NewReader(data))
	if err != nil {
		return domain.ErrInvalid
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return domain.ErrSourceUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode == 400 || response.StatusCode == 404 || response.StatusCode == 422 {
		return domain.ErrInvalid
	}
	if response.StatusCode != 200 {
		return domain.ErrSourceUnavailable
	}
	var result struct {
		Valid bool `json:"valid"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result) != nil || !result.Valid {
		return domain.ErrSourceUnavailable
	}
	return nil
}
