// Package webpush sends one Web Push message: the payload encrypted to the
// subscription's keys (RFC 8291, the aes128gcm coding of RFC 8188), the
// request signed with the server's VAPID key (RFC 8292), posted to the
// subscription's endpoint (RFC 8030). It stores nothing; the caller owns
// the subscriptions, the signing key and the retries.
package webpush

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/getstoop/stoop/internal/netguard"
)

// Subscription is where one client receives pushes and the keys it gave
// for them, decoded from base64url.
type Subscription struct {
	Endpoint string
	// P256DH is the client's public key, an uncompressed P-256 point.
	P256DH []byte
	// Auth is the client's 16-byte authentication secret.
	Auth []byte
}

// Urgency tells the push service how soon a message is worth waking a
// device for (RFC 8030 §5.3).
type Urgency string

const (
	UrgencyVeryLow Urgency = "very-low"
	UrgencyLow     Urgency = "low"
	UrgencyNormal  Urgency = "normal"
	UrgencyHigh    Urgency = "high"
)

// Message is one push.
type Message struct {
	// Payload is the plaintext, at most MaxPayloadBytes.
	Payload []byte
	// TTL is how long the push service keeps an undelivered message;
	// zero means deliver now or drop.
	TTL time.Duration
	// Urgency is left to the push service's default when empty.
	Urgency Urgency
	// Topic, when set, lets a newer message replace an undelivered older
	// one: up to 32 base64url characters.
	Topic string
}

// Outcome is what the caller should do after a send.
type Outcome int

const (
	// Accepted: the push service took the message.
	Accepted Outcome = iota
	// Gone: the subscription no longer exists; delete it.
	Gone
	// Retry: the push service is busy or failing; try again, after
	// Result.RetryAfter when it is set.
	Retry
	// Rejected: the push service refused this request; trying again
	// will not help.
	Rejected
)

// Result is the push service's answer.
type Result struct {
	Outcome Outcome
	// Status is the HTTP status code.
	Status int
	// RetryAfter is the wait the push service asked for, zero when it
	// named none.
	RetryAfter time.Duration
}

// Sender posts messages signed with one VAPID key.
type Sender struct {
	client  *http.Client
	key     *ecdsa.PrivateKey
	public  string
	subject string
	now     func() time.Time
	tokens  tokenCache
}

// NewSender signs with key and posts through a copy of client that follows
// no redirects; client decides what addresses may be reached. subject is the contact a push service may use
// about this server, a mailto: or https: URL; it may be empty.
func NewSender(client *http.Client, key *ecdsa.PrivateKey, subject string) (*Sender, error) {
	if client == nil || key == nil {
		return nil, errors.New("webpush: a client and a signing key are required")
	}
	if key.Curve != elliptic.P256() {
		return nil, errors.New("webpush: signing key is not P-256")
	}
	public, err := EncodePublicKey(key)
	if err != nil {
		return nil, err
	}
	// A push is never redirected: a followed redirect would turn the POST
	// into a GET or carry the signed request elsewhere.
	guarded := *client
	guarded.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &Sender{client: &guarded, key: key, public: public, subject: subject, now: time.Now}, nil
}

// maxRetryAfter caps the wait a push service may ask for.
const maxRetryAfter = 24 * time.Hour

var topicPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

// Send encrypts msg for sub and posts it. The error is for a message that
// was never answered: a bad subscription (ErrBadSubscription), an oversized
// payload (ErrPayloadTooLarge), or a failed request, which may be retried.
// Any answer from the push service is a Result.
func (s *Sender) Send(ctx context.Context, sub Subscription, msg Message) (Result, error) {
	// The endpoint is a capability URL, so no error carries it.
	endpoint, err := url.Parse(sub.Endpoint)
	if err != nil {
		return Result{}, fmt.Errorf("%w: endpoint is not a URL", ErrBadSubscription)
	}
	if err := netguard.CheckURL(endpoint); err != nil {
		return Result{}, fmt.Errorf("%w: endpoint: %v", ErrBadSubscription, err)
	}
	if msg.Topic != "" && !topicPattern.MatchString(msg.Topic) {
		return Result{}, errors.New("webpush: topic must be up to 32 base64url characters")
	}
	if msg.TTL < 0 {
		return Result{}, errors.New("webpush: TTL is negative")
	}
	body, err := encrypt(msg.Payload, sub.P256DH, sub.Auth)
	if err != nil {
		return Result{}, err
	}
	token, err := s.tokens.get(s.key, endpoint.Scheme+"://"+endpoint.Host, s.subject, s.now())
	if err != nil {
		return Result{}, fmt.Errorf("webpush: sign token: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return Result{}, fmt.Errorf("%w: endpoint cannot be requested", ErrBadSubscription)
	}
	req.Header.Set("Authorization", "vapid t="+token+", k="+s.public)
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("TTL", strconv.FormatInt(int64(msg.TTL/time.Second), 10))
	if msg.Urgency != "" {
		req.Header.Set("Urgency", string(msg.Urgency))
	}
	if msg.Topic != "" {
		req.Header.Set("Topic", msg.Topic)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		var failed *url.Error
		if errors.As(err, &failed) {
			err = failed.Err
		}
		return Result{}, fmt.Errorf("webpush: post: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	// Read a little so the connection can be reused; the body says nothing
	// the status does not.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))

	return Result{
		Outcome:    outcomeOf(resp.StatusCode),
		Status:     resp.StatusCode,
		RetryAfter: retryAfter(resp.Header.Get("Retry-After"), s.now()),
	}, nil
}

func outcomeOf(status int) Outcome {
	switch {
	case status >= 200 && status < 300:
		return Accepted
	case status == http.StatusNotFound || status == http.StatusGone:
		return Gone
	case status == http.StatusTooManyRequests || status >= 500:
		return Retry
	default:
		return Rejected
	}
}

// retryAfter reads a Retry-After header, in either of its forms: a count
// of seconds or an HTTP date, capped at maxRetryAfter.
func retryAfter(header string, now time.Time) time.Duration {
	if header == "" {
		return 0
	}
	if seconds, err := strconv.ParseInt(header, 10, 64); err == nil {
		return time.Duration(min(max(seconds, 0), int64(maxRetryAfter/time.Second))) * time.Second
	} else if errors.Is(err, strconv.ErrRange) && !strings.HasPrefix(header, "-") {
		return maxRetryAfter
	}
	if when, err := http.ParseTime(header); err == nil {
		return min(max(when.Sub(now), 0), maxRetryAfter)
	}
	return 0
}
