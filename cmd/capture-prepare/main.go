package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/internal/service"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/captures"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/originals"
	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/storage"
)

func main() {
	project := flag.String("project", "", "existing project ID")
	path := flag.String("file", "", "PCAP/PCAPNG file")
	flag.Parse()
	if err := run(*project, *path); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(project, path string) error {
	if project == "" || path == "" {
		return errors.New("-project and -file are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	db, err := storage.Open(ctx, service.Env("CAPTURE_DB_PATH", "data/capture/capture.sqlite"))
	if err != nil {
		return err
	}
	defer db.Close()
	files, err := originals.New(service.Env("CAPTURE_DATA_DIR", "data/capture"))
	if err != nil {
		return err
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	c, j, duplicate, err := (captures.Store{DB: db, Files: files}).AcceptOriginal(ctx, project, path, file)
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"capture": c, "job": j, "duplicate": duplicate})
}
