package service

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func Env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

// Run gives the HTTP server and its workers one shutdown lifecycle.
func Run(addr string, handler http.Handler, workers ...func(context.Context) error) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return Serve(ctx, addr, handler, workers...)
}

func Serve(ctx context.Context, addr string, handler http.Handler, workers ...func(context.Context) error) error {
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	return serve(ctx, listener, handler, workers...)
}

func serve(ctx context.Context, listener net.Listener, handler http.Handler, workers ...func(context.Context) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	server := &http.Server{
		Handler: handler, ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 15 * time.Minute, WriteTimeout: 15 * time.Minute,
		IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10,
	}
	results := make(chan error, len(workers)+1)
	go func() { results <- server.Serve(listener) }()
	for _, worker := range workers {
		go func() { results <- worker(ctx) }()
	}
	slog.Info("HTTP service started", "address", listener.Addr())
	remaining := len(workers) + 1
	var result error
	record := func(err error) {
		if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, http.ErrServerClosed) {
			result = errors.Join(result, err)
		}
	}
	select {
	case err := <-results:
		remaining--
		record(err)
	case <-ctx.Done():
	}
	cancel()
	shutdown, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	if err := server.Shutdown(shutdown); err != nil {
		record(err)
		_ = server.Close()
	}
	for remaining > 0 {
		select {
		case err := <-results:
			remaining--
			record(err)
		case <-shutdown.Done():
			return errors.Join(result, shutdown.Err())
		}
	}
	return result
}
