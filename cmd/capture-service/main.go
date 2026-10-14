package main

import (
	"log/slog"
	"os"

	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/bootstrap"
)

func main() {
	if err := bootstrap.Run(); err != nil {
		slog.Error("capture-service stopped", "error", err)
		os.Exit(1)
	}
}
