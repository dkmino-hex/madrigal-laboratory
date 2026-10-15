package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/platform/httpapi"
)

func frontend(directory string) http.Handler {
	files := http.FileServer(http.Dir(directory))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/internal/") || directory == "" {
			httpapi.Error(w, 404, "NOT_FOUND", "route was not found")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			w.Header().Set("Allow", "GET, HEAD")
			httpapi.Error(w, 405, "METHOD_NOT_ALLOWED", "method not allowed")
			return
		}
		local := strings.TrimPrefix(r.URL.Path, "/")
		if local != "" && !filepath.IsLocal(local) {
			http.NotFound(w, r)
			return
		}
		info, err := os.Stat(filepath.Join(directory, local))
		if err == nil && info.Mode().IsRegular() {
			if strings.HasPrefix(local, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			files.ServeHTTP(w, r)
			return
		}
		if filepath.Ext(local) != "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(directory, "index.html"))
	})
}
