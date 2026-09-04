package tailnet

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"strconv"
	"sync"
	"testing"
	"time"
)

// loopback stands in for the tsnet node: the relay logic is the same
// whether the packets arrived over WireGuard or over lo0.
type loopback struct{}

func (loopback) Listen(network, addr string) (net.Listener, error) {
	return net.Listen(network, addr)
}

func (loopback) ListenPacket(network, addr string) (net.PacketConn, error) {
	return net.ListenPacket(network, addr)
}

// freePort returns a port nothing is listening on, for both udp and tcp.
func freePort(t *testing.T) int {
	t.Helper()
	pc, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("probe udp: %v", err)
	}
	port := pc.LocalAddr().(*net.UDPAddr).Port
	_ = pc.Close()
	return port
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// testForwarder wires a forwarder onto loopback with its host dialers
// redirected at fakes, so the node side and the host side can use
// different ports on one machine. It records the addresses the forwarder
// asked for, which is the part the redirection would otherwise hide.
type dialLog struct {
	mu    sync.Mutex
	tcp   []string
	udp   []string
	udpTo string // where udp dials are actually sent
	tcpTo string
}

func (d *dialLog) counts() (tcp, udp int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.tcp), len(d.udp)
}

func newTestForwarder(t *testing.T, media Media, d *dialLog) *forwarder {
	t.Helper()
	f := newForwarder(media, netip.MustParseAddr("127.0.0.1"), loopback{}, quietLogger())
	f.dialTCP = func(ctx context.Context, addr string) (net.Conn, error) {
		d.mu.Lock()
		d.tcp = append(d.tcp, addr)
		d.mu.Unlock()
		var dl net.Dialer
		return dl.DialContext(ctx, "tcp", d.tcpTo)
	}
	f.dialUDP = func(addr string) (net.Conn, error) {
		d.mu.Lock()
		d.udp = append(d.udp, addr)
		d.mu.Unlock()
		return net.Dial("udp", d.udpTo)
	}
	return f
}

// runForwarder starts one and waits until its listeners are up.
func runForwarder(t *testing.T, f *forwarder) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		f.Run(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("forwarder did not stop")
		}
	})
	select {
	case <-f.ready:
	case <-time.After(5 * time.Second):
		t.Fatal("forwarder did not start")
	}
}

func TestMediaEnabled(t *testing.T) {
	if (Media{}).Enabled() {
		t.Fatal("the zero Media should carry nothing")
	}
	full := Media{Host: "127.0.0.1", TCPPort: 7881, UDPStart: 50000, UDPEnd: 50100}
	if !full.Enabled() {
		t.Fatal("a configured Media should be enabled")
	}
	if got := full.Ports(); got != 101 {
		t.Fatalf("Ports() = %d, want 101", got)
	}
	// A range the wrong way round is a typo, not an empty range.
	if (Media{Host: "h", TCPPort: 1, UDPStart: 50100, UDPEnd: 50000}).Enabled() {
		t.Fatal("an inverted range should not be enabled")
	}
}

func TestForwarderCarriesUDPBothWays(t *testing.T) {
	// Fake LiveKit: echoes each datagram back with a marker.
	live, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = live.Close() }()
	go func() {
		buf := make([]byte, maxDatagram)
		for {
			n, from, err := live.ReadFrom(buf)
			if err != nil {
				return
			}
			_, _ = live.WriteTo(append([]byte("re:"), buf[:n]...), from)
		}
	}()

	udpPort := freePort(t)
	media := Media{Host: "10.0.0.9", TCPPort: freePort(t), UDPStart: udpPort, UDPEnd: udpPort}
	d := &dialLog{udpTo: live.LocalAddr().String(), tcpTo: "127.0.0.1:1"}
	f := newTestForwarder(t, media, d)
	runForwarder(t, f)

	node := netip.AddrPortFrom(netip.MustParseAddr("127.0.0.1"), uint16(udpPort)).String()
	peer, err := net.Dial("udp", node)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = peer.Close() }()

	reply := make([]byte, maxDatagram)
	for _, want := range []string{"re:one", "re:two"} {
		if _, err := peer.Write([]byte(want[3:])); err != nil {
			t.Fatal(err)
		}
		_ = peer.SetReadDeadline(time.Now().Add(5 * time.Second))
		n, err := peer.Read(reply)
		if err != nil {
			t.Fatalf("no reply for %q: %v", want, err)
		}
		if got := string(reply[:n]); got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	}

	// Both packets came from one peer, so one host socket serves them.
	_, udpDials := d.counts()
	if udpDials != 1 {
		t.Fatalf("dialed the host %d times for one flow, want 1", udpDials)
	}
	// And it dialed LiveKit on the matching port — the forwarder keeps
	// port numbers identical on both sides, because LiveKit advertises
	// them as candidates.
	d.mu.Lock()
	asked := d.udp[0]
	d.mu.Unlock()
	if want := net.JoinHostPort("10.0.0.9", strconv.Itoa(udpPort)); asked != want {
		t.Fatalf("dialed %q, want %q", asked, want)
	}

	// A second peer is a second flow with its own socket.
	other, err := net.Dial("udp", node)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = other.Close() }()
	if _, err := other.Write([]byte("three")); err != nil {
		t.Fatal(err)
	}
	_ = other.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := other.Read(reply); err != nil {
		t.Fatalf("second peer got no reply: %v", err)
	}
	if _, udpDials = d.counts(); udpDials != 2 {
		t.Fatalf("dialed the host %d times for two flows, want 2", udpDials)
	}
}

func TestForwarderCarriesTCP(t *testing.T) {
	// Fake LiveKit ICE-TCP: uppercase-free echo.
	live, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = live.Close() }()
	go func() {
		for {
			c, err := live.Accept()
			if err != nil {
				return
			}
			go func() {
				defer func() { _ = c.Close() }()
				_, _ = io.Copy(c, c)
			}()
		}
	}()

	tcpPort := freePort(t)
	udpPort := freePort(t)
	media := Media{Host: "10.0.0.9", TCPPort: tcpPort, UDPStart: udpPort, UDPEnd: udpPort}
	d := &dialLog{udpTo: "127.0.0.1:1", tcpTo: live.Addr().String()}
	f := newTestForwarder(t, media, d)
	runForwarder(t, f)

	peer, err := net.Dial("tcp", netip.AddrPortFrom(netip.MustParseAddr("127.0.0.1"), uint16(tcpPort)).String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = peer.Close() }()
	if _, err := peer.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 5)
	_ = peer.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.ReadFull(peer, buf); err != nil {
		t.Fatalf("no echo: %v", err)
	}
	if string(buf) != "hello" {
		t.Fatalf("got %q, want %q", buf, "hello")
	}
	tcpDials, _ := d.counts()
	if tcpDials != 1 {
		t.Fatalf("dialed the host %d times, want 1", tcpDials)
	}
	d.mu.Lock()
	asked := d.tcp[0]
	d.mu.Unlock()
	if want := net.JoinHostPort("10.0.0.9", strconv.Itoa(tcpPort)); asked != want {
		t.Fatalf("dialed %q, want %q", asked, want)
	}
}

// A peer spraying spoofed source addresses must not grow the session map
// without bound, and a flow that goes quiet must give its socket back.
func TestUDPRelaySessionsAreBoundedAndReaped(t *testing.T) {
	f := newForwarder(Media{Host: "127.0.0.1", TCPPort: 1, UDPStart: 2, UDPEnd: 2},
		netip.MustParseAddr("127.0.0.1"), loopback{}, quietLogger())
	var opened int
	f.dialUDP = func(string) (net.Conn, error) {
		opened++
		c, err := net.Dial("udp", "127.0.0.1:9")
		return c, err
	}
	pc, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = pc.Close() }()
	f.idle = 10 * time.Millisecond
	f.sweep = 5 * time.Millisecond
	r := newUDPRelay(f, pc, 2)
	defer r.closeAll()

	for i := range maxSessionsPerPort {
		src := &net.UDPAddr{IP: net.IPv4(10, 0, byte(i/256), byte(i%256)), Port: 1000}
		if r.session(src) == nil {
			t.Fatalf("session %d was refused early", i)
		}
	}
	over := &net.UDPAddr{IP: net.IPv4(10, 1, 1, 1), Port: 1000}
	if r.session(over) != nil {
		t.Fatalf("session past the %d cap was accepted", maxSessionsPerPort)
	}
	if opened != maxSessionsPerPort {
		t.Fatalf("opened %d host sockets, want %d", opened, maxSessionsPerPort)
	}

	// Age every flow, then let the reaper run: the cap frees up again.
	r.mu.Lock()
	stale := time.Now().Add(-time.Second).UnixNano()
	for _, s := range r.sessions {
		s.last.Store(stale)
	}
	r.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go r.reap(ctx)
	deadline := time.Now().Add(5 * time.Second)
	for {
		r.mu.Lock()
		n := len(r.sessions)
		r.mu.Unlock()
		if n == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d idle sessions were never reaped", n)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if r.session(over) == nil {
		t.Fatal("a new flow was refused after the idle ones were reaped")
	}
}

// A port that will not open is skipped, not fatal: a partial range beats
// silence, and the HTTPS listener must survive it.
func TestForwarderSurvivesAPortItCannotOpen(t *testing.T) {
	taken, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = taken.Close() }()
	blocked := taken.LocalAddr().(*net.UDPAddr).Port
	free := freePort(t)

	lo, hi := blocked, free
	if lo > hi {
		lo, hi = hi, lo
	}
	media := Media{Host: "10.0.0.9", TCPPort: freePort(t), UDPStart: lo, UDPEnd: hi}
	d := &dialLog{udpTo: "127.0.0.1:1", tcpTo: "127.0.0.1:1"}
	f := newTestForwarder(t, media, d)
	runForwarder(t, f)

	if open := f.open.Load(); open == 0 || open >= int64(media.Ports()) {
		t.Fatalf("opened %d of %d ports; want some but not the taken one", open, media.Ports())
	}
}

// BenchmarkUDPRelayRoundTrip measures what the relay itself costs per
// datagram — the work Stoop adds on top of WireGuard. Voice is a few
// dozen packets a second per participant and a 1080p screen share a few
// hundred, so this wants to be comfortably ahead of both.
func BenchmarkUDPRelayRoundTrip(b *testing.B) {
	live, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		b.Fatal(err)
	}
	defer func() { _ = live.Close() }()
	go func() {
		buf := make([]byte, maxDatagram)
		for {
			n, from, err := live.ReadFrom(buf)
			if err != nil {
				return
			}
			_, _ = live.WriteTo(buf[:n], from)
		}
	}()

	pc, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		b.Fatal(err)
	}
	port := pc.LocalAddr().(*net.UDPAddr).Port
	f := newForwarder(Media{Host: "127.0.0.1", TCPPort: 1, UDPStart: port, UDPEnd: port},
		netip.MustParseAddr("127.0.0.1"), loopback{}, quietLogger())
	target := live.LocalAddr().String()
	f.dialUDP = func(string) (net.Conn, error) { return net.Dial("udp", target) }

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go newUDPRelay(f, pc, port).run(ctx)

	peer, err := net.Dial("udp", pc.LocalAddr().String())
	if err != nil {
		b.Fatal(err)
	}
	defer func() { _ = peer.Close() }()

	// A typical RTP packet.
	payload := make([]byte, 1200)
	reply := make([]byte, maxDatagram)
	b.SetBytes(int64(len(payload)))
	b.ResetTimer()
	for range b.N {
		if _, err := peer.Write(payload); err != nil {
			b.Fatal(err)
		}
		_ = peer.SetReadDeadline(time.Now().Add(2 * time.Second))
		if _, err := peer.Read(reply); err != nil {
			b.Fatal(err)
		}
	}
}
