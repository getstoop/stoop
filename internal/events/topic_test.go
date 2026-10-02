package events

import "testing"

func TestTopicNames(t *testing.T) {
	if got := SpaceTopic("s1"); got != "space:s1" {
		t.Errorf("SpaceTopic = %q, want %q", got, "space:s1")
	}
	if got := UserTopic("u1"); got != "user:u1" {
		t.Errorf("UserTopic = %q, want %q", got, "user:u1")
	}
}
