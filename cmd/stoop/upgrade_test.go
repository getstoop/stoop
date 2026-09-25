package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRunUpgradeUsage(t *testing.T) {
	var out bytes.Buffer
	for _, args := range [][]string{{"--help"}, {"--to"}, {"--nope"}} {
		out.Reset()
		if code := runUpgrade(t.Context(), args, &out); code != 2 || !strings.Contains(out.String(), "usage: stoop upgrade") {
			t.Errorf("%v: exit %d, %q", args, code, out.String())
		}
	}
}
