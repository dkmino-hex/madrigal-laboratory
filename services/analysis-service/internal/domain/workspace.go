package domain

import "encoding/json"

type ProjectContext struct {
	ProjectID       string          `json:"projectId"`
	Status          string          `json:"status"`
	SettingsVersion string          `json:"settingsVersion"`
	Version         int             `json:"version"`
	Settings        json.RawMessage `json:"settings"`
}
