package voice

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// stubLiveKit stands in for the sidecar's RoomService.
type stubLiveKit struct {
	method string
	body   map[string]string
	claims tokenClaims
	status int
	reply  string
	seen   chan struct{} // one signal per finished request, when non-nil
}

func (s *stubLiveKit) server(t *testing.T, secret string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Last, so a test that has seen the signal can read the fields.
		defer func() {
			if s.seen != nil {
				s.seen <- struct{}{}
			}
		}()
		s.method = strings.TrimPrefix(r.URL.Path, "/twirp/livekit.RoomService/")
		raw, _ := io.ReadAll(r.Body)
		s.body = map[string]string{}
		_ = json.Unmarshal(raw, &s.body)
		claims, err := parseToken(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), secret)
		if err != nil {
			t.Errorf("token: %v", err)
		}
		s.claims = claims
		if s.status != 0 {
			w.WriteHeader(s.status)
			_, _ = io.WriteString(w, s.reply)
			return
		}
		_, _ = io.WriteString(w, "{}")
	}))
}

// roomService points a Service at a stub sidecar. Only room calls are
// exercised, so the directories stay nil.
func roomService(t *testing.T, url string) *Service {
	t.Helper()
	svc := New(nil, nil, Options{
		LiveKitURL: url, LiveKitAPIKey: "devkey", LiveKitAPISecret: "devsecret",
	}, nil)
	t.Cleanup(svc.Close) // drop the repeats these tests don't wait for
	return svc
}

func TestRemoveParticipant(t *testing.T) {
	stub := &stubLiveKit{}
	srv := stub.server(t, "devsecret")
	defer srv.Close()

	if err := roomService(t, srv.URL).RemoveParticipant(context.Background(), "chan-1", "user-1"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if stub.method != "RemoveParticipant" {
		t.Errorf("method = %q", stub.method)
	}
	if stub.body["room"] != "chan-1" || stub.body["identity"] != "user-1" {
		t.Errorf("body = %v", stub.body)
	}
	// roomAdmin on that room and nothing else.
	if g := stub.claims.Video; !g.RoomAdmin || g.Room != "chan-1" || g.RoomJoin || g.CanPublish {
		t.Errorf("grant = %+v", g)
	}
}

func TestCloseRoom(t *testing.T) {
	stub := &stubLiveKit{}
	srv := stub.server(t, "devsecret")
	defer srv.Close()

	if err := roomService(t, srv.URL).CloseRoom(context.Background(), "chan-1"); err != nil {
		t.Fatalf("close: %v", err)
	}
	if stub.method != "DeleteRoom" {
		t.Errorf("method = %q", stub.method)
	}
	if stub.body["room"] != "chan-1" {
		t.Errorf("body = %v", stub.body)
	}
	if g := stub.claims.Video; !g.RoomCreate || g.Room != "chan-1" {
		t.Errorf("grant = %+v", g)
	}
}

// Most kicks happen nowhere near a call.
func TestRoomCallNotFoundIsSuccess(t *testing.T) {
	stub := &stubLiveKit{status: http.StatusNotFound, reply: `{"code":"not_found","msg":"requested room does not exist"}`}
	srv := stub.server(t, "devsecret")
	defer srv.Close()

	if err := roomService(t, srv.URL).RemoveParticipant(context.Background(), "chan-1", "user-1"); err != nil {
		t.Errorf("not_found should be success, got %v", err)
	}
}

func TestRoomCallReportsOtherErrors(t *testing.T) {
	stub := &stubLiveKit{status: http.StatusUnauthorized, reply: `{"code":"unauthenticated","msg":"invalid api key"}`}
	srv := stub.server(t, "devsecret")
	defer srv.Close()

	err := roomService(t, srv.URL).RemoveParticipant(context.Background(), "chan-1", "user-1")
	if err == nil || !strings.Contains(err.Error(), "invalid api key") {
		t.Errorf("want the sidecar's message, got %v", err)
	}
}

// With voice unconfigured there is no sidecar to call.
func TestRoomCallsNoOpWhenVoiceIsOff(t *testing.T) {
	svc := New(nil, nil, Options{}, nil)
	if err := svc.RemoveParticipant(context.Background(), "chan-1", "user-1"); err != nil {
		t.Errorf("remove: %v", err)
	}
	if err := svc.CloseRoom(context.Background(), "chan-1"); err != nil {
		t.Errorf("close: %v", err)
	}
}

// LiveKit's URL may be written ws(s)://; its API speaks HTTP.
func TestRoomsRewritesWebSocketScheme(t *testing.T) {
	stub := &stubLiveKit{}
	srv := stub.server(t, "devsecret")
	defer srv.Close()

	svc := roomService(t, "ws://"+strings.TrimPrefix(srv.URL, "http://")+"/")
	if err := svc.CloseRoom(context.Background(), "chan-1"); err != nil {
		t.Fatalf("close: %v", err)
	}
	if stub.method != "DeleteRoom" {
		t.Errorf("method = %q", stub.method)
	}
}

// waitForCall fails rather than hanging when a request never arrives.
func (s *stubLiveKit) waitForCall(t *testing.T, what string) {
	t.Helper()
	select {
	case <-s.seen:
	case <-time.After(5 * time.Second):
		t.Fatalf("the sidecar never saw %s", what)
	}
}

// A join token already in someone's hand still admits them and LiveKit
// cannot revoke it, so the call has to happen again once it has expired.
func TestRoomCallsRepeatOnceTokensExpire(t *testing.T) {
	for _, tc := range []struct {
		name   string
		call   func(*Service) error
		method string
	}{
		{"remove", func(s *Service) error {
			return s.RemoveParticipant(context.Background(), "chan-1", "user-1")
		}, "RemoveParticipant"},
		{"close", func(s *Service) error {
			return s.CloseRoom(context.Background(), "chan-1")
		}, "DeleteRoom"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stub := &stubLiveKit{seen: make(chan struct{}, 4)}
			srv := stub.server(t, "devsecret")
			defer srv.Close()

			svc := roomService(t, srv.URL)
			svc.repeatDelay = time.Millisecond
			if err := tc.call(svc); err != nil {
				t.Fatalf("call: %v", err)
			}
			stub.waitForCall(t, "the call")
			stub.waitForCall(t, "the repeat")
			if stub.method != tc.method {
				t.Errorf("repeat method = %q, want %q", stub.method, tc.method)
			}
		})
	}
}

// Shutdown must not sit on a repeat that is still a minute and a half off.
func TestCloseAbandonsAWaitingRepeat(t *testing.T) {
	stub := &stubLiveKit{}
	srv := stub.server(t, "devsecret")
	defer srv.Close()

	svc := roomService(t, srv.URL)
	svc.repeatDelay = time.Hour
	if err := svc.RemoveParticipant(context.Background(), "chan-1", "user-1"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	done := make(chan struct{})
	go func() {
		svc.Close()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Close waited for a repeat that had not come due")
	}
}
