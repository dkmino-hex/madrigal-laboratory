package projects

import (
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

const maxJournalSize = 16 << 20

func (s Store) AcceptJournal(ctx context.Context, projectID string, in JournalInput, reader io.Reader) (JournalImport, error) {
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 255 || in.OffsetNS < -86400e9 || in.OffsetNS > 86400e9 || in.IdempotencyKey != "" && !domain.ValidIdempotencyKey(in.IdempotencyKey) {
		return JournalImport{}, ErrInvalid
	}
	if in.Timezone == "" {
		in.Timezone = "UTC"
	}
	if _, err := time.LoadLocation(in.Timezone); err != nil {
		return JournalImport{}, ErrInvalid
	}
	project, err := s.Get(ctx, projectID)
	if err != nil {
		return JournalImport{}, err
	}
	if project.Status != "READY" {
		return JournalImport{}, ErrProjectNotReady
	}
	path, err := s.DataDirectory(ctx)
	if err != nil {
		return JournalImport{}, err
	}
	dir := filepath.Join(path, "journals")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return JournalImport{}, err
	}
	temp, err := os.CreateTemp(dir, "upload-*.csv")
	if err != nil {
		return JournalImport{}, err
	}
	defer os.Remove(temp.Name())
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(temp, h), io.LimitReader(reader, maxJournalSize+1))
	if closeErr := temp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return JournalImport{}, err
	}
	if n == 0 || n > maxJournalSize {
		return JournalImport{}, ErrInvalid
	}
	hash := hex.EncodeToString(h.Sum(nil))
	final := filepath.Join(dir, hash+".csv")
	if err = os.Rename(temp.Name(), final); err != nil && !errors.Is(err, os.ErrExist) {
		return JournalImport{}, err
	}
	return s.RegisterJournal(ctx, projectID, in, final, hash)
}

func (s Store) ImportJournal(ctx context.Context, j jobs.Job, progress func(string, int64, *int64) error) error {
	if j.ResourceID == nil {
		return ErrInvalid
	}
	input, err := s.JournalSource(ctx, *j.ResourceID)
	if err != nil {
		return err
	}
	path, timezone, offset := input.Path, input.Timezone, input.Offset
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return err
	}
	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	r.ReuseRecord = false
	header, err := r.Read()
	if err != nil {
		return err
	}
	expected := []string{"capture", "session", "action_id", "start_utc", "end_utc", "action", "parameters", "observed_result"}
	compact := len(header) == 4
	if compact {
		expected = []string{"timestamp", "name", "type", "parameters"}
	}
	if len(header) != len(expected) {
		return ErrInvalid
	}
	for i := range expected {
		if strings.TrimSpace(header[i]) != expected[i] {
			return ErrInvalid
		}
	}
	if err = progress("PARSING", 0, nil); err != nil {
		return err
	}
	total, err := s.WriteJournal(ctx, j, func(insert func(domain.JournalAction) error) (int64, int64, []map[string]any, error) {
		var total, accepted int64
		diagnostics := make([]map[string]any, 0)
		for {
			if err = ctx.Err(); err != nil {
				return 0, 0, nil, err
			}
			row, readErr := r.Read()
			if errors.Is(readErr, io.EOF) {
				break
			}
			total++
			line := total + 1
			if readErr != nil {
				var parseError *csv.ParseError
				if errors.As(readErr, &parseError) {
					line = int64(parseError.Line)
				}
				diagnostics = append(diagnostics, map[string]any{"line": line, "message": readErr.Error()})
				continue
			}
			if len(row) > 0 {
				startLine, _ := r.FieldPos(0)
				line = int64(startLine)
			}
			if len(row) != len(expected) {
				diagnostics = append(diagnostics, map[string]any{"line": line, "message": fmt.Sprintf("expected %d columns", len(expected))})
				continue
			}
			actionType := ""
			if compact {
				actionType = row[2]
				row = []string{"", "", fmt.Sprint(line), row[0], row[0], row[1], row[3], "null"}
			}
			start, e1 := parseJournalTime(row[3], location)
			end, e2 := parseJournalTime(row[4], location)
			if e1 != nil || e2 != nil || end.Before(start) || strings.TrimSpace(row[2]) == "" || strings.TrimSpace(row[5]) == "" || !json.Valid([]byte(row[6])) || !json.Valid([]byte(row[7])) {
				diagnostics = append(diagnostics, map[string]any{"line": line, "message": "invalid action, timestamp or JSON"})
				continue
			}
			adjustedStart, adjustedEnd := start.Add(time.Duration(offset)), end.Add(time.Duration(offset))
			startNS, endNS := adjustedStart.UnixNano(), adjustedEnd.UnixNano()
			if !time.Unix(0, startNS).Equal(adjustedStart) || !time.Unix(0, endNS).Equal(adjustedEnd) {
				diagnostics = append(diagnostics, map[string]any{"line": line, "message": "timestamp is outside supported nanosecond range"})
				continue
			}
			err = insert(domain.JournalAction{SourceID: row[2], Line: line, Capture: row[0], Session: row[1], Start: startNS, End: endNS, Name: row[5], Type: actionType, Parameters: row[6], Result: row[7]})
			if err != nil {
				diagnostics = append(diagnostics, map[string]any{"line": line, "message": "duplicate action or invalid row"})
				continue
			}
			accepted++
		}

		return total, accepted, diagnostics, nil
	})
	if err != nil {
		return err
	}
	return progress("PERSISTED", total, &total)
}

func parseJournalTime(raw string, location *time.Location) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return t.UTC(), nil
	}
	for _, layout := range []string{"2006-01-02T15:04:05.999999999", "2006-01-02 15:04:05.999999999"} {
		if t, err := time.ParseInLocation(layout, raw, location); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid timestamp")
}
