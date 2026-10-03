package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestDispatchUnknownVerbIsRefused(t *testing.T) {
	var out, errOut bytes.Buffer
	code, handled := dispatch(t.Context(), []string{"migrat", "up"}, &out, &errOut)
	if !handled || code != 2 || out.Len() != 0 || !strings.Contains(errOut.String(), "usage: stoop") {
		t.Errorf("handled %v, exit %d, out %q, err %q", handled, code, out.String(), errOut.String())
	}
}

func TestDispatchHelp(t *testing.T) {
	for _, arg := range []string{"help", "--help", "-h"} {
		var out, errOut bytes.Buffer
		code, handled := dispatch(t.Context(), []string{arg}, &out, &errOut)
		if !handled || code != 0 || !strings.Contains(out.String(), "usage: stoop") || errOut.Len() != 0 {
			t.Errorf("%s: handled %v, exit %d, out %q, err %q", arg, handled, code, out.String(), errOut.String())
		}
	}
}

func TestDispatchNoArgumentsServes(t *testing.T) {
	var out, errOut bytes.Buffer
	if _, handled := dispatch(t.Context(), nil, &out, &errOut); handled || out.Len() != 0 || errOut.Len() != 0 {
		t.Errorf("handled %v, out %q, err %q", handled, out.String(), errOut.String())
	}
}

func TestDispatchJobsIsHandled(t *testing.T) {
	// No database to reach, so the verb fails at its configuration
	// instead of running.
	t.Setenv("STOOP_DATABASE_URL", "")
	var out, errOut bytes.Buffer
	code, handled := dispatch(t.Context(), []string{"jobs"}, &out, &errOut)
	if !handled || code != 1 {
		t.Errorf("handled %v, exit %d, out %q, err %q", handled, code, out.String(), errOut.String())
	}
	if !strings.Contains(usage, "\n  jobs ") {
		t.Errorf("usage does not list jobs:\n%s", usage)
	}
}
