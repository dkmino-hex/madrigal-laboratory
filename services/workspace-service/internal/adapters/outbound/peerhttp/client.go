package peerhttp

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

type Client struct{}

var ErrInvalidArchive = domain.ErrInvalidArchive

func componentBase(name string) string {
	key, fallback := "CAPTURE_INTERNAL_URL", "http://127.0.0.1:8082"
	if name == "analysis" {
		key, fallback = "ANALYSIS_INTERNAL_URL", "http://127.0.0.1:8083"
	}
	if value := strings.TrimRight(os.Getenv(key), "/"); value != "" {
		return value
	}
	return fallback
}

func (Client) Snapshot(ctx context.Context, name, projectID string) (string, error) {
	client := &http.Client{Timeout: 15 * time.Minute}
	base := componentBase(name)
	endpoint := base + "/internal/v1/projects/" + url.PathEscape(projectID) + "/snapshots"
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader([]byte("{}")))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != 201 && response.StatusCode != 200 {
		return "", fmt.Errorf("snapshot returned HTTP %d", response.StatusCode)
	}
	var body struct {
		SnapshotID string `json:"snapshotId"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&body); err != nil {
		return "", err
	}
	if body.SnapshotID == "" {
		return "", errors.New("snapshot ID is missing")
	}
	return body.SnapshotID, nil
}

func (Client) WriteArchive(ctx context.Context, writer *zip.Writer, component, snapshotID, name string) (string, error) {
	client := &http.Client{Timeout: 15 * time.Minute}
	base := componentBase(component)
	req, err := http.NewRequestWithContext(ctx, "GET", base+"/internal/v1/snapshots/"+url.PathEscape(snapshotID)+"/archive", nil)
	if err != nil {
		return "", err
	}
	response, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", fmt.Errorf("archive returned HTTP %d", response.StatusCode)
	}
	entry, err := writer.Create(name)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(entry, h), io.LimitReader(response.Body, 751<<20))
	if err != nil {
		return "", err
	}
	if n >= 751<<20 {
		return "", errors.New("component archive exceeds 750 MiB")
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (Client) Restore(ctx context.Context, name, projectID, importID string, part *zip.File, headers map[string]string, recordJob func(string) error) (domain.CaptureImportResult, error) {
	client := &http.Client{Timeout: 15 * time.Minute}
	base := componentBase(name)
	reader, err := part.Open()
	if err != nil {
		return domain.CaptureImportResult{}, err
	}
	defer reader.Close()
	endpoint := base + "/internal/v1/projects/" + url.PathEscape(projectID) + "/imports/" + url.PathEscape(importID)
	req, err := http.NewRequestWithContext(ctx, "PUT", endpoint, reader)
	if err != nil {
		return domain.CaptureImportResult{}, err
	}
	req.Header.Set("Content-Type", "application/zip")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	response, err := client.Do(req)
	if err != nil {
		return domain.CaptureImportResult{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 && response.StatusCode != 202 {
		return domain.CaptureImportResult{}, fmt.Errorf("child import returned HTTP %d", response.StatusCode)
	}
	var result domain.CaptureImportResult
	if err = json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&result); err != nil {
		return domain.CaptureImportResult{}, err
	}
	if result.JobID != "" && recordJob != nil {
		if err = recordJob(result.JobID); err != nil {
			return domain.CaptureImportResult{}, err
		}
	}
	if response.StatusCode == 202 && result.JobID != "" {
		for {
			if err = ctx.Err(); err != nil {
				return domain.CaptureImportResult{}, err
			}
			jobReq, e := http.NewRequestWithContext(ctx, "GET", base+"/api/v1/jobs/"+url.PathEscape(result.JobID), nil)
			if e != nil {
				return domain.CaptureImportResult{}, e
			}
			jobResponse, e := client.Do(jobReq)
			if e != nil {
				return domain.CaptureImportResult{}, e
			}
			var job struct {
				Status string `json:"status"`
			}
			e = json.NewDecoder(io.LimitReader(jobResponse.Body, 1<<20)).Decode(&job)
			jobResponse.Body.Close()
			if e != nil || jobResponse.StatusCode != 200 {
				return domain.CaptureImportResult{}, errors.New("child job status unavailable")
			}
			if job.Status == "SUCCEEDED" {
				result.Status = "READY"
				break
			}
			if job.Status == "FAILED" || job.Status == "CANCELLED" {
				return domain.CaptureImportResult{}, errors.New("child import job failed")
			}
			select {
			case <-ctx.Done():
				return domain.CaptureImportResult{}, ctx.Err()
			case <-time.After(500 * time.Millisecond):
			}
		}
	}
	if result.Status != "READY" {
		return domain.CaptureImportResult{}, errors.New("child import is incomplete")
	}
	return result, nil
}

func (Client) ReadRun(ctx context.Context, projectID, runID string) (map[string]any, []json.RawMessage, error) {
	base := strings.TrimRight(os.Getenv("ANALYSIS_INTERNAL_URL"), "/")
	if base == "" {
		base = "http://127.0.0.1:8083"
	}
	endpoint := base + "/api/v1/projects/" + url.PathEscape(projectID) + "/runs/" + url.PathEscape(runID)
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, nil, err
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("analysis run unavailable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, nil, fmt.Errorf("analysis run returned HTTP %d", resp.StatusCode)
	}
	var run map[string]any
	if err = json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&run); err != nil {
		return nil, nil, err
	}
	status, _ := run["status"].(string)
	if status != "SUCCEEDED" && status != "COMPLETED" {
		return nil, nil, errors.New("analysis run is not complete")
	}
	results := make([]json.RawMessage, 0)
	cursor := ""
	var resultBytes int
	for page := 0; page < 100; page++ {
		resultReq, e := http.NewRequestWithContext(ctx, "GET", endpoint+"/results?limit=100&cursor="+url.QueryEscape(cursor), nil)
		if e != nil {
			return nil, nil, e
		}
		response, e := client.Do(resultReq)
		if e != nil {
			return nil, nil, e
		}
		if response.StatusCode != 200 {
			response.Body.Close()
			return nil, nil, fmt.Errorf("analysis results returned HTTP %d", response.StatusCode)
		}
		var batch struct {
			Items      []json.RawMessage `json:"items"`
			NextCursor string            `json:"nextCursor"`
		}
		e = json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&batch)
		response.Body.Close()
		if e != nil {
			return nil, nil, e
		}
		for _, item := range batch.Items {
			resultBytes += len(item)
			if resultBytes > 16<<20 {
				return nil, nil, errors.New("analysis results exceed report limit")
			}
			results = append(results, item)
		}
		if batch.NextCursor == "" {
			break
		}
		if batch.NextCursor == cursor || page == 99 {
			return nil, nil, errors.New("analysis results pagination is incomplete")
		}
		cursor = batch.NextCursor
	}

	return run, results, nil
}

func (Client) ValidateEvidence(ctx context.Context, projectID string, items []map[string]any) error {
	client := &http.Client{Timeout: 15 * time.Minute}
	for start := 0; start < len(items); start += 100 {
		end := min(start+100, len(items))
		requestBody, _ := json.Marshal(map[string]any{"evidence": items[start:end]})
		endpoint := componentBase("capture") + "/internal/v1/projects/" + url.PathEscape(projectID) + "/evidence/validate"
		req, e := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(requestBody))
		if e != nil {
			return e
		}
		req.Header.Set("Content-Type", "application/json")
		response, e := client.Do(req)
		if e != nil {
			return e
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			return ErrInvalidArchive
		}
	}
	return nil
}
