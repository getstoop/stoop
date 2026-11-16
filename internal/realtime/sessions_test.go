package realtime_test

import (
	"testing"
	"time"

	"github.com/coder/websocket"
)

// A session is connected while any socket opened with it is open.
func TestSessionConnected(t *testing.T) {
	gw, _, srv := newTestGateway(t, fakeMembers{"casey": {"s1"}}, fakeVoiceChannels{})
	if gw.SessionConnected("session:casey") || gw.SessionConnected("") {
		t.Fatal("connected before any socket opened")
	}
	first := dial(t, srv, "casey")
	first.next(time.Second)
	if !gw.SessionConnected("session:casey") {
		t.Fatal("not connected with a socket open")
	}
	if gw.SessionConnected("session:other") || gw.SessionConnected("") {
		t.Fatal("another session or an empty id reads as connected")
	}
	second := dialMobile(t, srv, "casey")
	second.next(time.Second)
	_ = first.conn.Close(websocket.StatusNormalClosure, "")
	_ = second.conn.Close(websocket.StatusNormalClosure, "")
	deadline := time.Now().Add(2 * time.Second)
	for gw.SessionConnected("session:casey") && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if gw.SessionConnected("session:casey") {
		t.Fatal("still connected after every socket closed")
	}
}
