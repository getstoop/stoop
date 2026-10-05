package main

import (
	"strings"
	"testing"

	"github.com/getstoop/stoop/internal/buildinfo"
)

func TestRunVersion(t *testing.T) {
	prev := buildinfo.Version
	buildinfo.Version = "v0.3.0"
	t.Cleanup(func() { buildinfo.Version = prev })

	console, out, errOut := bufferedStreams()
	if code := runVersion(nil, console); code != 0 || !strings.HasPrefix(out.String(), "stoop v0.3.0") {
		t.Errorf("plain: exit %d, %q", code, out.String())
	}
	if code := runVersion([]string{"--json"}, console); code != 2 || errOut.String() != "usage: stoop version\n" {
		t.Errorf("unknown flag: exit %d, %q", code, errOut.String())
	}
}
