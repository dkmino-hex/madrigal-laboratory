package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/dkmino-hex/madrigal-laboratory/internal/database"
	runtimecfg "github.com/dkmino-hex/madrigal-laboratory/internal/service"
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
	path := flags.String("db", "", "SQLite path for a single service")
	workspacePath := flags.String("workspace-db", runtimecfg.Env("WORKSPACE_DB_PATH", "data/workspace/workspace.sqlite"), "Workspace SQLite path")
	capturePath := flags.String("capture-db", runtimecfg.Env("CAPTURE_DB_PATH", "data/capture/capture.sqlite"), "Capture SQLite path")
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
	if *service == "all" && *path != "" {
		return fmt.Errorf("-db requires -service workspace or capture")
	}
	type target struct {
		owner, path string
		files       fs.FS
	}
	targets := []target{}
	for _, owner := range []string{"workspace", "capture"} {
		if *service != "all" && *service != owner {
			continue
		}
		selected, files := *workspacePath, fs.FS(workspace.Migrations)
		if owner == "capture" {
			selected, files = *capturePath, capture.Migrations
		}
		if *path != "" {
			selected = *path
		}
		if strings.TrimSpace(selected) == "" {
			return fmt.Errorf("%s: set %s_DB_PATH or pass a database path flag", owner, strings.ToUpper(owner))
		}
		targets = append(targets, target{owner, selected, files})
	}
	rootCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	ctx, cancel := context.WithTimeout(rootCtx, 60*time.Second)
	defer cancel()
	for _, target := range targets {
		db, err := database.Open(ctx, target.path)
		if err != nil {
			return fmt.Errorf("%s: %w", target.owner, err)
		}
		if *action == "up" {
			err = database.Apply(ctx, db, target.owner, target.files)
		}
		var statuses []database.MigrationStatus
		if err == nil {
			statuses, err = database.Status(ctx, db, target.owner, target.files)
		}
		closeErr := db.Close()
		if err != nil {
			return fmt.Errorf("%s: %w", target.owner, err)
		}
		if closeErr != nil {
			return closeErr
		}
		fmt.Fprintf(out, "%s: SQLite\n", target.owner)
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
