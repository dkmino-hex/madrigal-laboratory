package main

import (
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Analysis is running"))
	})

	log.Println("Analysis started on :8083")

	err := http.ListenAndServe(":8083", mux)
	if err != nil {
		log.Fatal(err)
	}
}
