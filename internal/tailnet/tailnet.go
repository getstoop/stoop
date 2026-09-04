// Package tailnet embeds a Tailscale node in the binary (tsnet) and serves
// the app over HTTPS on its tailnet address. It is one optional front door
// among several — the plain HTTP listener always runs too — so an operator
// with their own reverse proxy or tunnel never pays for it.
//
// tsnet runs in userspace (netstack): no TUN device, no root, nothing else
// installed on the host, and it works from behind CGNAT. The node's
// identity lives in Options.StateDir so it survives restarts.
package tailnet

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"tailscale.com/tsnet"
	"tailscale.com/types/logger"
)

const (
	adminDNSURL = "https://login.tailscale.com/admin/dns"
	adminACLURL = "https://login.tailscale.com/admin/acls"
)

type Options struct {
	Hostname   string
	AuthKey    string
	ControlURL string
	StateDir   string
	Funnel     bool
	Media      Media
	OnAddress  func(ip string)
}

type Server struct {
	opts    Options
	log     *slog.Logger
	ts      *tsnet.Server
	url     atomic.Value // string; "" until Up has succeeded
	ip      atomic.Value // string; the node's tailnet IPv4, "" until Up
	lastErr atomic.Value // string; the most recent problem worth showing
	media   atomic.Bool  // true while media is being carried
	ready   atomic.Bool
}

func (s *Server) setErr(err error) {
	if err == nil {
		s.lastErr.Store("")
		return
	}
	s.lastErr.Store(err.Error())
}

// PublicURL is the https address of the node, or "" until it has joined.
func (s *Server) PublicURL() string {
	u, _ := s.url.Load().(string)
	return u
}

// The node's tailnet IPv4, or "" until it has joined.
func (s *Server) TailnetIP() string {
	ip, _ := s.ip.Load().(string)
	return ip
}

// Status is what the setup wizard and admin page show.
type Status struct {
	State     string // needs_login, starting, running, stopped
	LoginURL  string
	URL       string
	Funnel    bool
	Error     string
	TailnetIP string
	Media     bool
}

// Status reports the node's state, including the login URL while it is
// waiting to be authorised.
func (s *Server) Status(ctx context.Context) Status {
	st := Status{Funnel: s.opts.Funnel, URL: s.PublicURL(), TailnetIP: s.TailnetIP(), Media: s.media.Load()}
	st.Error, _ = s.lastErr.Load().(string)
	lc, err := s.ts.LocalClient()
	if err != nil {
		st.State, st.Error = "error", err.Error()
		return st
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	ipn, err := lc.StatusWithoutPeers(ctx)
	if err != nil {
		st.State, st.Error = "error", err.Error()
		return st
	}
	switch ipn.BackendState {
	case "NeedsLogin":
		st.State, st.LoginURL = "needs_login", ipn.AuthURL
	case "Running":
		st.State = "running"
		if !s.ready.Load() {
			st.State = "starting"
		}
		if st.URL == "" && ipn.Self != nil && ipn.Self.DNSName != "" {
			st.URL = "https://" + strings.TrimSuffix(ipn.Self.DNSName, ".")
		}
	case "Stopped", "NoState":
		st.State = "stopped"
	default:
		st.State = "starting"
	}
	return st
}

func New(opts Options, log *slog.Logger) *Server {
	ts := &tsnet.Server{
		Dir:        opts.StateDir,
		Hostname:   opts.Hostname,
		AuthKey:    opts.AuthKey,
		ControlURL: opts.ControlURL,
		// tsnet's own logging is very chatty; user-facing lines (the login
		// URL, key expiry) are the ones worth surfacing.
		Logf: logger.Discard,
		UserLogf: func(format string, args ...any) {
			log.Info("tailscale: " + strings.TrimSpace(fmt.Sprintf(format, args...)))
		},
	}
	return &Server{opts: opts, log: log, ts: ts}
}

// Serve joins the tailnet (blocking until the node is authorised — on a
// first run without an auth key, the login URL is logged), then serves
// handler over HTTPS on port 443 of the tailnet address (and redirects
// port 80) until ctx is done.
func (s *Server) listenTLS(ctx context.Context) (net.Listener, error) {
	const retry = 30 * time.Second
	warned := false
	for {
		var ln net.Listener
		var err error
		if s.opts.Funnel {
			ln, err = s.ts.ListenFunnel("tcp", ":443")
		} else {
			ln, err = s.ts.ListenTLS("tcp", ":443")
		}
		if err == nil {
			s.setErr(nil)
			return ln, nil
		}
		s.setErr(err)
		if !warned {
			hint, at := "enable HTTPS certificates for the tailnet", adminDNSURL
			if s.opts.Funnel && strings.Contains(err.Error(), "funnel") {
				hint, at = "add the \"funnel\" node attribute to the tailnet policy", adminACLURL
			}
			s.log.Warn("tailscale: cannot serve yet; retrying every 30s. If this persists, "+hint,
				"err", err, "fix_at", at)
			warned = true
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(retry):
		}
	}
}

func (s *Server) Serve(ctx context.Context, handler http.Handler) error {
	defer func() { _ = s.ts.Close() }()

	s.log.Info("tailscale: joining tailnet", "hostname", s.opts.Hostname, "state_dir", s.opts.StateDir)
	st, err := s.ts.Up(ctx)
	if err != nil {
		if ctx.Err() == nil {
			s.setErr(err)
		}
		return fmt.Errorf("tailscale up: %w", err)
	}
	host := strings.TrimSuffix(st.Self.DNSName, ".")
	s.url.Store("https://" + host)

	ip4, _ := s.ts.TailscaleIPs()
	if ip4.IsValid() {
		s.ip.Store(ip4.String())
	}
	if s.opts.OnAddress != nil {
		var addr string
		if ip4.IsValid() {
			addr = ip4.String()
		}
		s.opts.OnAddress(addr)
		// The address goes away with the node, so whoever acted on it can
		// undo that when this one stops.
		defer s.opts.OnAddress("")
	}

	if s.opts.Media.Enabled() {
		if !ip4.IsValid() {
			s.log.Warn("tailscale: no tailnet IPv4 yet, so voice media is not being carried; restart once the node has an address")
		} else {
			s.media.Store(true)
			defer s.media.Store(false)
			go newForwarder(s.opts.Media, ip4, s.ts, s.log).Run(ctx)
		}
	}

	// Everything a caller reads about a running node is now set.
	s.ready.Store(true)
	defer s.ready.Store(false)

	tls, err := s.listenTLS(ctx)
	if errors.Is(err, context.Canceled) {
		return nil
	}
	if err != nil {
		return err
	}
	plain, err := s.ts.Listen("tcp", ":80")
	if err != nil {
		return fmt.Errorf("tailscale listen :80: %w", err)
	}

	s.log.Info("tailscale: serving", "url", s.PublicURL(), "funnel", s.opts.Funnel)

	https := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	redirect := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, s.PublicURL()+r.URL.RequestURI(), http.StatusMovedPermanently)
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}
	errCh := make(chan error, 2)
	go func() { errCh <- https.Serve(tls) }()
	go func() { errCh <- redirect.Serve(plain) }()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("tailscale serve: %w", err)
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = redirect.Shutdown(shutdownCtx)
	return https.Shutdown(shutdownCtx)
}
