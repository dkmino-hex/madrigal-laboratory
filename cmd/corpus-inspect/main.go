package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/dkmino-hex/madrigal-laboratory/internal/corpus"
)

func main() {
	root := flag.String("root", "testdata/sample_protocol", "capture file or directory")
	output := flag.String("out", "", "JSON output file; default stdout")
	flag.Parse()
	if err := run(*root, *output); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(root, output string) error {
	reports := []corpus.Report{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".pcap" && ext != ".pcapng" {
			return nil
		}
		report, err := corpus.Inspect(path)
		if err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		reports = append(reports, report)
		return nil
	})
	if err != nil {
		return err
	}
	if len(reports) == 0 {
		return fmt.Errorf("no PCAP/PCAPNG files found")
	}
	file := os.Stdout
	if output != "" {
		file, err = os.Create(output)
		if err != nil {
			return err
		}
		defer file.Close()
	}
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	return encoder.Encode(reports)
}
