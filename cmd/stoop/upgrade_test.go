package main

import (
	"strings"
	"testing"
)

func TestRunUpgradeUsage(t *testing.T) {
	for _, args := range [][]string{{"--help"}, {"--to"}, {"--nope"}} {
		console, out, _ := bufferedStreams()
		if code := runUpgrade(t.Context(), args, console); code != 2 || !strings.Contains(out.String(), "usage: stoop upgrade") {
			t.Errorf("%v: exit %d, %q", args, code, out.String())
		}
	}
}

func TestRunUpgradeToAndFileAreAlternatives(t *testing.T) {
	console, out, errOut := bufferedStreams()
	code := runUpgrade(t.Context(), []string{"--to", "0.4.0", "--file", "x.yml"}, console)
	if code != 2 || out.Len() != 0 || errOut.String() != "stoop upgrade: --to and --file are alternatives; give one\n" {
		t.Errorf("exit %d, out %q, err %q", code, out.String(), errOut.String())
	}
}

func TestRunUpgradeRollbackRefusesOtherFlags(t *testing.T) {
	t.Chdir(t.TempDir())
	for _, args := range [][]string{
		{"rollback", "--plan"},
		{"rollback", "--plan", "--yes"},
		{"rollback", "--to", "0.3.0"},
		{"rollback", "--file", "x.yml"},
		{"rollback", "--to", "", "--yes"},
		{"rollback", "--file", ""},
	} {
		console, out, _ := bufferedStreams()
		if code := runUpgrade(t.Context(), args, console); code != 2 || !strings.Contains(out.String(), "usage: stoop upgrade") {
			t.Errorf("%v: exit %d, %q", args, code, out.String())
		}
	}
}
