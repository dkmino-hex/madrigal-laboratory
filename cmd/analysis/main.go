package main

import (
	"github.com/dkmino-hex/madrigal-laboratory/services/analysis-service/bootstrap"
	"log"
)

func main() {
	if err := bootstrap.Run(); err != nil {
		log.Fatal(err)
	}
}
