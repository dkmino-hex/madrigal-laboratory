package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/internal/database"
	capture "github.com/dkmino-hex/madrigal-laboratory/services/capture-service/storage"
	workspace "github.com/dkmino-hex/madrigal-laboratory/services/workspace-service/storage"
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "migration error:", err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer) error {
	flags := flag.NewFlagSet("migrate", flag.ContinueOnError)
	flags.SetOutput(out)
	service := flags.String("service", "all", "workspace, capture or all")
	action := flags.String("action", "up", "up or status")
	dataDir := flags.String("data-dir", "data", "root of private service data")
	dbPath := flags.String("db", "", "explicit database path; requires a single service")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments")
	}
	if *action != "up" && *action != "status" {
		return fmt.Errorf("unknown action %q", *action)
	}
	if *service != "workspace" && *service != "capture" && *service != "all" {
		return fmt.Errorf("unknown service %q", *service)
	}
	if *service == "all" && *dbPath != "" {
		return fmt.Errorf("-db requires -service workspace or capture")
	}
	rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	ctx, cancel := context.WithTimeout(rootCtx, 30*time.Second)
	defer cancel()
	owners := []string{*service}
	if *service == "all" {
		owners = []string{"workspace", "capture"}
	}
	for _, owner := range owners {
		path := *dbPath
		if path == "" {
			path = filepath.Join(*dataDir, owner, owner+".sqlite")
		}
		var files fs.FS = workspace.Migrations
		if owner == "capture" {
			files = capture.Migrations
		}
		db, err := database.Open(ctx, path)
		if err != nil {
			return err
		}
		if *action == "up" {
			err = database.Apply(ctx, db, owner, files)
		}
		var statuses []database.MigrationStatus
		if err == nil {
			statuses, err = database.Status(ctx, db, owner, files)
		}
		closeErr := db.Close()
		if err != nil {
			return fmt.Errorf("%s: %w", owner, err)
		}
		if closeErr != nil {
			return closeErr
		}
		fmt.Fprintf(out, "%s: %s\n", owner, path)
		for _, s := range statuses {
			label := "pending"
			if s.Applied {
				label = "applied"
			}
			fmt.Fprintf(out, "  %s  %s\n", label, s.Name)
		}
	}
	return nil
}
