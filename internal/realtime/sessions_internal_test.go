package realtime

import "testing"

// Closing one of two sockets leaves the session connected.
func TestSessionsCountSockets(t *testing.T) {
	reg := newSessions()
	reg.open("a")
	reg.open("a")
	reg.close("a")
	if !reg.connected("a") {
		t.Fatal("one close dropped a session with another socket open")
	}
	reg.close("a")
	if reg.connected("a") {
		t.Fatal("still connected after every socket closed")
	}
	reg.open("")
	if reg.connected("") {
		t.Fatal("an empty id is connected")
	}
}
