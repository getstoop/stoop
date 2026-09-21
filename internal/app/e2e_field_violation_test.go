package app_test

import (
	"strings"
	"testing"
)

// A refusal about one field names it on the wire; one about none doesn't.
func TestE2EFieldViolation(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	stoop, general := h.space(casey, "The Stoop")
	ada := h.person("ada")
	h.join(ada, h.invite(casey, stoop))

	const create = "stoop.chat.v1.ChatService/CreateChannel"
	const update = "stoop.chat.v1.ChatService/UpdateChannel"

	r := h.rpc(casey, create, map[string]any{"spaceId": stoop, "name": "Off Topic"}).
		expect(t, "invalid_argument", "lowercase letters")
	if got := r.field(); got != "name" {
		t.Errorf("malformed name: field = %q, want name", got)
	}
	h.rpc(casey, create, map[string]any{"spaceId": stoop, "name": "garden"}).expect(t, "ok")
	r = h.rpc(casey, update, map[string]any{"channelId": general, "name": "garden"}).
		expect(t, "already_exists")
	if got := r.field(); got != "name" {
		t.Errorf("taken name: field = %q, want name", got)
	}
	r = h.rpc(casey, update, map[string]any{"channelId": general, "topic": strings.Repeat("x", 300)}).
		expect(t, "invalid_argument", "topic")
	if got := r.field(); got != "topic" {
		t.Errorf("long topic: field = %q, want topic", got)
	}
	r = h.rpc(ada, create, map[string]any{"spaceId": stoop, "name": "Off Topic"}).
		expect(t, "permission_denied")
	if got := r.field(); got != "" {
		t.Errorf("permission denied: field = %q, want none", got)
	}
}
