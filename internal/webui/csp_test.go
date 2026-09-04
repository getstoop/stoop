package webui

import (
	"strings"
	"testing"
	"testing/fstest"
)

func TestScriptHashes(t *testing.T) {
	sub := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte(
		"<html><head>\n<script>var a = 1;</script>\n" +
			`<script type="module" crossorigin src="/assets/index.js"></script>` +
			"\n</head></html>")}}
	got := scriptHashes(sub)
	// sha256 of "var a = 1;", base64. The script with a src is 'self'.
	want := []string{"'sha256-+dZ6udsWxNVoGfScAq7t5IIF5UJb4F6RhjbN6oe1p4w='"}
	if len(got) != len(want) || got[0] != want[0] {
		t.Errorf("scriptHashes = %v, want %v", got, want)
	}
}

// The embedded build is what the policy actually has to allow: every
// inline script in it must be named, or the app does not start.
func TestEmbeddedScriptHashes(t *testing.T) {
	hashes := ScriptHashes()
	if len(hashes) == 0 {
		t.Skip("no embedded build (make build embeds web/dist)")
	}
	for _, h := range hashes {
		if !strings.HasPrefix(h, "'sha256-") || !strings.HasSuffix(h, "'") {
			t.Errorf("hash %q is not a CSP source expression", h)
		}
	}
}
