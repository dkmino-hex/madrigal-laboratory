package projects

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/internal/domain"
)

type reportProvenance struct {
	links     map[string]domain.SourceLink
	relations map[string][]map[string]any
}

// Decode source links once per report, independent of the number of observations.
func indexReportProvenance(metadata map[string][]map[string]any) reportProvenance {
	index := reportProvenance{links: make(map[string]domain.SourceLink, len(metadata["sourceLinks"])), relations: map[string][]map[string]any{}}
	for _, row := range metadata["sourceLinks"] {
		var link domain.SourceLink
		raw, _ := row["data_json"].(string)
		if json.Unmarshal([]byte(raw), &link) == nil {
			id, _ := row["id"].(string)
			index.links[id] = link
		}
	}
	for _, relation := range metadata["observationLinks"] {
		id, _ := relation["observation_id"].(string)
		index.relations[id] = append(index.relations[id], relation)
	}
	return index
}

func (index reportProvenance) writeObservation(out *strings.Builder, observation map[string]any) {
	if basis, ok := observation["basis"].(string); ok && basis != "" {
		fmt.Fprintf(out, "Основание: %s\n\n", basis)
	}
	if raw, ok := observation["generation_json"].(string); ok && raw != "{}" && raw != "" {
		fmt.Fprintf(out, "Происхождение автоматического предложения:\n\n```json\n%s\n```\n\n", raw)
	}
	observationID, _ := observation["id"].(string)
	for _, relation := range index.relations[observationID] {
		id, _ := relation["link_id"].(string)
		link, ok := index.links[id]
		if !ok {
			continue
		}
		fmt.Fprintf(out, "- %v · источник `%s`: capture `%s`, SHA-256 `%s`, сборка `%s`, поток `%s`, направление %s, смещение %s, длина %s. Статус источника: %s.\n", relation["kind"], id, link.Location.CaptureID, link.CaptureSHA256, link.Location.AssemblyID, link.Location.StreamID, link.Location.Direction, link.Location.Start, link.Location.Length, link.Status)
		if link.ActionID != "" {
			fmt.Fprintf(out, "  Действие журнала: `%s`.\n", link.ActionID)
		}
		if link.Basis != "" {
			fmt.Fprintf(out, "  Основание связи: %s\n", link.Basis)
		}
		for _, source := range link.Sources {
			fmt.Fprintf(out, "  Пакет %d: смещение кадра %s, длина %s, смещение потока %s, отношение %s.\n", source.PacketNo, source.FrameOffset, source.Length, source.StreamStart, source.Relation)
		}
	}
	out.WriteString("\n")
}
