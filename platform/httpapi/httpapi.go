package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/platform/identifier"
)

type APIError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Details   any    `json:"details,omitempty"`
	RequestID string `json:"requestId"`
}

func JSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write response", "error", err)
	}
}

func Error(w http.ResponseWriter, status int, code, message string) {
	JSON(w, status, APIError{Code: code, Message: message, RequestID: w.Header().Get("X-Request-ID")})
}

func Decode(w http.ResponseWriter, r *http.Request, value any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	dec.UseNumber()
	if err := dec.Decode(value); err != nil {
		return err
	}
	if err := dec.Decode(new(any)); !errors.Is(err, io.EOF) {
		return errors.New("expected one JSON object")
	}
	return nil
}

func Limit(r *http.Request) (int, error) {
	if r.URL.Query().Get("limit") == "" {
		return 50, nil
	}
	n, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || n < 1 || n > 100 {
		return 0, errors.New("limit must be between 1 and 100")
	}
	return n, nil
}

func Health(mux *http.ServeMux, db interface{ PingContext(context.Context) error }) {
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { JSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			Error(w, 503, "NOT_READY", "database is unavailable")
			return
		}
		JSON(w, 200, map[string]string{"status": "ready"})
	})
}

func Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if len(id) == 0 || len(id) > 128 {
			id = identifier.New("req")
		}
		for _, c := range id {
			if c < 33 || c > 126 {
				id = identifier.New("req")
				break
			}
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r)
	})
}
