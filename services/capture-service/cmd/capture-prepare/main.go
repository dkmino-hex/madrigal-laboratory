package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/dkmino-hex/madrigal-laboratory/services/capture-service/bootstrap"
)

func main() {
	project := flag.String("project", "", "existing project ID")
	path := flag.String("file", "", "PCAP/PCAPNG file")
	flag.Parse()
	if err := bootstrap.Prepare(*project, *path); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
