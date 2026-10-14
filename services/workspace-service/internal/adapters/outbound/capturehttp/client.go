package capturehttp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func captureURL() string {
	if value := strings.TrimRight(os.Getenv("CAPTURE_INTERNAL_URL"), "/"); value != "" {
		return value
	}
	return "http://127.0.0.1:8082"
}

func fetchCaptureJSON(ctx context.Context, path string, out any) error {
	client := &http.Client{Timeout: 5 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "GET", captureURL()+path, nil)
	if err != nil {
		return domain.ErrInvalid
	}
	resp, err := client.Do(req)
	if err != nil {
		return domain.ErrSourceUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 || resp.StatusCode == 400 {
		return domain.ErrInvalid
	}
	if resp.StatusCode != 200 {
		return domain.ErrSourceUnavailable
	}
	if err = json.NewDecoder(resp.Body).Decode(out); err != nil {
		return domain.ErrSourceUnavailable
	}
	return nil
}

func ValidateEvidence(ctx context.Context, projectID string, e domain.EvidenceInput) error {
	if e.CaptureID == "" || e.ByteLength > 1<<20 || e.FrameOffset > 1<<30 {
		return domain.ErrInvalid
	}
	base := "/api/v1/projects/" + url.PathEscape(projectID)
	cursor := ""
	found := false
	for pages := 0; pages < 100; pages++ {
		var list struct {
			Items []struct {
				ID     string `json:"captureId"`
				SHA256 string `json:"sha256"`
				Status string `json:"status"`
			} `json:"items"`
			Next string `json:"nextCursor"`
		}
		if err := fetchCaptureJSON(ctx, base+"/captures?limit=100&cursor="+url.QueryEscape(cursor), &list); err != nil {
			return err
		}
		for _, c := range list.Items {
			if c.ID == e.CaptureID {
				if c.SHA256 != e.CaptureSHA256 || c.Status != "READY" {
					return domain.ErrInvalid
				}
				found = true
				break
			}
		}
		if found || list.Next == "" {
			break
		}
		cursor = list.Next
	}
	if !found {
		return domain.ErrInvalid
	}
	var packet struct {
		CapturedLength int64 `json:"capturedLength"`
	}
	if err := fetchCaptureJSON(ctx, fmt.Sprintf("%s/captures/%s/packets/%d", base, url.PathEscape(e.CaptureID), e.PacketNo), &packet); err != nil {
		return err
	}
	if e.FrameOffset+e.ByteLength > packet.CapturedLength {
		return domain.ErrInvalid
	}
	if e.AssemblyID != "" {
		var versions struct {
			Items []struct {
				ID     string `json:"assemblyId"`
				Status string `json:"status"`
			} `json:"items"`
		}
		if err := fetchCaptureJSON(ctx, base+"/captures/"+url.PathEscape(e.CaptureID)+"/assemblies", &versions); err != nil {
			return err
		}
		ready := false
		for _, v := range versions.Items {
			if v.ID == e.AssemblyID && v.Status == "READY" {
				ready = true
				break
			}
		}
		if !ready {
			return domain.ErrInvalid
		}
		var sources struct {
			Sources []struct {
				PacketNo    int64 `json:"packetNo"`
				FrameStart  int64 `json:"frameStart"`
				FrameEnd    int64 `json:"frameEnd"`
				StreamStart int64 `json:"streamStart"`
				StreamEnd   int64 `json:"streamEnd"`
			} `json:"sources"`
		}
		path := base + "/streams/" + url.PathEscape(e.StreamID) + "/sources?assemblyId=" + url.QueryEscape(e.AssemblyID) + "&offset=" + strconv.FormatInt(*e.StreamOffset, 10) + "&length=" + strconv.FormatInt(e.ByteLength, 10)
		if err := fetchCaptureJSON(ctx, path, &sources); err != nil {
			return err
		}
		matched := false
		for _, src := range sources.Sources {
			if src.PacketNo == e.PacketNo && src.FrameStart <= e.FrameOffset && src.FrameEnd >= e.FrameOffset+e.ByteLength && src.StreamStart <= *e.StreamOffset && src.StreamEnd >= *e.StreamOffset+e.ByteLength {
				matched = true
				break
			}
		}
		if !matched {
			return domain.ErrInvalid
		}
	}
	return nil
}
