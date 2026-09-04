package tailnet

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// tsnet runs in userspace: a packet addressed to the node is decrypted
// inside this process and never reaches a socket the host itself owns. The
// HTTPS front door works because we hand tsnet an http.Server. LiveKit's
// media ports need the same treatment, and LiveKit is a separate process —
// so Stoop listens on the node for those ports and relays each flow to
// LiveKit on the host. Nothing is installed on the machine, and the tailnet
// carries voice as well as chat.
//
// The other half is LiveKit advertising the node's address as an ICE
// candidate (`rtc.node_ip`); Status reports the address so the admin page
// and the docs can spell out that line.

// Media says where LiveKit's media endpoints live on the host. The zero
// value means "don't carry media", which is what a server without voice
// configured wants.
type Media struct {
	// LiveKit's address from this process, the loopback address
	// in compose, since the sidecar publishes these ports.
	Host    string
	TCPPort int
	// UDPStart and UDPEnd bound LiveKit's media range inclusively
	// (rtc.port_range_start/end, 50000–50100 by default).
	UDPStart int
	UDPEnd   int
}

// Enabled reports whether there is anything to carry.
func (m Media) Enabled() bool {
	return m.Host != "" && m.TCPPort > 0 && m.UDPStart > 0 && m.UDPEnd >= m.UDPStart
}

// Ports is how many UDP ports the range covers.
func (m Media) Ports() int { return m.UDPEnd - m.UDPStart + 1 }

const (
	maxDatagram        = 2048
	udpIdle            = 90 * time.Second
	maxSessionsPerPort = 256
)

// packetListener is the slice of tsnet.Server the forwarder needs, so the
// relay logic can be tested over loopback without a tailnet.
type packetListener interface {
	Listen(network, addr string) (net.Listener, error)
	ListenPacket(network, addr string) (net.PacketConn, error)
}

// forwarder relays LiveKit's media ports between the tailnet node and the
// host. One lives per running node.
type forwarder struct {
	media Media
	ip    netip.Addr
	ln    packetListener
	log   *slog.Logger

	// How the host is reached; replaced in tests.
	dialTCP func(ctx context.Context, addr string) (net.Conn, error)
	dialUDP func(addr string) (net.Conn, error)

	// How long a flow may go quiet, and how often that is checked.
	// Fields rather than constants so tests need not wait a minute.
	idle  time.Duration
	sweep time.Duration

	// ready is closed once every listener that is going to open has, so
	// tests need not poll.
	ready chan struct{}
	// open counts the UDP ports actually listening.
	open atomic.Int64
}

func newForwarder(media Media, ip netip.Addr, ln packetListener, log *slog.Logger) *forwarder {
	var d net.Dialer
	return &forwarder{
		media: media, ip: ip, ln: ln, log: log,
		dialTCP: func(ctx context.Context, addr string) (net.Conn, error) {
			return d.DialContext(ctx, "tcp", addr)
		},
		dialUDP: func(addr string) (net.Conn, error) { return net.Dial("udp", addr) },
		idle:    udpIdle,
		sweep:   udpIdle / 3,
		ready:   make(chan struct{}),
	}
}

func (f *forwarder) hostAddr(port int) string {
	return net.JoinHostPort(f.media.Host, strconv.Itoa(port))
}

func (f *forwarder) nodeAddr(port int) string {
	return netip.AddrPortFrom(f.ip, uint16(port)).String()
}

// Run carries media until ctx is done.
func (f *forwarder) Run(ctx context.Context) {
	var wg sync.WaitGroup

	if ln, err := f.ln.Listen("tcp", f.nodeAddr(f.media.TCPPort)); err != nil {
		f.log.Warn("tailscale: cannot carry LiveKit's TCP media port over the tailnet",
			"port", f.media.TCPPort, "err", err)
	} else {
		wg.Add(1)
		go func() {
			defer wg.Done()
			f.serveTCP(ctx, ln)
		}()
	}

	var firstErr error
	for port := f.media.UDPStart; port <= f.media.UDPEnd; port++ {
		pc, err := f.ln.ListenPacket("udp4", f.nodeAddr(port))
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		f.open.Add(1)
		wg.Add(1)
		go func(pc net.PacketConn, port int) {
			defer wg.Done()
			newUDPRelay(f, pc, port).run(ctx)
		}(pc, port)
	}
	if firstErr != nil {
		f.log.Warn("tailscale: some of LiveKit's UDP media ports would not open on the tailnet",
			"opened", f.open.Load(), "of", f.media.Ports(), "err", firstErr)
	}
	f.log.Info("tailscale: carrying voice media over the tailnet",
		"node_ip", f.ip, "udp_ports", f.open.Load(), "tcp_port", f.media.TCPPort,
		"livekit", f.media.Host)
	close(f.ready)

	<-ctx.Done()
	wg.Wait()
}

func (f *forwarder) serveTCP(ctx context.Context, ln net.Listener) {
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()
	var conns sync.WaitGroup
	defer conns.Wait()
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		conns.Add(1)
		go func() {
			defer conns.Done()
			f.pipeTCP(ctx, c)
		}()
	}
}

// pipeTCP joins one tailnet connection to a fresh one to LiveKit and
// copies until either end hangs up.
func (f *forwarder) pipeTCP(ctx context.Context, from net.Conn) {
	defer func() { _ = from.Close() }()
	to, err := f.dialTCP(ctx, f.hostAddr(f.media.TCPPort))
	if err != nil {
		f.log.Warn("tailscale: voice media: cannot reach LiveKit on the host",
			"addr", f.hostAddr(f.media.TCPPort), "err", err)
		return
	}
	defer func() { _ = to.Close() }()
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(to, from); done <- struct{}{} }()
	go func() { _, _ = io.Copy(from, to); done <- struct{}{} }()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

// udpSession is one peer's flow to a LiveKit media port: a connected
// socket on the host that its replies come back through.
type udpSession struct {
	host net.Conn
	last atomic.Int64 // unix nanos
}

func (s *udpSession) touch() { s.last.Store(time.Now().UnixNano()) }

func (s *udpSession) quietFor(now time.Time, d time.Duration) bool {
	return now.Sub(time.Unix(0, s.last.Load())) > d
}

// udpRelay carries one UDP port. UDP has no connections, so a flow is
// remembered by its source address: the first packet from a peer opens a
// socket to LiveKit, and replies on that socket go back to the peer.
type udpRelay struct {
	f      *forwarder
	pc     net.PacketConn
	target string

	mu       sync.Mutex
	sessions map[string]*udpSession
	full     bool // logged once when the cap is first hit
}

func newUDPRelay(f *forwarder, pc net.PacketConn, port int) *udpRelay {
	return &udpRelay{f: f, pc: pc, target: f.hostAddr(port), sessions: map[string]*udpSession{}}
}

func (r *udpRelay) run(ctx context.Context) {
	go func() {
		<-ctx.Done()
		_ = r.pc.Close()
	}()
	defer r.closeAll()
	go r.reap(ctx)

	buf := make([]byte, maxDatagram)
	for {
		n, src, err := r.pc.ReadFrom(buf)
		if err != nil {
			return
		}
		s := r.session(src)
		if s == nil {
			continue
		}
		s.touch()
		if _, err := s.host.Write(buf[:n]); err != nil {
			r.drop(src.String())
		}
	}
}

// session finds or opens the flow for src.
func (r *udpRelay) session(src net.Addr) *udpSession {
	key := src.String()
	r.mu.Lock()
	if s, ok := r.sessions[key]; ok {
		r.mu.Unlock()
		return s
	}
	if len(r.sessions) >= maxSessionsPerPort {
		full := r.full
		r.full = true
		r.mu.Unlock()
		if !full {
			r.f.log.Warn("tailscale: voice media: too many flows on one port; dropping new ones",
				"port", r.target, "limit", maxSessionsPerPort)
		}
		return nil
	}
	r.mu.Unlock()

	host, err := r.f.dialUDP(r.target)
	if err != nil {
		r.f.log.Warn("tailscale: voice media: cannot reach LiveKit on the host",
			"addr", r.target, "err", err)
		return nil
	}
	s := &udpSession{host: host}
	s.touch()

	r.mu.Lock()
	// Another packet from the same peer may have raced us here.
	if existing, ok := r.sessions[key]; ok {
		r.mu.Unlock()
		_ = host.Close()
		return existing
	}
	r.sessions[key] = s
	r.mu.Unlock()

	go r.pump(s, src)
	return s
}

// pump carries LiveKit's replies back to the peer.
func (r *udpRelay) pump(s *udpSession, src net.Addr) {
	defer r.drop(src.String())
	buf := make([]byte, maxDatagram)
	for {
		n, err := s.host.Read(buf)
		if err != nil {
			return
		}
		s.touch()
		if _, err := r.pc.WriteTo(buf[:n], src); err != nil {
			return
		}
	}
}

func (r *udpRelay) drop(key string) {
	r.mu.Lock()
	s, ok := r.sessions[key]
	delete(r.sessions, key)
	r.mu.Unlock()
	if ok {
		_ = s.host.Close()
	}
}

// reap releases the sockets of flows that have gone quiet. Closing one
// ends its pump goroutine.
func (r *udpRelay) reap(ctx context.Context) {
	t := time.NewTicker(r.f.sweep)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			var stale []string
			r.mu.Lock()
			for key, s := range r.sessions {
				if s.quietFor(now, r.f.idle) {
					stale = append(stale, key)
				}
			}
			r.mu.Unlock()
			for _, key := range stale {
				r.drop(key)
			}
		}
	}
}

func (r *udpRelay) closeAll() {
	r.mu.Lock()
	for _, s := range r.sessions {
		_ = s.host.Close()
	}
	r.sessions = map[string]*udpSession{}
	r.mu.Unlock()
}
