package projects

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/platform/jobs"
	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

func (s Store) BuildReport(ctx context.Context, j jobs.Job, progress func(string, int64, *int64) error) error {
	if j.ResourceID == nil {
		return ErrInvalid
	}
	var payload struct {
		RunID      string `json:"runId"`
		SnapshotID string `json:"snapshotId"`
	}
	if err := json.Unmarshal(j.Payload, &payload); err != nil {
		return err
	}
	if !domain.ValidRunID(payload.RunID) {
		return ErrInvalid
	}
	if err := progress("READING_RUN", 0, nil); err != nil {
		return err
	}
	run, results, err := s.Peers.ReadRun(ctx, j.ProjectID, payload.RunID)
	if err != nil {
		return err
	}
	status, _ := run["status"].(string)
	var metadataJSON []byte
	metadataJSON, _, err = s.SnapshotData(ctx, payload.SnapshotID, j.ProjectID)
	if err != nil {
		return err
	}
	var metadata map[string][]map[string]any
	metadataDecoder := json.NewDecoder(bytes.NewReader(metadataJSON))
	metadataDecoder.UseNumber()
	if err = metadataDecoder.Decode(&metadata); err != nil {
		return err
	}
	if err = progress("RENDERING", 1, nil); err != nil {
		return err
	}
	var out strings.Builder
	fmt.Fprintf(&out, "# Отчёт по проекту %s\n\nRun ID: `%s`. Workspace snapshot: `%s`. Статус: %s.\n\n", j.ProjectID, payload.RunID, payload.SnapshotID, status)
	out.WriteString("## Результат завершённого запуска\n\n")
	serialized, _ := json.MarshalIndent(run, "", "  ")
	out.WriteString("```json\n")
	out.Write(serialized)
	out.WriteString("\n```\n\n")
	out.WriteString("## Выводы по зафиксированным данным\n\n")
	if summary, ok := run["summary"]; ok {
		summaryJSON, _ := json.MarshalIndent(summary, "", "  ")
		out.WriteString("Сводка Analysis:\n\n```json\n")
		out.Write(summaryJSON)
		out.WriteString("\n```\n\n")
	} else {
		out.WriteString("Analysis не вернул отдельную сводку; автоматический вывод не добавлен.\n\n")
	}
	out.WriteString("## Проверки, источники и контрпримеры\n\n")
	if len(results) == 0 {
		out.WriteString("Результаты не возвращены.\n\n")
	}
	for i, item := range results {
		fmt.Fprintf(&out, "### Результат %d\n\n```json\n", i+1)
		out.Write(item)
		out.WriteString("\n```\n\n")
	}
	out.WriteString("## Журнал и временной контекст\n\n")
	for _, journal := range metadata["journalImports"] {
		fmt.Fprintf(&out, "- %v: SHA-256 `%v`, timezone %v, offset %v нс, принято %v/%v строк.\n", journal["original_name"], journal["sha256"], journal["timezone"], journal["time_offset_ns"], journal["accepted_rows"], journal["total_rows"])
	}
	if len(metadata["journalImports"]) == 0 {
		out.WriteString("Журнал не импортирован.\n")
	}
	out.WriteString("\n")
	out.WriteString("## Наблюдения и гипотезы\n\n")
	if len(metadata["observations"]) == 0 {
		out.WriteString("Записей нет.\n\n")
	}
	for _, obs := range metadata["observations"] {
		id, _ := obs["id"].(string)
		fmt.Fprintf(&out, "### %v · %s\n\n%v\n\nСтатус: %v.\n\n", obs["kind"], id, obs["text"], obs["status"])
		for _, ev := range metadata["evidence"] {
			if ev["observation_id"] != id || fmt.Sprint(ev["selected"]) == "0" {
				continue
			}
			fmt.Fprintf(&out, "- %v: capture SHA-256 `%v`, пакет %v, смещение кадра %v, длина %v.\n", ev["kind"], ev["capture_sha256"], ev["packet_no"], ev["frame_offset"], ev["byte_length"])
		}
		out.WriteString("\n")
	}
	out.WriteString("## Неизвестное и ограничения\n\nЭтот отчёт отражает только завершённый запуск и закреплённый снимок Workspace. Неизвестные интервалы и отсутствие доказательств не считаются подтверждением.\n\n")
	out.WriteString("## Открытые вопросы\n\n")
	for _, obs := range metadata["observations"] {
		if obs["kind"] == "HYPOTHESIS" && obs["status"] != "SUPPORTED" {
			fmt.Fprintf(&out, "- %v: %v\n", obs["id"], obs["text"])
		}
	}
	if err = progress("WRITING", 2, nil); err != nil {
		return err
	}
	dbPath, err := s.DataDirectory(ctx)
	if err != nil {
		return err
	}
	dir := filepath.Join(dbPath, "artifacts")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(dir, "report-*.md")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	data := []byte(out.String())
	if _, err = temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err = temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err = temp.Close(); err != nil {
		return err
	}
	name := *j.ResourceID + ".md"
	if err = os.Rename(temp.Name(), filepath.Join(dir, name)); err != nil {
		return err
	}
	hash := sha256.Sum256(data)
	return s.SetArtifact(ctx, *j.ResourceID, name, hex.EncodeToString(hash[:]), int64(len(data)))
}
