package main

import (
	"bytes"
	"testing"

	"github.com/getstoop/stoop/internal/buildinfo"
)

func TestRunVersion(t *testing.T) {
	prev := buildinfo.Version
	buildinfo.Version = "v0.3.0"
	t.Cleanup(func() { buildinfo.Version = prev })

	var out bytes.Buffer
	if code := runVersion(nil, &out); code != 0 || !bytes.HasPrefix(out.Bytes(), []byte("stoop v0.3.0")) {
		t.Errorf("plain: exit %d, %q", code, out.String())
	}
	if code := runVersion([]string{"--json"}, &out); code != 2 {
		t.Errorf("unknown flag: exit %d", code)
	}
}
