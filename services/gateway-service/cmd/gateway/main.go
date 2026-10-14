package main

import (
	"log"

	"github.com/dkmino-hex/madrigal-laboratory/services/gateway-service/bootstrap"
)

func main() {
	if err := bootstrap.Run(); err != nil {
		log.Fatal(err)
	}
}
