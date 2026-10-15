package research

import (
	"sort"
	"strings"
	"time"
)

type preparedAction struct {
	action                Action
	start, end, prefixEnd time.Time
	values                map[string]string
}
type ActionIndex struct{ byCapture map[string][]preparedAction }

func NewActionIndex(actions []Action) *ActionIndex {
	index := &ActionIndex{byCapture: map[string][]preparedAction{}}
	for _, action := range actions {
		start, e1 := time.Parse(time.RFC3339Nano, action.Start)
		end, e2 := time.Parse(time.RFC3339Nano, action.End)
		if e1 != nil || e2 != nil || end.Before(start) {
			continue
		}
		values := numericValues(action.Parameters, "params")
		for key, value := range numericValues(action.Observed, "observed") {
			values[key] = value
		}
		key := ""
		if action.CapturePath != "" {
			key = strings.ToLower(basename(action.CapturePath))
		}
		index.byCapture[key] = append(index.byCapture[key], preparedAction{action: action, start: start, end: end, values: values})
	}
	for key, list := range index.byCapture {
		sort.SliceStable(list, func(i, j int) bool {
			if list[i].start.Equal(list[j].start) {
				return list[i].action.ID < list[j].action.ID
			}
			return list[i].start.Before(list[j].start)
		})
		var end time.Time
		for i := range list {
			if list[i].end.After(end) {
				end = list[i].end
			}
			list[i].prefixEnd = end
		}
		index.byCapture[key] = list
	}
	return index
}
func (index *ActionIndex) Bind(row *Row) {
	row.Values = map[string]string{}
	row.ActionIDs = []string{}
	row.Association = "unlinked"
	instant, err := time.Parse(time.RFC3339Nano, row.Timestamp)
	if err != nil {
		return
	}
	values := map[string]string{}
	ambiguous := map[string]bool{}
	names := map[string]bool{}
	key := strings.ToLower(basename(row.CaptureName))
	keys := []string{key}
	if key != "" {
		keys = append(keys, "")
	}
	for _, key := range keys {
		list := index.byCapture[key]
		at := sort.Search(len(list), func(i int) bool { return list[i].start.After(instant) }) - 1
		for ; at >= 0; at-- {
			item := list[at]
			if item.prefixEnd.Before(instant) {
				break
			}
			if item.end.Before(instant) {
				continue
			}
			row.ActionIDs = append(row.ActionIDs, item.action.ID)
			names[item.action.Name] = true
			for path, value := range item.values {
				if old, ok := values[path]; ok {
					a, _ := rational(old)
					b, _ := rational(value)
					if a.Cmp(b) != 0 {
						ambiguous[path] = true
					}
				} else {
					values[path] = value
				}
			}
		}
	}
	for key, value := range values {
		if !ambiguous[key] {
			row.Values[key] = value
		}
	}
	sort.Strings(row.ActionIDs)
	if len(row.ActionIDs) == 1 {
		row.Association = "time-window"
	} else if len(row.ActionIDs) > 1 {
		row.Association = "overlapping-windows"
	}
	if len(names) == 1 {
		row.Label = sortedKeys(names)[0]
	} else if len(names) > 1 {
		row.Label = "Несколько действий в одном окне"
	}
}
