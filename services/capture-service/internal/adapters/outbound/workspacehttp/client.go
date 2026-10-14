package workspacehttp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/internal/domain"
)

type ProjectContext = domain.ProjectContext

type Client struct{ URL string }

func (s Client) Context(ctx context.Context, projectID, version string) (ProjectContext, error) {
	if s.URL == "" {
		return ProjectContext{}, errors.New("workspace URL is required")
	}
	u := strings.TrimRight(s.URL, "/") + "/internal/v1/projects/" + url.PathEscape(projectID) + "/context?settingsVersion=" + url.QueryEscape(version)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return ProjectContext{}, err
	}
	client := http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return ProjectContext{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		if resp.StatusCode == http.StatusNotFound {
			return ProjectContext{}, sql.ErrNoRows
		}
		return ProjectContext{}, fmt.Errorf("workspace context returned HTTP %d", resp.StatusCode)
	}
	var result ProjectContext
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return ProjectContext{}, err
	}
	if result.ProjectID != projectID || result.Status != "READY" || result.SettingsVersion == "" || len(result.Settings) == 0 {
		return ProjectContext{}, errors.New("project context is not ready")
	}
	return result, nil
}
