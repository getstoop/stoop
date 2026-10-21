package chat

import (
	"context"
	"testing"
	"time"
)

type fixedRetention int

func (fixedRetention) MembersMayCreateSpaces(context.Context) (bool, error)   { return true, nil }
func (days fixedRetention) MessageRetentionDays(context.Context) (int, error) { return int(days), nil }
func (fixedRetention) VoiceAvailable() bool                                   { return true }

// The floor the list RPCs hand out is the sweep's own cutoff for the same
// instant, and nothing at all while retention is off or unwired.
func TestRetentionFloorIsTheSweepsCutoff(t *testing.T) {
	now := time.Date(2026, time.October, 21, 12, 0, 0, 0, time.UTC)
	svc := &Service{}
	if floor, err := svc.retentionFloorID(context.Background(), now); err != nil || floor != "" {
		t.Errorf("no policy: floor %q %v, want none", floor, err)
	}
	svc.policy = fixedRetention(0)
	if floor, err := svc.retentionFloorID(context.Background(), now); err != nil || floor != "" {
		t.Errorf("retention off: floor %q %v, want none", floor, err)
	}
	svc.policy = fixedRetention(30)
	floor, err := svc.retentionFloorID(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if want := cutoffID(retentionCutoff(now, 30)); floor != want {
		t.Errorf("floor = %s, want the sweep's cutoff %s", floor, want)
	}
}
