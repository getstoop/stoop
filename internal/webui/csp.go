package webui

import (
	"crypto/sha256"
	"encoding/base64"
	"io/fs"
	"regexp"
	"strings"
)

// index.html carries one inline script, the theme stamp. Hashing it is
// what lets script-src refuse every other inline script.
var scriptTag = regexp.MustCompile(`(?is)<script([^>]*)>(.*?)</script>`)

// ScriptHashes returns a CSP source expression for each inline script in
// the embedded index.html, ready to join into script-src.
func ScriptHashes() []string {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil
	}
	return scriptHashes(sub)
}

func scriptHashes(sub fs.FS) []string {
	index, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		return nil
	}
	var out []string
	for _, m := range scriptTag.FindAllSubmatch(index, -1) {
		if strings.Contains(strings.ToLower(string(m[1])), "src=") {
			continue // fetched from a URL; 'self' covers it
		}
		// The hash is over the element's text exactly as written.
		sum := sha256.Sum256(m[2])
		out = append(out, "'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'")
	}
	return out
}
