package realtime_test

import (
	"testing"
	"time"

	"github.com/coder/websocket"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/realtime"
)

// testGrace is long enough to tell "not yet" from "now" on a loaded
// machine, and short enough to keep the tests quick.
const testGrace = 400 * time.Millisecond

func withGrace(gateway *realtime.Gateway) { gateway.SetPresenceGrace(testGrace) }

// heard waits for the next presence change about userID, or nil.
func heard(watcher *client, userID string, timeout time.Duration) *realtimev1.PresenceChanged {
	deadline := time.After(timeout)
	for {
		select {
		case ev, ok := <-watcher.events:
			if !ok {
				return nil
			}
			if changed := ev.GetPresenceChanged(); changed != nil && changed.UserId == userID {
				return changed
			}
		case <-deadline:
			return nil
		}
	}
}

// A closed connection leaves the person online for the grace period, and
// one back within it is never announced offline at all.
func TestPresenceGrace(t *testing.T) {
	_, _, srv := newTestGateway(t, fakeMembers{"alice": {"s1"}, "bob": {"s1"}}, fakeVoiceChannels{}, withGrace)
	alice := dial(t, srv, "alice")
	alice.next(time.Second)

	bob := dial(t, srv, "bob")
	bob.next(time.Second)
	if changed := heard(alice, "bob", time.Second); changed == nil || !changed.Online {
		t.Fatalf("alice never heard bob come online: %v", changed)
	}

	// A reload: closed, and back before the grace runs out.
	_ = bob.conn.Close(websocket.StatusNormalClosure, "")
	time.Sleep(testGrace / 4)
	bob = dial(t, srv, "bob")
	bob.next(time.Second)
	if changed := heard(alice, "bob", testGrace*2); changed != nil {
		t.Fatalf("a reload within the grace was announced: %v", changed)
	}

	// Gone for good: offline, once the grace has run.
	closedAt := time.Now()
	_ = bob.conn.Close(websocket.StatusNormalClosure, "")
	changed := heard(alice, "bob", testGrace*4)
	if changed == nil || changed.Online {
		t.Fatalf("alice never heard bob go offline: %v", changed)
	}
	if waited := time.Since(closedAt); waited < testGrace {
		t.Errorf("offline announced %v after the close, before the %v grace", waited, testGrace)
	}
}

// A socket closed because its session ended takes the person offline at
// once: signing out is not a reload.
func TestSignOutSkipsTheGrace(t *testing.T) {
	_, bus, srv := newTestGateway(t, fakeMembers{"alice": {"s1"}, "bob": {"s1"}}, fakeVoiceChannels{}, withGrace)
	alice := dial(t, srv, "alice")
	alice.next(time.Second)
	bob := dial(t, srv, "bob")
	bob.next(time.Second)
	heard(alice, "bob", time.Second)

	signedOut := time.Now()
	bus.Publish("user:bob", revoked("session:bob"))
	changed := heard(alice, "bob", testGrace)
	if changed == nil || changed.Online {
		t.Fatalf("alice didn't hear bob go offline before the grace ran: %v", changed)
	}
	if waited := time.Since(signedOut); waited >= testGrace {
		t.Errorf("offline took %v, the whole grace", waited)
	}
}

// Someone whose every connection is a mobile app's is announced so: at
// once when they come online that way, at once when a computer joins, and
// after the grace when the computer leaves them only on mobile.
func TestMobilePresence(t *testing.T) {
	_, _, srv := newTestGateway(t, fakeMembers{"alice": {"s1"}, "bob": {"s1"}}, fakeVoiceChannels{}, withGrace)
	alice := dial(t, srv, "alice")
	alice.next(time.Second)

	phone := dialMobile(t, srv, "bob")
	if ready := phone.next(time.Second).GetReady(); ready == nil {
		t.Fatal("the phone never became ready")
	}
	if changed := heard(alice, "bob", time.Second); changed == nil || !changed.Online || !changed.Mobile {
		t.Fatalf("bob on his phone: %v, want online on mobile", changed)
	}

	// Ready tells a newcomer too.
	newcomer := dial(t, srv, "alice")
	ready := newcomer.next(time.Second).GetReady()
	mobile := false
	for _, presence := range ready.GetPresences() {
		if presence.UserId == "bob" {
			mobile = presence.Mobile
		}
	}
	if !mobile {
		t.Errorf("Ready lists bob as not on mobile: %v", ready.GetPresences())
	}
	_ = newcomer.conn.Close(websocket.StatusNormalClosure, "")

	computer := dial(t, srv, "bob")
	computer.next(time.Second)
	if changed := heard(alice, "bob", testGrace/2); changed == nil || !changed.Online || changed.Mobile {
		t.Fatalf("bob at his computer too: %v, want online, not mobile, at once", changed)
	}

	closedAt := time.Now()
	_ = computer.conn.Close(websocket.StatusNormalClosure, "")
	changed := heard(alice, "bob", testGrace*4)
	if changed == nil || !changed.Online || !changed.Mobile {
		t.Fatalf("bob back to only his phone: %v, want online on mobile", changed)
	}
	if waited := time.Since(closedAt); waited < testGrace {
		t.Errorf("mobile announced %v after the computer closed, before the %v grace", waited, testGrace)
	}

	_ = phone.conn.Close(websocket.StatusNormalClosure, "")
	if changed := heard(alice, "bob", testGrace*4); changed == nil || changed.Online {
		t.Fatalf("bob put his phone away: %v, want offline", changed)
	}
}
