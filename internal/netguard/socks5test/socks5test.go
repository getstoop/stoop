// Package socks5test is a SOCKS5 proxy for tests: it takes CONNECT with
// no authentication, records the host each request named, and dials
// every one of them to the address it was started with.
package socks5test

import (
	"encoding/binary"
	"io"
	"net"
	"strconv"
	"sync"
	"testing"
)

type Proxy struct {
	// Addr is the proxy's host:port.
	Addr string

	mu    sync.Mutex
	hosts []string
}

// Start runs a proxy until the test ends. Whatever a client asks for is
// connected to target (host:port).
func Start(t *testing.T, target string) *Proxy {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	started := &Proxy{Addr: listener.Addr().String()}
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go started.serve(conn, target)
		}
	}()
	return started
}

// Hosts is every host:port a client asked for, in order.
func (p *Proxy) Hosts() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.hosts...)
}

func (p *Proxy) serve(client net.Conn, target string) {
	defer func() { _ = client.Close() }()
	requested, err := handshake(client)
	if err != nil {
		return
	}
	p.mu.Lock()
	p.hosts = append(p.hosts, requested)
	p.mu.Unlock()
	upstream, err := net.Dial("tcp", target)
	if err != nil {
		_, _ = client.Write([]byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0})
		return
	}
	defer func() { _ = upstream.Close() }()
	if _, err := client.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}); err != nil {
		return
	}
	go func() { _, _ = io.Copy(upstream, client) }()
	_, _ = io.Copy(client, upstream)
}

// handshake reads the greeting and the CONNECT request, and returns the
// host:port asked for, as the client wrote it.
func handshake(client net.Conn) (string, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(client, header); err != nil {
		return "", err
	}
	if _, err := io.ReadFull(client, make([]byte, header[1])); err != nil {
		return "", err
	}
	if _, err := client.Write([]byte{5, 0}); err != nil {
		return "", err
	}
	request := make([]byte, 4)
	if _, err := io.ReadFull(client, request); err != nil {
		return "", err
	}
	var host string
	switch request[3] {
	case 1, 4:
		size := net.IPv4len
		if request[3] == 4 {
			size = net.IPv6len
		}
		address := make(net.IP, size)
		if _, err := io.ReadFull(client, address); err != nil {
			return "", err
		}
		host = address.String()
	default:
		length := make([]byte, 1)
		if _, err := io.ReadFull(client, length); err != nil {
			return "", err
		}
		name := make([]byte, length[0])
		if _, err := io.ReadFull(client, name); err != nil {
			return "", err
		}
		host = string(name)
	}
	port := make([]byte, 2)
	if _, err := io.ReadFull(client, port); err != nil {
		return "", err
	}
	return net.JoinHostPort(host, strconv.Itoa(int(binary.BigEndian.Uint16(port)))), nil
}
