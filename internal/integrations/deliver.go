package integrations

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/netguard"
)

// The deliver_webhook kind: one attempt per call, performed by the jobs
// dispatcher through internal/app, and the log row it writes after each.
// See docs/architecture/integrations.md → Outgoing.

// DeliverWebhookKind is the job kind internal/app registers for deliveries.
const DeliverWebhookKind = "deliver_webhook"

const (
	attemptTimeout  = 10 * time.Second
	responseKeep    = 500
	deadToDisable   = 20
	userAgentPrefix = "Stoop/"
	userAgent       = userAgentPrefix + "0.1 (+https://github.com/getstoop/stoop)"
	signatureScheme = "v1"
	reasonOff       = "outgoing webhooks are turned off on this server"
)

// DeliveryBackoff is the wait before attempts 2, 3 and 4. internal/app
// registers the kind with it, and it bounds a receiver's Retry-After.
var DeliveryBackoff = []time.Duration{5 * time.Second, 30 * time.Second, 2 * time.Minute}

// DeliveryArgs is what one delivery needs, so the performer never joins
// against the log.
type DeliveryArgs struct {
	// DeliveryID is the log row and the Stoop-Delivery header.
	DeliveryID string          `json:"delivery_id"`
	HookID     string          `json:"hook_id"`
	Event      string          `json:"event"`
	Sequence   int64           `json:"sequence"`
	Body       json.RawMessage `json:"body"`
}

// DeliveryResult is one attempt's verdict for the dispatcher. Delivered
// and Dead finish the delivery; otherwise it is retried, after RetryAfter
// when set and on the kind's ladder when not.
type DeliveryResult struct {
	Delivered  bool
	Dead       bool
	RetryAfter time.Duration
	Error      string
}

type notSentError struct{ err error }

func (e *notSentError) Error() string { return e.err.Error() }
func (e *notSentError) Unwrap() error { return e.err }

// NotSent reports whether a DeliverWebhook error came before the POST, so
// the receiver heard nothing.
func NotSent(err error) bool {
	var notSent *notSentError
	return errors.As(err, &notSent)
}

// Attempt is what one try learned, as the log keeps it.
type Attempt struct {
	StatusCode int
	Error      string
}

// describe is the attempt as a one-line error.
func (a Attempt) describe() string {
	if a.Error != "" {
		return a.Error
	}
	return fmt.Sprintf("the receiver answered HTTP %d", a.StatusCode)
}

// verdict is one attempt and what follows from it.
type verdict struct {
	tried  Attempt
	result DeliveryResult
	// settle is set when a dead delivery counts toward disabling the
	// hook; not when the hook was already gone or disabled, and not when
	// the server's switch stopped it.
	settle bool
}

// sign is the Stoop-Signature value: t=<unix>,v1=<hex HMAC-SHA256 over
// "<t>.<body>">.
func sign(secret []byte, at time.Time, body []byte) string {
	unix := strconv.FormatInt(at.Unix(), 10)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(unix))
	mac.Write([]byte("."))
	mac.Write(body)
	return "t=" + unix + "," + signatureScheme + "=" + hex.EncodeToString(mac.Sum(nil))
}

// DeliverWebhook makes attempt of maxAttempts for one delivery, writes
// the log row and reports the verdict. The error is for a failure of the
// module's own (a query failed), which the dispatcher retries; NotSent
// tells one from before the POST, which shouldn't use up a try.
func (s *Service) DeliverWebhook(ctx context.Context, args DeliveryArgs, attempt, maxAttempts int) (DeliveryResult, error) {
	outcome, err := s.tryDelivery(ctx, args, attempt, maxAttempts)
	if err != nil {
		return DeliveryResult{}, err
	}
	if err := s.recordAttempt(ctx, args.DeliveryID, attempt, outcome); err != nil {
		return DeliveryResult{}, err
	}
	if outcome.settle {
		if err := s.settleDead(ctx, args.HookID); err != nil {
			return DeliveryResult{}, err
		}
	}
	return outcome.result, nil
}

// tryDelivery is the attempt and its verdict, before anything is written.
func (s *Service) tryDelivery(ctx context.Context, args DeliveryArgs, attempt, maxAttempts int) (verdict, error) {
	on, err := s.policy.WebhooksOutgoing(ctx)
	if err != nil {
		return verdict{}, &notSentError{fmt.Errorf("read the outgoing switch: %w", err)}
	}
	if !on {
		return deadVerdict(reasonOff, false), nil
	}
	hook, err := s.q.GetOutgoingWebhook(ctx, args.HookID)
	if errors.Is(err, pgx.ErrNoRows) {
		return deadVerdict("webhook is gone", false), nil
	}
	if err != nil {
		return verdict{}, &notSentError{fmt.Errorf("get hook: %w", err)}
	}
	if hook.DisabledAt != nil {
		return deadVerdict("webhook is disabled", false), nil
	}
	tried, retryAfter := s.post(ctx, hook, args, attempt)
	out := verdict{tried: tried, result: DeliveryResult{Error: tried.describe()}}
	switch {
	case tried.StatusCode >= 200 && tried.StatusCode < 300:
		out.result = DeliveryResult{Delivered: true}
	case tried.StatusCode == http.StatusGone:
		if err := s.disableOutgoing(ctx, hook.ID, "the receiver answered 410 Gone"); err != nil {
			return verdict{}, err
		}
		out.result.Dead = true
	case tried.StatusCode == http.StatusTooManyRequests && retryAfter > 0 && attempt < maxAttempts:
		out.result.RetryAfter = min(retryAfter, ladderRemaining(attempt))
	case attempt < maxAttempts:
	default:
		out.result.Dead = true
		out.settle = true
	}
	return out, nil
}

func deadVerdict(reason string, settle bool) verdict {
	return verdict{tried: Attempt{Error: reason}, result: DeliveryResult{Dead: true, Error: reason}, settle: settle}
}

// post makes the one POST and returns what it learned and the receiver's
// Retry-After, when it sent one.
func (s *Service) post(ctx context.Context, hook dbgen.OutgoingWebhook, args DeliveryArgs, attempt int) (Attempt, time.Duration) {
	ctx, cancel := context.WithTimeout(ctx, attemptTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, hook.Url, bytes.NewReader(args.Body))
	if err != nil {
		return Attempt{Error: err.Error()}, 0
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Stoop-Event", args.Event)
	req.Header.Set("Stoop-Delivery", args.DeliveryID)
	req.Header.Set("Stoop-Sequence", strconv.FormatInt(args.Sequence, 10))
	req.Header.Set("Stoop-Attempt", strconv.Itoa(attempt))
	req.Header.Set("Stoop-Signature", sign(hook.Secret, s.now(), args.Body))
	client, err := s.egressClient(ctx)
	if err != nil {
		return Attempt{Error: err.Error()}, 0
	}
	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, netguard.ErrNotPublic) {
			_ = s.disableOutgoing(ctx, hook.ID, "its address is not allowed by this server's egress policy")
		}
		return Attempt{Error: cutBytes(err.Error(), responseKeep)}, 0
	}
	defer func() { _ = resp.Body.Close() }()
	// The reply is the receiver's text: logged for an operator, never stored.
	head, _ := io.ReadAll(io.LimitReader(resp.Body, responseKeep))
	s.log.Debug("webhook reply", "delivery_id", args.DeliveryID, "status", resp.StatusCode, "body", string(head))
	tried := Attempt{StatusCode: resp.StatusCode}
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		tried.Error = "redirects are not followed"
	}
	var retryAfter time.Duration
	if seconds, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && seconds > 0 {
		retryAfter = time.Duration(seconds) * time.Second
	}
	return tried, retryAfter
}

// egressClient is a client under the operator's private-target policy,
// never following redirects.
func (s *Service) egressClient(ctx context.Context) (*http.Client, error) {
	allow, err := s.policy.WebhooksAllowPrivateTargets(ctx)
	if err != nil {
		return nil, err
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

// recordAttempt writes the attempt to the log row; a finished delivery
// gets its finish, and a delivered one loses its body.
func (s *Service) recordAttempt(ctx context.Context, deliveryID string, attempt int, outcome verdict) error {
	params := dbgen.RecordDeliveryAttemptParams{
		ID: deliveryID, Attempts: int32(attempt), StatusCode: statusPtr(outcome.tried.StatusCode),
		Error:     storableText(outcome.tried.Error),
		Delivered: outcome.result.Delivered,
	}
	if outcome.result.Delivered || outcome.result.Dead {
		now := s.now()
		params.FinishedAt = &now
	}
	if err := s.q.RecordDeliveryAttempt(ctx, params); err != nil {
		return fmt.Errorf("record delivery attempt: %w", err)
	}
	return nil
}

// settleDead disables the hook after too many consecutive dead deliveries.
func (s *Service) settleDead(ctx context.Context, hookID string) error {
	recent, err := s.q.ListDeliveriesByWebhook(ctx, dbgen.ListDeliveriesByWebhookParams{WebhookID: hookID, Limit: deadToDisable})
	if err != nil {
		return fmt.Errorf("list deliveries: %w", err)
	}
	if len(recent) < deadToDisable {
		return nil
	}
	for _, row := range recent {
		if row.FinishedAt == nil || delivered(row) || row.Error == reasonOff {
			return nil
		}
	}
	return s.disableOutgoing(ctx, hookID, fmt.Sprintf("%d deliveries in a row failed", deadToDisable))
}

// delivered is a log row whose receiver answered 2xx.
func delivered(row dbgen.WebhookDelivery) bool {
	return row.StatusCode != nil && *row.StatusCode >= 200 && *row.StatusCode < 300
}

func (s *Service) disableOutgoing(ctx context.Context, id, reason string) error {
	if err := s.q.DisableOutgoingWebhook(ctx, dbgen.DisableOutgoingWebhookParams{ID: id, DisabledReason: reason}); err != nil {
		return fmt.Errorf("disable hook: %w", err)
	}
	s.log.Warn("outgoing webhook disabled", "hook", id, "reason", reason)
	return nil
}

// ladderRemaining bounds a Retry-After by the time the ladder would still
// take from this attempt.
func ladderRemaining(attempt int) time.Duration {
	var total time.Duration
	for step := max(attempt-1, 0); step < len(DeliveryBackoff); step++ {
		total += DeliveryBackoff[step]
	}
	return total
}

func statusPtr(code int) *int32 {
	if code == 0 {
		return nil
	}
	stored := int32(code)
	return &stored
}

// storableText makes a receiver's text safe for a text column, which
// refuses invalid UTF-8 and NUL bytes.
func storableText(text string) string {
	return strings.ReplaceAll(strings.ToValidUTF8(text, "�"), "\x00", "")
}

// cutBytes keeps at most limit bytes of str, never splitting a rune.
func cutBytes(str string, limit int) string {
	if len(str) <= limit {
		return str
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(str[cut]) {
		cut--
	}
	return str[:cut]
}
