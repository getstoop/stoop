package integrations

import (
	"strings"
	"testing"
)

func TestAdapt(t *testing.T) {
	cases := []struct {
		name, contentType, body, want string
	}{
		{"stoop", "application/json", `{"text": "disk is full"}`, "disk is full"},
		{"plain", "text/plain; charset=utf-8", "  disk is full\n", "disk is full"},
		{"curl default", "application/x-www-form-urlencoded", "disk is full", "disk is full"},
		{"content body", "application/json", `{"content": "Sonarr grabbed something", "username": "Sonarr", "embeds": []}`, "Sonarr grabbed something"},
		{"text body", "application/json", `{"text": "[FIRING] Disk", "username": "alertmanager", "icon_emoji": ":fire:"}`, "[FIRING] Disk"},
		{"attachments", "application/json", `{"attachments": [{"title": "Grafana", "text": "CPU high"}, {"text": "on host b"}]}`, "Grafana\nCPU high\non host b"},
		{"empty json", "application/json", `{"blocks": []}`, ""},
		{"bad json", "application/json", `{not json`, ""},
		{"json without a header", "", `{"text": "guessed"}`, "guessed"},
		{"whitespace", "text/plain", "   \n", ""},
	}
	for _, c := range cases {
		if got := adapt(c.contentType, []byte(c.body)); got != c.want {
			t.Errorf("%s: adapt = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestTruncate(t *testing.T) {
	long := strings.Repeat("é", maxPostRunes+50)
	got := truncate(long)
	if n := len([]rune(got)); n != maxPostRunes || !strings.HasSuffix(got, "…") {
		t.Errorf("truncated to %d runes, ends %q", n, got[len(got)-3:])
	}
	if short := "fits"; truncate(short) != short {
		t.Error("short text changed")
	}
	if n := len([]rune(truncate(strings.Repeat("x", maxPostRunes)))); n != maxPostRunes {
		t.Errorf("exact fit changed to %d", n)
	}
}

func TestBotUsername(t *testing.T) {
	cases := map[string]string{
		"Uptime Kuma": "uptime_kuma", "UPS!": "ups", "a": "a_bot", "--Grafana.alerts--": "grafana_alerts",
		strings.Repeat("x", 40): strings.Repeat("x", 32), "日本語": "bot",
	}
	for in, want := range cases {
		if got := botUsername(in); got != want {
			t.Errorf("botUsername(%q) = %q, want %q", in, got, want)
		}
	}
}
