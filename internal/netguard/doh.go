package netguard

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"strings"

	"golang.org/x/net/dns/dnsmessage"
)

// maxDNSReply bounds a resolver's answer; a DNS message is at most 64 KB.
const maxDNSReply = 64 << 10

// resolveOverHTTPS asks the DNS-over-HTTPS resolver at resolverURL (RFC
// 8484) for a name's addresses: its IPv4 ones, or its IPv6 ones when it
// has no IPv4.
func resolveOverHTTPS(ctx context.Context, client *http.Client, resolverURL, name string) ([]netip.Addr, error) {
	for _, recordType := range []dnsmessage.Type{dnsmessage.TypeA, dnsmessage.TypeAAAA} {
		ips, err := queryOverHTTPS(ctx, client, resolverURL, name, recordType)
		if err != nil {
			return nil, err
		}
		if len(ips) > 0 {
			return ips, nil
		}
	}
	return nil, fmt.Errorf("%s: no addresses", name)
}

func queryOverHTTPS(ctx context.Context, client *http.Client, resolverURL, name string, recordType dnsmessage.Type) ([]netip.Addr, error) {
	question, err := dnsmessage.NewName(strings.TrimSuffix(name, ".") + ".")
	if err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	query := dnsmessage.Message{
		Header:    dnsmessage.Header{RecursionDesired: true},
		Questions: []dnsmessage.Question{{Name: question, Type: recordType, Class: dnsmessage.ClassINET}},
	}
	packed, err := query.Pack()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, resolverURL, bytes.NewReader(packed))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/dns-message")
	req.Header.Set("Accept", "application/dns-message")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("look up %s: %w", name, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("look up %s: the resolver answered %s", name, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDNSReply))
	if err != nil {
		return nil, fmt.Errorf("look up %s: %w", name, err)
	}
	var reply dnsmessage.Message
	if err := reply.Unpack(body); err != nil {
		return nil, fmt.Errorf("look up %s: %w", name, err)
	}
	if reply.RCode != dnsmessage.RCodeSuccess {
		return nil, fmt.Errorf("look up %s: %s", name, reply.RCode)
	}
	var ips []netip.Addr
	for _, answer := range reply.Answers {
		switch record := answer.Body.(type) {
		case *dnsmessage.AResource:
			ips = append(ips, netip.AddrFrom4(record.A))
		case *dnsmessage.AAAAResource:
			ips = append(ips, netip.AddrFrom16(record.AAAA))
		}
	}
	return ips, nil
}
