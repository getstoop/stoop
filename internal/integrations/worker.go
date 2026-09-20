package integrations

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"strconv"
	"time"

	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/diag"
	"github.com/getstoop/stoop/internal/netguard"
)

// The worker: lease, POST, ack. Two steps that never share a goroutine
// with the subscriber. See docs/architecture/integrations.md → Outgoing.

const (
	leaseFor        = 30 * time.Second
	attemptTimeout  = 10 * time.Second
	leaseBatch      = 16
	maxAttempts     = 4
	responseKeep    = 500
	deadToDisable   = 20
	workerBackstop  = 5 * time.Second
	userAgentPrefix = "Stoop/"
	userAgent       = userAgentPrefix + "0.1 (+https://github.com/getstoop/stoop)"
	signatureScheme = "v1"
)

// defaultLadder is the wait before attempts 2, 3 and 4.
var defaultLadder = []time.Duration{5 * time.Second, 30 * time.Second, 2 * time.Minute}

// sign is the Stoop-Signature value: t=<unix>,v1=<hex HMAC-SHA256 over
// "<t>.<body>">.
func sign(secret []byte, t time.Time, body []byte) string {
	ts := strconv.FormatInt(t.Unix(), 10)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(ts))
	mac.Write([]byte("."))
	mac.Write(body)
	return "t=" + ts + "," + signatureScheme + "=" + hex.EncodeToString(mac.Sum(nil))
}

var webhookWorker = diag.NewJob("webhook_worker").Continuous()

// RunWorker delivers leased items until ctx ends, woken by enqueue and by
// a backstop ticker.
func (s *Service) RunWorker(ctx context.Context) {
	if s.queue == nil {
		return
	}
	t := time.NewTicker(workerBackstop)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
		case <-t.C:
		}
		for {
			var n int
			var err error
			webhookWorker.Run(func() (diag.Counters, error) {
				var delivered, failed int
				delivered, failed, err = s.deliverOnce(ctx)
				n = delivered + failed
				return diag.Counters{"delivered": int64(delivered), "failed": int64(failed)}, err
			})
			if err != nil && ctx.Err() == nil {
				s.log.Error("deliver hooks", "err", err)
			}
			if n == 0 || err != nil {
				break
			}
		}
	}
}

func (s *Service) wakeWorker() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// deliverOnce leases a batch and delivers each item; it reports how many
// of the leased items were delivered and how many were not. With
// outgoing off, queued items wait.
func (s *Service) deliverOnce(ctx context.Context) (delivered, failed int, err error) {
	if on, err := s.outgoingEnabled(ctx); err != nil || !on {
		return 0, 0, err
	}
	items, err := s.queue.Lease(ctx, leaseBatch, leaseFor)
	if err != nil {
		return 0, 0, err
	}
	for _, it := range items {
		ok, err := s.deliver(ctx, it)
		if err != nil && ctx.Err() == nil {
			s.log.Error("deliver hook item", "delivery", it.ID, "err", err)
		}
		if ok {
			delivered++
		} else {
			failed++
		}
	}
	return delivered, failed, nil
}

// deliver makes one attempt and settles the item; true is an ack.
func (s *Service) deliver(ctx context.Context, it Leased) (bool, error) {
	hook, err := s.q.GetOutgoingWebhook(ctx, it.Lane)
	if err != nil {
		return false, s.queue.Dead(ctx, it.ID, Attempt{Error: "webhook is gone"})
	}
	if hook.DisabledAt != nil {
		return false, s.queue.Dead(ctx, it.ID, Attempt{Error: "webhook is disabled"})
	}
	if it.Attempt > maxAttempts {
		return false, s.settleDead(ctx, hook, it, Attempt{Error: "lease expired on the last attempt"})
	}
	res := s.attempt(ctx, hook, it)
	switch {
	case res.StatusCode >= 200 && res.StatusCode < 300:
		return true, s.queue.Ack(ctx, it.ID, res.Attempt)
	case res.StatusCode == http.StatusGone:
		if err := s.disableOutgoing(ctx, hook.ID, "the receiver answered 410 Gone"); err != nil {
			return false, err
		}
		return false, s.queue.Dead(ctx, it.ID, res.Attempt)
	case res.StatusCode == http.StatusTooManyRequests && res.retryAfter > 0 && it.Attempt < maxAttempts:
		return false, s.queue.Nack(ctx, it.ID, min(res.retryAfter, s.ladderRemaining(it.Attempt)), res.Attempt)
	case it.Attempt < maxAttempts:
		return false, s.queue.Nack(ctx, it.ID, s.backoff(it.Attempt), res.Attempt)
	default:
		return false, s.settleDead(ctx, hook, it, res.Attempt)
	}
}

// attemptResult is what one POST learned.
type attemptResult struct {
	Attempt
	retryAfter time.Duration
}

func (s *Service) attempt(ctx context.Context, hook dbgen.OutgoingWebhook, it Leased) attemptResult {
	ctx, cancel := context.WithTimeout(ctx, attemptTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, hook.Url, bytes.NewReader(it.Body))
	if err != nil {
		return attemptResult{Attempt: Attempt{Error: err.Error()}}
	}
	now := s.now()
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Stoop-Event", it.Event)
	req.Header.Set("Stoop-Delivery", it.ID)
	req.Header.Set("Stoop-Sequence", strconv.FormatUint(it.Sequence, 10))
	req.Header.Set("Stoop-Attempt", strconv.Itoa(it.Attempt))
	req.Header.Set("Stoop-Signature", sign(hook.Secret, now, it.Body))
	client, err := s.egressClient(ctx)
	if err != nil {
		return attemptResult{Attempt: Attempt{Error: err.Error()}}
	}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, netguard.ErrNotPublic) {
			_ = s.disableOutgoing(ctx, hook.ID, "its address is not allowed by this server's egress policy")
		}
		return attemptResult{Attempt: Attempt{Error: clip(err.Error(), responseKeep)}}
	}
	defer func() { _ = resp.Body.Close() }()
	head, _ := io.ReadAll(io.LimitReader(resp.Body, responseKeep))
	out := attemptResult{Attempt: Attempt{StatusCode: resp.StatusCode, Response: string(head)}}
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		out.Error = "redirects are not followed"
	}
	if ra, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && ra > 0 {
		out.retryAfter = time.Duration(ra) * time.Second
	}
	return out
}

// egressClient is a client under the operator's private-target policy,
// never following redirects.
func (s *Service) egressClient(ctx context.Context) (*http.Client, error) {
	allow := false
	if s.policy != nil {
		var err error
		if allow, err = s.policy.WebhooksAllowPrivateTargets(ctx); err != nil {
			return nil, err
		}
	}
	transport := s.egress.public
	if allow {
		transport = s.egress.private
	}
	return &http.Client{
		Transport: transport,
		Timeout:   attemptTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}, nil
}

// settleDead dead-letters the item and disables the hook after too many
// consecutive dead deliveries.
func (s *Service) settleDead(ctx context.Context, hook dbgen.OutgoingWebhook, it Leased, res Attempt) error {
	if err := s.queue.Dead(ctx, it.ID, res); err != nil {
		return err
	}
	recent, err := s.q.ListDeliveriesByLane(ctx, dbgen.ListDeliveriesByLaneParams{Lane: hook.ID, Limit: deadToDisable})
	if err != nil {
		return fmt.Errorf("list deliveries: %w", err)
	}
	if len(recent) < deadToDisable {
		return nil
	}
	for _, d := range recent {
		if d.FinishedAt == nil || (d.StatusCode != nil && *d.StatusCode >= 200 && *d.StatusCode < 300) {
			return nil
		}
	}
	return s.disableOutgoing(ctx, hook.ID, fmt.Sprintf("%d deliveries in a row failed", deadToDisable))
}

func (s *Service) disableOutgoing(ctx context.Context, id, reason string) error {
	if err := s.q.DisableOutgoingWebhook(ctx, dbgen.DisableOutgoingWebhookParams{ID: id, DisabledReason: reason}); err != nil {
		return fmt.Errorf("disable hook: %w", err)
	}
	s.log.Warn("outgoing webhook disabled", "hook", id, "reason", reason)
	return nil
}

// backoff is the wait before the next attempt, jittered by up to 20%.
func (s *Service) backoff(attempt int) time.Duration {
	i := attempt - 1
	if i < 0 {
		i = 0
	}
	if i >= len(s.ladder) {
		i = len(s.ladder) - 1
	}
	d := s.ladder[i]
	if d == 0 {
		return 0
	}
	return d + time.Duration(rand.Int64N(int64(d)/5+1))
}

// ladderRemaining bounds a Retry-After by the time the ladder would have
// taken from this attempt.
func (s *Service) ladderRemaining(attempt int) time.Duration {
	var total time.Duration
	for i := attempt - 1; i < len(s.ladder) && i >= 0; i++ {
		total += s.ladder[i]
	}
	return total
}

func clip(str string, n int) string {
	if len(str) <= n {
		return str
	}
	return str[:n]
}
