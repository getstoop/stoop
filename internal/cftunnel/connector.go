package cftunnel

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	pollEvery  = 2 * time.Second
	maxBackoff = 30 * time.Second
)

type Options struct {
	Path       string
	Token      string
	OriginPort string
}

// Connector supervises one cloudflared process: starts it, restarts it
// with backoff when it exits, and reads its state from the metrics
// endpoint cloudflared serves on loopback.
type Connector struct {
	opts Options
	log  *slog.Logger

	mu sync.Mutex
	st Status
}

func New(opts Options, log *slog.Logger) *Connector {
	return &Connector{opts: opts, log: log, st: Status{State: "starting"}}
}

func (c *Connector) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.st
}

func (c *Connector) set(fn func(*Status)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	fn(&c.st)
}

// Run keeps cloudflared running until ctx is done.
func (c *Connector) Run(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		started := time.Now()
		err := c.runOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		c.log.Warn("cloudflare tunnel: cloudflared stopped; retrying", "err", err, "in", backoff)
		if time.Since(started) > time.Minute {
			backoff = time.Second
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, maxBackoff)
	}
}

func (c *Connector) runOnce(ctx context.Context) error {
	bin, err := lookPath(c.opts.Path)
	if err != nil {
		c.set(func(s *Status) { *s = Status{State: "missing"} })
		return err
	}
	metrics, err := freeLoopbackAddr()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "tunnel", "--no-autoupdate", "--metrics", metrics, "run")
	// The token goes in the environment, where `ps` doesn't show it.
	cmd.Env = append(os.Environ(), "TUNNEL_TOKEN="+c.opts.Token, "TUNNEL_LOG_OUTPUT=json")
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	cmd.WaitDelay = 10 * time.Second
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	c.set(func(s *Status) {
		if s.State == "missing" {
			s.State = "starting"
		}
	})
	go c.poll(ctx, metrics)
	c.readLog(stderr)
	err = cmd.Wait()
	c.set(func(s *Status) {
		s.URL = ""
		if s.State == "running" {
			s.State = "starting"
		}
	})
	return err
}

// readLog forwards cloudflared's log and keeps its latest error for the
// status. Lines are JSON when cloudflared honours TUNNEL_LOG_OUTPUT.
func (c *Connector) readLog(r io.Reader) {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := sc.Text()
		var entry struct {
			Level   string `json:"level"`
			Message string `json:"message"`
			Error   string `json:"error"`
		}
		if json.Unmarshal([]byte(line), &entry) != nil {
			entry.Message = line
			if strings.Contains(line, " ERR ") {
				entry.Level = "error"
			}
		}
		if entry.Level != "error" && entry.Level != "fatal" {
			c.log.Debug("cloudflared", "msg", entry.Message)
			continue
		}
		msg := entry.Message
		if entry.Error != "" {
			msg += ": " + entry.Error
		}
		msg = friendly(msg)
		// cloudflared repeats itself on every retry; say it once.
		level := slog.LevelDebug
		c.set(func(s *Status) {
			if s.State == "running" {
				return
			}
			if s.Error != msg {
				level = slog.LevelWarn
			}
			s.State, s.Error = "error", msg
		})
		c.log.Log(context.Background(), level, "cloudflared", "msg", msg)
	}
}

func friendly(msg string) string {
	if strings.Contains(msg, "Unauthorized") || strings.Contains(msg, "Invalid tunnel secret") {
		return "Cloudflare rejected the token."
	}
	if len(msg) > 200 {
		msg = msg[:200]
	}
	return msg
}

// poll reads /ready (is the tunnel connected) and /config (which
// hostname it carries) until ctx is done.
func (c *Connector) poll(ctx context.Context, metrics string) {
	t := time.NewTicker(pollEvery)
	defer t.Stop()
	for {
		var ready struct {
			ReadyConnections int `json:"readyConnections"`
		}
		if getJSON(ctx, "http://"+metrics+"/ready", &ready) == nil && ready.ReadyConnections > 0 {
			var cfg configBody
			url := ""
			if getJSON(ctx, "http://"+metrics+"/config", &cfg) == nil {
				url = cfg.publicURL(c.opts.OriginPort)
			}
			c.set(func(s *Status) { *s = Status{State: "running", URL: url} })
		} else {
			c.set(func(s *Status) {
				if s.State == "running" {
					*s = Status{State: "starting"}
				}
			})
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// configBody is the part of cloudflared's /config this package reads.
type configBody struct {
	Config struct {
		Ingress []struct {
			Hostname string `json:"hostname"`
			Service  any    `json:"service"`
		} `json:"ingress"`
	} `json:"config"`
}

// publicURL picks this server's hostname out of the tunnel's rules: the
// one whose service is this machine on originPort, else the first one.
func (b configBody) publicURL(originPort string) string {
	first := ""
	for _, r := range b.Config.Ingress {
		if r.Hostname == "" || strings.Contains(r.Hostname, "*") {
			continue
		}
		if first == "" {
			first = r.Hostname
		}
		service, _ := r.Service.(string)
		for _, host := range []string{"localhost", "127.0.0.1", "[::1]"} {
			if strings.TrimSuffix(service, "/") == "http://"+host+":"+originPort {
				return "https://" + r.Hostname
			}
		}
	}
	if first == "" {
		return ""
	}
	return "https://" + first
}

// Loopback only, so never through a proxy from the environment.
var metricsClient = &http.Client{Transport: &http.Transport{}}

func getJSON(ctx context.Context, url string, into any) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := metricsClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	// /ready answers 503 with the same body while nothing is connected.
	if resp.StatusCode != 200 && resp.StatusCode != 503 {
		return fmt.Errorf("%s: %s", url, resp.Status)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(into)
}

func freeLoopbackAddr() (string, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", errors.Join(errors.New("no free port for cloudflared's metrics"), err)
	}
	addr := l.Addr().String()
	return addr, l.Close()
}
