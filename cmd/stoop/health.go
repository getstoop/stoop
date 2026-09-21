package main

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"time"
)

// runHealth is the container healthcheck: the image has no shell or wget
// to make the request with.
func runHealth(out io.Writer) int {
	url := healthURL(os.Getenv("STOOP_LISTEN_ADDR"))
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		_, _ = fmt.Fprintln(out, "unhealthy:", err)
		return 1
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		_, _ = fmt.Fprintf(out, "unhealthy: %s answered %s\n", url, resp.Status)
		return 1
	}
	_, _ = fmt.Fprintln(out, "ok")
	return 0
}

// healthURL turns a listen address into one to dial on this machine.
func healthURL(listenAddr string) string {
	if listenAddr == "" {
		listenAddr = ":8080"
	}
	host, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		host, port = "", "8080"
	}
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port) + "/healthz"
}
