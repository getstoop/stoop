package chat

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fixedRetention int

func (fixedRetention) MembersMayCreateSpaces(context.Context) (bool, error)   { return true, nil }
func (days fixedRetention) MessageRetentionDays(context.Context) (int, error) { return int(days), nil }
func (fixedRetention) VoiceAvailable() bool                                   { return true }

// unreadableRetention is a settings row that cannot be read.
type unreadableRetention struct{ fixedRetention }

func (unreadableRetention) MessageRetentionDays(context.Context) (int, error) {
	return 0, errors.New("settings row is corrupt")
}

// The floor the list RPCs hand out is the sweep's own cutoff for the same
// instant, and nothing at all while retention is off, unwired, or cannot
// be read: the floor is advisory and never fails a list.
func TestRetentionFloorIsTheSweepsCutoff(t *testing.T) {
	now := time.Date(2026, time.October, 21, 12, 0, 0, 0, time.UTC)
	svc := &Service{}
	if floor := svc.retentionFloorID(context.Background(), now); floor != "" {
		t.Errorf("no policy: floor %q, want none", floor)
	}
	svc.policy = fixedRetention(0)
	if floor := svc.retentionFloorID(context.Background(), now); floor != "" {
		t.Errorf("retention off: floor %q, want none", floor)
	}
	svc.policy = unreadableRetention{}
	if floor := svc.retentionFloorID(context.Background(), now); floor != "" {
		t.Errorf("unreadable setting: floor %q, want none", floor)
	}
	svc.policy = fixedRetention(30)
	if floor, want := svc.retentionFloorID(context.Background(), now), cutoffID(retentionCutoff(now, 30)); floor != want {
		t.Errorf("floor = %s, want the sweep's cutoff %s", floor, want)
	}
}
