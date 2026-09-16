package app_test

import (
	"net/http"
	"testing"
)

// The retention settings: an admin sets them and previews what they'd
// delete, a member can't, and everyone reads them off the public status.
func TestE2ERetentionSettings(t *testing.T) {
	h := newHarness(t)
	casey := h.person("casey")
	_, general := h.space(casey, "The Stoop")
	ada := h.person("ada")
	h.send(casey, general, "tomatoes are in").expect(t, "ok")

	h.rpc(ada, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"messageRetentionDays": 90}).
		expect(t, "permission_denied")
	h.rpc(ada, "stoop.instance.v1.InstanceService/PreviewRetention", map[string]any{"messageRetentionDays": 90}).
		expect(t, "permission_denied")
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"messageRetentionDays": 3651}).
		expect(t, "invalid_argument", "3650")

	// Nothing is old enough yet, so the preview is all zeroes, which JSON
	// leaves out.
	p := h.rpc(casey, "stoop.instance.v1.InstanceService/PreviewRetention", map[string]any{
		"messageRetentionDays": 90, "attachmentRetentionDays": 30,
	}).expect(t, "ok")
	if p.str("messages") != "" || p.str("attachments") != "" {
		t.Errorf("preview on a new server: %s", p.raw)
	}

	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{
		"messageRetentionDays": 90, "attachmentRetentionDays": 30,
	}).expect(t, "ok")
	status := h.rpc("", "stoop.instance.v1.InstanceService/GetInstanceStatus", map[string]any{}).
		expectStatus(t, http.StatusOK)
	if status.body["messageRetentionDays"] != 90.0 || status.body["attachmentRetentionDays"] != 30.0 {
		t.Errorf("public status: %s", status.raw)
	}

	// 0 keeps forever again.
	h.rpc(casey, "stoop.instance.v1.InstanceService/UpdateSettings", map[string]any{"messageRetentionDays": 0}).
		expect(t, "ok")
	status = h.rpc("", "stoop.instance.v1.InstanceService/GetInstanceStatus", map[string]any{}).
		expectStatus(t, http.StatusOK)
	if _, set := status.body["messageRetentionDays"]; set {
		t.Errorf("message retention after clearing: %s", status.raw)
	}
}
