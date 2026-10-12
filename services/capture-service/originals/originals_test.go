package originals_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/originals"
)

type repeating struct{}

func (repeating) Read(b []byte) (int, error) {
	for i := range b {
		b[i] = 0
	}
	return len(b), nil
}

type failing struct{}

func (failing) Read([]byte) (int, error) { return 0, errors.New("upload disconnected") }

func TestOriginalPublicationIntegrityAndFailure(t *testing.T) {
	root := t.TempDir()
	store, err := originals.New(root)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../../testdata/sample_protocol/research/01_configuration.pcap")
	if err != nil {
		t.Fatal(err)
	}
	obj, err := store.Put(context.Background(), bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	again, err := store.Put(context.Background(), bytes.NewReader(data))
	if err != nil || obj != again {
		t.Fatalf("repeat: %+v %v", again, err)
	}
	if err = store.Verify(context.Background(), obj); err != nil {
		t.Fatal(err)
	}
	file, err := store.Open(obj)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := io.ReadAll(file)
	file.Close()
	if err != nil || !bytes.Equal(actual, data) {
		t.Fatal("original bytes differ")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = store.Put(ctx, bytes.NewReader(data)); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
	if _, err = store.Put(context.Background(), failing{}); err == nil {
		t.Fatal("failed read was published")
	}
	if _, err = store.Put(context.Background(), bytes.NewBufferString("not pcap")); !errors.Is(err, originals.ErrFormat) {
		t.Fatalf("format: %v", err)
	}
	if _, err = store.Put(context.Background(), io.LimitReader(repeating{}, originals.MaxSize+1)); !errors.Is(err, originals.ErrTooLarge) {
		t.Fatalf("size: %v", err)
	}
	staging, err := os.ReadDir(filepath.Join(root, "staging"))
	if err != nil || len(staging) != 0 {
		t.Fatalf("staging: %v %v", staging, err)
	}
	bad := obj
	bad.RelativePath = "../outside"
	if _, err = store.Open(bad); err == nil {
		t.Fatal("accepted path traversal")
	}
	if err = os.WriteFile(filepath.Join(root, filepath.FromSlash(obj.RelativePath)), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = store.Verify(context.Background(), obj); err == nil {
		t.Fatal("corruption was not detected")
	}
	if _, err = store.Put(context.Background(), bytes.NewReader(data)); err == nil {
		t.Fatal("existing corrupted object was overwritten")
	}
}
