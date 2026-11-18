package webpush

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func newTestSender(t *testing.T) *Sender {
	t.Helper()
	key, err := GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	sender, err := NewSender(&http.Client{Timeout: 5 * time.Second}, key, "mailto:admin@example.com")
	if err != nil {
		t.Fatal(err)
	}
	return sender
}

func TestSendPostsAnEncryptedSignedMessage(t *testing.T) {
	receiver, auth := newReceiver(t)
	var got *http.Request
	var gotBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	sender := newTestSender(t)
	now := time.Unix(1_800_000_000, 0)
	sender.now = func() time.Time { return now }
	payload := []byte(`{"kind":"message"}`)
	result, err := sender.Send(context.Background(), Subscription{
		Endpoint: server.URL + "/push/abc?token=1", P256DH: receiver.PublicKey().Bytes(), Auth: auth,
	}, Message{Payload: payload, TTL: 90 * time.Second, Urgency: UrgencyHigh, Topic: "channel-42"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != Accepted || result.Status != http.StatusCreated || result.RetryAfter != 0 {
		t.Fatalf("result = %+v", result)
	}

	if got.Method != http.MethodPost || got.URL.RequestURI() != "/push/abc?token=1" {
		t.Errorf("request = %s %s", got.Method, got.URL.RequestURI())
	}
	for name, want := range map[string]string{
		"Content-Encoding": "aes128gcm", "TTL": "90", "Urgency": "high", "Topic": "channel-42",
	} {
		if got.Header.Get(name) != want {
			t.Errorf("%s = %q, want %q", name, got.Header.Get(name), want)
		}
	}
	if got := unpad(t, decrypt(t, receiver, auth, gotBody)); !bytes.Equal(got, payload) {
		t.Errorf("decrypted %q, want %q", got, payload)
	}

	token, public, ok := strings.Cut(strings.TrimPrefix(got.Header.Get("Authorization"), "vapid t="), ", k=")
	if !ok || !strings.HasPrefix(got.Header.Get("Authorization"), "vapid t=") {
		t.Fatalf("Authorization = %q", got.Header.Get("Authorization"))
	}
	if public != sender.public {
		t.Errorf("k = %q, want the sender's public key", public)
	}
	_, claims := verifyToken(t, token, public)
	if claims["aud"] != server.URL {
		t.Errorf("aud = %v, want the endpoint's origin %s", claims["aud"], server.URL)
	}
	if claims["exp"] != float64(now.Add(12*time.Hour).Unix()) {
		t.Errorf("exp = %v, want 12 hours out", claims["exp"])
	}
	if claims["sub"] != "mailto:admin@example.com" {
		t.Errorf("sub = %v", claims["sub"])
	}
}

func TestSendLeavesOutUnsetHeaders(t *testing.T) {
	receiver, auth := newReceiver(t)
	var got http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Header
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	_, err := newTestSender(t).Send(context.Background(), Subscription{
		Endpoint: server.URL, P256DH: receiver.PublicKey().Bytes(), Auth: auth,
	}, Message{Payload: []byte("hi")})
	if err != nil {
		t.Fatal(err)
	}
	if got.Get("TTL") != "0" {
		t.Errorf("TTL = %q, want 0", got.Get("TTL"))
	}
	if _, ok := got["Urgency"]; ok {
		t.Error("Urgency was sent")
	}
	if _, ok := got["Topic"]; ok {
		t.Error("Topic was sent")
	}
}

func TestSendReportsTheAnswer(t *testing.T) {
	receiver, auth := newReceiver(t)
	cases := []struct {
		status     int
		retryAfter string
		outcome    Outcome
		wait       time.Duration
	}{
		{http.StatusCreated, "", Accepted, 0},
		{http.StatusOK, "", Accepted, 0},
		{http.StatusAccepted, "", Accepted, 0},
		{http.StatusNotFound, "", Gone, 0},
		{http.StatusGone, "", Gone, 0},
		{http.StatusTooManyRequests, "120", Retry, 2 * time.Minute},
		{http.StatusTooManyRequests, "", Retry, 0},
		{http.StatusTooManyRequests, "soon", Retry, 0},
		{http.StatusTooManyRequests, "-5", Retry, 0},
		{http.StatusTooManyRequests, "999999", Retry, 24 * time.Hour},
		{http.StatusTooManyRequests, "99999999999999999999999", Retry, 24 * time.Hour},
		{http.StatusServiceUnavailable, "Fri, 15 Jan 2028 08:00:00 GMT", Retry, 24 * time.Hour},
		{http.StatusInternalServerError, "", Retry, 0},
		{http.StatusServiceUnavailable, "Fri, 15 Jan 2027 08:01:00 GMT", Retry, time.Minute},
		{http.StatusServiceUnavailable, "Fri, 15 Jan 2027 07:00:00 GMT", Retry, 0},
		{http.StatusBadRequest, "", Rejected, 0},
		{http.StatusForbidden, "", Rejected, 0},
		{http.StatusRequestEntityTooLarge, "", Rejected, 0},
		{http.StatusMovedPermanently, "", Rejected, 0},
	}
	accepting := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer accepting.Close()
	for _, tc := range cases {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			if tc.status == http.StatusMovedPermanently {
				// A followed redirect would land on a 200.
				w.Header().Set("Location", accepting.URL)
			}
			if tc.retryAfter != "" {
				w.Header().Set("Retry-After", tc.retryAfter)
			}
			w.WriteHeader(tc.status)
		}))
		sender := newTestSender(t)
		sender.now = func() time.Time { return time.Date(2027, time.January, 15, 8, 0, 0, 0, time.UTC) }
		result, err := sender.Send(context.Background(), Subscription{
			Endpoint: server.URL, P256DH: receiver.PublicKey().Bytes(), Auth: auth,
		}, Message{Payload: []byte("hi")})
		server.Close()
		if err != nil {
			t.Errorf("%d: %v", tc.status, err)
			continue
		}
		if result.Outcome != tc.outcome || result.Status != tc.status || result.RetryAfter != tc.wait {
			t.Errorf("%d (Retry-After %q): result = %+v, want outcome %d after %s",
				tc.status, tc.retryAfter, result, tc.outcome, tc.wait)
		}
	}
}

func TestSendRefusesWithoutPosting(t *testing.T) {
	receiver, auth := newReceiver(t)
	posts := 0
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { posts++ }))
	defer server.Close()
	good := Subscription{Endpoint: server.URL, P256DH: receiver.PublicKey().Bytes(), Auth: auth}
	sender := newTestSender(t)

	_, err := sender.Send(context.Background(), good, Message{Payload: make([]byte, MaxPayloadBytes+1)})
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Errorf("oversized payload: err = %v, want ErrPayloadTooLarge", err)
	}
	for _, endpoint := range []string{"", "ftp://push.example/x", "https://user:pass@push.example/x", "/push/x", "://"} {
		sub := good
		sub.Endpoint = endpoint
		if _, err := sender.Send(context.Background(), sub, Message{}); !errors.Is(err, ErrBadSubscription) {
			t.Errorf("endpoint %q: err = %v, want ErrBadSubscription", endpoint, err)
		}
	}
	badKeys := good
	badKeys.Auth = auth[:8]
	if _, err := sender.Send(context.Background(), badKeys, Message{}); !errors.Is(err, ErrBadSubscription) {
		t.Errorf("short auth: err = %v, want ErrBadSubscription", err)
	}
	for _, topic := range []string{"has space", strings.Repeat("a", 33), "slash/"} {
		if _, err := sender.Send(context.Background(), good, Message{Topic: topic}); err == nil {
			t.Errorf("topic %q passed", topic)
		}
	}
	if _, err := sender.Send(context.Background(), good, Message{TTL: -time.Second}); err == nil {
		t.Error("a negative TTL passed")
	}
	if posts != 0 {
		t.Errorf("%d requests were posted", posts)
	}
}

func TestSendReturnsARequestFailure(t *testing.T) {
	receiver, auth := newReceiver(t)
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	endpoint := server.URL + "/push/device-secret"
	server.Close()
	sender := newTestSender(t)
	_, err := sender.Send(context.Background(), Subscription{
		Endpoint: endpoint, P256DH: receiver.PublicKey().Bytes(), Auth: auth,
	}, Message{Payload: []byte("hi")})
	if err == nil || errors.Is(err, ErrBadSubscription) || errors.Is(err, ErrPayloadTooLarge) {
		t.Fatalf("err = %v, want a request failure", err)
	}
	if strings.Contains(err.Error(), "device-secret") {
		t.Errorf("the error names the endpoint: %v", err)
	}

	// Nor does a refused endpoint appear in its error.
	for _, bad := range []string{"https://push.example/device-secret\x7f", "ftp://push.example/device-secret", "https://push.example:port/device-secret"} {
		_, err := sender.Send(context.Background(), Subscription{
			Endpoint: bad, P256DH: receiver.PublicKey().Bytes(), Auth: auth,
		}, Message{Payload: []byte("hi")})
		if !errors.Is(err, ErrBadSubscription) || strings.Contains(err.Error(), "device-secret") {
			t.Errorf("endpoint %q: err = %v", bad, err)
		}
	}
}

func TestSendReusesTheTokenPerOrigin(t *testing.T) {
	receiver, auth := newReceiver(t)
	var tokens []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokens = append(tokens, r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()
	sender := newTestSender(t)
	sub := Subscription{Endpoint: server.URL, P256DH: receiver.PublicKey().Bytes(), Auth: auth}
	for range 2 {
		if _, err := sender.Send(context.Background(), sub, Message{Payload: []byte("hi")}); err != nil {
			t.Fatal(err)
		}
	}
	if len(tokens) != 2 || tokens[0] != tokens[1] {
		t.Fatalf("tokens = %q, want the same one twice", tokens)
	}
}

func TestNewSenderRefusesMissingParts(t *testing.T) {
	key, _ := GenerateKey()
	if _, err := NewSender(nil, key, ""); err == nil {
		t.Error("a nil client passed")
	}
	if _, err := NewSender(http.DefaultClient, nil, ""); err == nil {
		t.Error("a nil key passed")
	}
}

// A Location the client cannot parse fails before the redirect guard runs,
// and the client's own error quotes it.
func TestSendKeepsTheEndpointOutOfARedirectFailure(t *testing.T) {
	receiver, auth := newReceiver(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "http://"+r.Host+r.URL.Path+"%zz")
		w.WriteHeader(http.StatusFound)
	}))
	defer server.Close()
	_, err := newTestSender(t).Send(context.Background(), Subscription{
		Endpoint: server.URL + "/push/device-secret", P256DH: receiver.PublicKey().Bytes(), Auth: auth,
	}, Message{Payload: []byte("hi")})
	if err == nil {
		t.Fatal("a malformed redirect passed")
	}
	if strings.Contains(err.Error(), "device-secret") {
		t.Errorf("the error names the endpoint: %v", err)
	}
}

func TestSendFailureCanBeToldApart(t *testing.T) {
	receiver, auth := newReceiver(t)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { <-release }))
	defer server.Close()
	defer close(release)
	sub := Subscription{Endpoint: server.URL, P256DH: receiver.PublicKey().Bytes(), Auth: auth}

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := newTestSender(t).Send(canceled, sub, Message{}); !errors.Is(err, context.Canceled) {
		t.Errorf("canceled: err = %v, want context.Canceled", err)
	}
	expiring, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := newTestSender(t).Send(expiring, sub, Message{}); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("deadline: err = %v, want context.DeadlineExceeded", err)
	}
}

func TestAudienceIsTheSerializedOrigin(t *testing.T) {
	cases := map[string]string{
		"https://push.example/push/abc":         "https://push.example",
		"https://PUSH.EXAMPLE:443/push/abc":     "https://push.example",
		"HTTPS://Push.Example:8443/push/abc":    "https://push.example:8443",
		"http://push.example:80/push":           "http://push.example",
		"http://push.example:443/push":          "http://push.example:443",
		"https://push.example:80":               "https://push.example:80",
		"https://push.example:/push":            "https://push.example",
		"https://[2001:DB8::1]:443/push":        "https://[2001:db8::1]",
		"https://[2001:db8::1]:8443/push?x=1#y": "https://[2001:db8::1]:8443",
	}
	for raw, want := range cases {
		endpoint, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		if got := origin(endpoint); got != want {
			t.Errorf("origin(%s) = %s, want %s", raw, got, want)
		}
	}
}
