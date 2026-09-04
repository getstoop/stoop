package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// LiveKit's RoomService, over Twirp, signed with the tokens token.go
// mints. See docs/architecture/voice.md.

const (
	roomAdminTokenTTL  = 30 * time.Second
	roomRequestTimeout = 5 * time.Second
	// repeatMargin pads the wait for a join token to expire, against clock
	// skew between Stoop and the sidecar that validates it.
	repeatMargin = 15 * time.Second
)

// httpBase parses a LiveKit URL for HTTP use; it may be written ws(s)://.
func httpBase(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	switch u.Scheme {
	case "ws":
		u.Scheme = "http"
	case "wss":
		u.Scheme = "https"
	}
	return u, nil
}

// rooms calls LiveKit's room management API.
type rooms struct {
	base              string
	apiKey, apiSecret string
	client            *http.Client
	now               func() time.Time
}

func newRooms(opts Options) (*rooms, error) {
	base, err := httpBase(opts.LiveKitURL)
	if err != nil {
		return nil, err
	}
	return &rooms{
		base:      strings.TrimSuffix(base.String(), "/"),
		apiKey:    opts.LiveKitAPIKey,
		apiSecret: opts.LiveKitAPISecret,
		client:    &http.Client{Timeout: roomRequestTimeout},
		now:       time.Now,
	}, nil
}

// roomCall is one RoomService request, kept whole so it can be repeated.
type roomCall struct {
	method string
	grant  videoGrant
	body   map[string]string
}

// RemoveParticipant disconnects one user from a voice channel's room.
func (s *Service) RemoveParticipant(ctx context.Context, channelID, userID string) error {
	return s.do(ctx, roomCall{
		method: "RemoveParticipant",
		grant:  videoGrant{Room: channelID, RoomAdmin: true},
		body:   map[string]string{"room": channelID, "identity": userID},
	})
}

// CloseRoom ends a voice channel's room, disconnecting everyone in it.
func (s *Service) CloseRoom(ctx context.Context, channelID string) error {
	return s.do(ctx, roomCall{
		method: "DeleteRoom",
		// DeleteRoom is gated on roomCreate, not roomAdmin.
		grant: videoGrant{Room: channelID, RoomCreate: true},
		body:  map[string]string{"room": channelID},
	})
}

// do makes a room call now and once more after any token already handed
// out has expired. LiveKit has no revocation, so the second call is what
// actually ends the right to be there; see docs/architecture/voice.md.
func (s *Service) do(ctx context.Context, c roomCall) error {
	if s.rooms == nil {
		return nil
	}
	err := s.rooms.call(ctx, c)
	s.repeatOnceTokensExpire(c)
	return err
}

func (s *Service) repeatOnceTokensExpire(c roomCall) {
	s.repeats.Add(1)
	go func() {
		defer s.repeats.Done()
		t := time.NewTimer(s.repeatDelay)
		defer t.Stop()
		select {
		case <-t.C:
		case <-s.closed:
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), roomRequestTimeout)
		defer cancel()
		if err := s.rooms.call(ctx, c); err != nil {
			s.log.Warn("could not repeat a livekit room call once tokens expired",
				"method", c.method, "room", c.body["room"], "err", err)
		}
	}()
}

// Close abandons repeats still waiting and lets those already running
// finish. A repeat that never fires costs at most one stale participant.
func (s *Service) Close() {
	s.closeOnce.Do(func() { close(s.closed) })
	s.repeats.Wait()
}

func (r *rooms) call(ctx context.Context, c roomCall) error {
	token, err := mintToken(tokenParams{
		apiKey: r.apiKey, apiSecret: r.apiSecret,
		identity: "stoop-server", // unchecked on a server call; for the sidecar's logs
		grant:    c.grant, ttl: roomAdminTokenTTL, now: r.now(),
	})
	if err != nil {
		return fmt.Errorf("mint room token: %w", err)
	}
	payload, err := json.Marshal(c.body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		r.base+"/twirp/livekit.RoomService/"+c.method, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("livekit %s: %w", c.method, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 == 2 {
		return nil
	}
	msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	var twirp struct {
		Code string `json:"code"`
		Msg  string `json:"msg"`
	}
	// Nothing to remove is not a failure.
	if err := json.Unmarshal(msg, &twirp); err == nil && twirp.Code == "not_found" {
		return nil
	}
	return fmt.Errorf("livekit %s: %s: %s", c.method, resp.Status, strings.TrimSpace(string(msg)))
}
