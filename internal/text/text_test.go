package text

import (
	"strings"
	"testing"
)

func TestOneLine(t *testing.T) {
	cases := map[string]string{
		"plain":                "plain",
		"  two  words ":        "two words",
		"line\nbreak\r\n\ttab": "line break tab",
		"":                     "",
	}
	for in, want := range cases {
		if got := OneLine(in); got != want {
			t.Errorf("OneLine(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTruncate(t *testing.T) {
	const limit = 10
	long := strings.Repeat("é", limit+5)
	got := Truncate(long, limit)
	if n := len([]rune(got)); n != limit || !strings.HasSuffix(got, "…") {
		t.Errorf("truncated to %d runes, got %q", n, got)
	}
	if short := "fits"; Truncate(short, limit) != short {
		t.Error("short text changed")
	}
	exact := strings.Repeat("x", limit)
	if Truncate(exact, limit) != exact {
		t.Error("exact fit changed")
	}
	if got := Truncate("word     tail", 7); got != "word…" {
		t.Errorf("trailing space kept: %q", got)
	}
}
