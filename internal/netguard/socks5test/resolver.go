package socks5test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"golang.org/x/net/dns/dnsmessage"
)

// StartResolver runs a DNS-over-HTTPS resolver, over plain HTTP, until
// the test ends, and returns its URL. It answers each name in records
// with that IPv4 address and has nothing for any other.
func StartResolver(t *testing.T, records map[string]string) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		var query dnsmessage.Message
		if err != nil || query.Unpack(body) != nil || len(query.Questions) != 1 {
			http.Error(w, "bad query", http.StatusBadRequest)
			return
		}
		question := query.Questions[0]
		reply := dnsmessage.Message{
			Header:    dnsmessage.Header{Response: true, RecursionAvailable: true},
			Questions: query.Questions,
		}
		address, known := records[strings.TrimSuffix(question.Name.String(), ".")]
		switch {
		case !known:
			reply.RCode = dnsmessage.RCodeNameError
		case question.Type == dnsmessage.TypeA:
			reply.Answers = []dnsmessage.Resource{{
				Header: dnsmessage.ResourceHeader{Name: question.Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 60},
				Body:   &dnsmessage.AResource{A: netip.MustParseAddr(address).As4()},
			}}
		}
		packed, err := reply.Pack()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/dns-message")
		_, _ = w.Write(packed)
	}))
	t.Cleanup(server.Close)
	return server.URL + "/dns-query"
}
