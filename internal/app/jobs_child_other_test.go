//go:build !linux

package app

import (
	"context"
	"testing"
)

func TestJobsChildHasNoProcessAttributes(t *testing.T) {
	if cmd := newTestJobsChild().command(context.Background()); cmd.SysProcAttr != nil {
		t.Errorf("SysProcAttr = %+v, want none off Linux", cmd.SysProcAttr)
	}
}
