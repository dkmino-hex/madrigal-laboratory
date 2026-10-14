package architecture_test

import (
	"encoding/json"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const module = "github.com/dkmino-hex/madrigal-laboratory/"

func TestServiceDependencyBoundaries(t *testing.T) {
	root := filepath.Join("..", "..")
	for _, service := range []string{"capture-service", "workspace-service", "analysis-service", "gateway-service"} {
		serviceRoot := filepath.Join(root, "services", service)
		err := filepath.WalkDir(serviceRoot, func(name string, entry fs.DirEntry, err error) error {
			if err != nil || entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
				return err
			}
			file, err := parser.ParseFile(token.NewFileSet(), name, nil, parser.ImportsOnly)
			if err != nil {
				return err
			}
			relative, _ := filepath.Rel(serviceRoot, name)
			relative = filepath.ToSlash(relative)
			for _, imp := range file.Imports {
				dependency, _ := strconv.Unquote(imp.Path.Value)
				if strings.HasPrefix(dependency, module+"services/") && !strings.HasPrefix(dependency, module+"services/"+service+"/") {
					t.Errorf("%s imports another service's implementation: %s", name, dependency)
				}
				if strings.HasPrefix(relative, "internal/domain/") &&
					(dependency == "database/sql" || dependency == "net/http" || dependency == "os" || strings.HasPrefix(dependency, module+"platform/") || strings.Contains(dependency, "/internal/application/") || strings.Contains(dependency, "/internal/adapters/")) {
					t.Errorf("domain %s depends on infrastructure: %s", name, dependency)
				}
				if strings.HasPrefix(relative, "internal/application/") &&
					(dependency == "database/sql" || dependency == "net/http" || strings.Contains(dependency, "/internal/adapters/")) {
					t.Errorf("application %s bypasses its ports: %s", name, dependency)
				}
				if strings.HasPrefix(relative, "internal/adapters/inbound/") && strings.Contains(dependency, "/internal/adapters/outbound/") {
					t.Errorf("inbound adapter %s bypasses application ports: %s", name, dependency)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}

func TestHTTPRouteContract(t *testing.T) {
	root := filepath.Join("..", "..")
	data, err := os.ReadFile(filepath.Join(root, "contracts", "http-routes.json"))
	if err != nil {
		t.Fatal(err)
	}
	var expected map[string][]string
	if err := json.Unmarshal(data, &expected); err != nil {
		t.Fatal(err)
	}
	pattern := regexp.MustCompile(`HandleFunc\("((?:GET|POST|PUT|PATCH|DELETE|HEAD) [^"]+)"`)
	for service, want := range expected {
		var got []string
		for _, directory := range []string{filepath.Join(root, "services", service, "internal", "adapters", "inbound", "http"), filepath.Join(root, "platform", "httpapi")} {
			entries, err := os.ReadDir(directory)
			if err != nil {
				t.Fatal(err)
			}
			for _, entry := range entries {
				if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
					continue
				}
				body, err := os.ReadFile(filepath.Join(directory, entry.Name()))
				if err != nil {
					t.Fatal(err)
				}
				for _, match := range pattern.FindAllStringSubmatch(string(body), -1) {
					got = append(got, match[1])
				}
			}
		}
		slices.Sort(got)
		got = slices.Compact(got)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s route contract changed\nwant: %v\n got: %v", service, want, got)
		}
	}
}
