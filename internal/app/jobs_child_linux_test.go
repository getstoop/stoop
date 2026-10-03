//go:build linux

package app

import (
	"context"
	"syscall"
	"testing"
)

func TestJobsChildDiesWithTheServer(t *testing.T) {
	cmd := newTestJobsChild().command(context.Background())
	if cmd.SysProcAttr == nil || cmd.SysProcAttr.Pdeathsig != syscall.SIGTERM {
		t.Errorf("SysProcAttr = %+v, want Pdeathsig SIGTERM", cmd.SysProcAttr)
	}
}
