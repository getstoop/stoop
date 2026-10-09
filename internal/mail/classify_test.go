package mail

import (
	"context"
	"fmt"
	"net"
	"testing"
)

// A lookup that timed out says nothing about the host name.
func TestClassifyDNS(t *testing.T) {
	server := Server{Host: "smtp.example.net", Port: 587}
	timedOut := fmt.Errorf("dial: %w", &net.DNSError{Name: server.Host, IsTimeout: true})
	if refusal := classify(context.Background(), server, &connWatch{}, timedOut); refusal.Field != "" {
		t.Errorf("a DNS timeout blamed %q: %s", refusal.Field, refusal.Message)
	}
	missing := fmt.Errorf("dial: %w", &net.DNSError{Name: server.Host, IsNotFound: true})
	if refusal := classify(context.Background(), server, &connWatch{}, missing); refusal.Field != "host" {
		t.Errorf("an unknown host landed on %q, want host", refusal.Field)
	}
}
