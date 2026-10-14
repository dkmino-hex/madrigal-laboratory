package service

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestWorkerFailureStopsHTTPAndOtherWorkers(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	failure := errors.New("worker failed")
	stopped := make(chan struct{})
	err = serve(context.Background(), listener, http.NotFoundHandler(),
		func(context.Context) error { return failure },
		func(ctx context.Context) error { <-ctx.Done(); close(stopped); return ctx.Err() },
	)
	if !errors.Is(err, failure) {
		t.Fatalf("worker failure was lost: %v", err)
	}
	select {
	case <-stopped:
	default:
		t.Fatal("service returned before its worker stopped")
	}
	connection, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second)
	if err == nil {
		connection.Close()
		t.Fatal("HTTP listener stayed open after worker failure")
	}
}

func TestCancellationWaitsForWorkers(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started, stopped := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- serve(ctx, listener, http.NotFoundHandler(), func(ctx context.Context) error {
			close(started)
			<-ctx.Done()
			close(stopped)
			return ctx.Err()
		})
	}()
	<-started
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("service did not stop")
	}
	select {
	case <-stopped:
	default:
		t.Fatal("worker was not joined")
	}
}
