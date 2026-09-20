package app

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/getstoop/stoop/internal/instance"
)

func TestStorageState(t *testing.T) {
	const gb = 1_000_000_000
	tests := []struct {
		name        string
		probe       error
		total, free int64
		space       error
		used, quota int64
		want        instance.CheckState
		detail      string
	}{
		{"roomy, no quota", nil, 117 * gb, 60 * gb, nil, 4 * gb, 0, instance.CheckOK, "/data writable · 60.0 GB free of 117.0 GB"},
		{"quota clause", nil, 117 * gb, 60 * gb, nil, 4 * gb, 10 * gb, instance.CheckOK, "4.0 GB used of 10.0 GB quota"},
		{"volume 85 %", nil, 100 * gb, 15 * gb, nil, 0, 0, instance.CheckWarn, "15.0 GB free"},
		{"volume 95 %", nil, 100 * gb, 5 * gb, nil, 0, 0, instance.CheckDanger, "5.0 GB free"},
		{"quota 90 %", nil, 100 * gb, 80 * gb, nil, 9 * gb, 10 * gb, instance.CheckWarn, "9.0 GB used of 10.0 GB quota"},
		{"danger beats quota", nil, 100 * gb, 2 * gb, nil, 9 * gb, 10 * gb, instance.CheckDanger, "quota"},
		{"probe fails", errors.New("read-only file system"), 100 * gb, 50 * gb, nil, 0, 0, instance.CheckDanger, "/data not writable: read-only file system"},
		{"no statfs", nil, 0, 0, errors.New("not available"), 1 * gb, 0, instance.CheckOK, "free space not available"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			state, detail := storageState("/data", tc.probe, tc.total, tc.free, tc.space, tc.used, tc.quota)
			if state != tc.want || !strings.Contains(detail, tc.detail) {
				t.Errorf("got %d %q, want %d containing %q", state, detail, tc.want, tc.detail)
			}
		})
	}
}

func TestPostgresState(t *testing.T) {
	tests := []struct {
		name          string
		err           error
		ping          time.Duration
		acquired, max int32
		waited        bool
		want          instance.CheckState
		detail        string
	}{
		{"idle", nil, 800 * time.Microsecond, 1, 10, false, instance.CheckOK, "ping 800 µs · pool 1 of 10 in use"},
		{"waits", nil, 3 * time.Millisecond, 4, 10, true, instance.CheckWarn, "acquire waits in the last minute"},
		{"at max", nil, 3 * time.Millisecond, 10, 10, false, instance.CheckWarn, "pool at max"},
		{"slow", nil, 2500 * time.Millisecond, 1, 10, false, instance.CheckDanger, "ping 2.5 s"},
		{"down", errors.New("connection refused"), 0, 0, 10, false, instance.CheckDanger, "ping failed: connection refused"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			state, detail := postgresState(tc.err, tc.ping, tc.acquired, tc.max, tc.waited)
			if state != tc.want || !strings.Contains(detail, tc.detail) {
				t.Errorf("got %d %q, want %d containing %q", state, detail, tc.want, tc.detail)
			}
		})
	}
}

// The first sample is a baseline, growth warns for a minute, and a flat
// counter clears it.
func TestPostgresWaitsGrew(t *testing.T) {
	boot := time.Now()
	c := &postgresCheck{started: boot}
	if c.waitsGrew(3, boot.Add(5*time.Second)) || c.waitsGrew(5, boot.Add(20*time.Second)) {
		t.Error("the boot burst warned")
	}
	now := boot.Add(2 * time.Minute)
	if c.waitsGrew(5, now) {
		t.Error("a steady counter warned")
	}
	if !c.waitsGrew(6, now.Add(10*time.Second)) {
		t.Error("growth did not warn")
	}
	if !c.waitsGrew(6, now.Add(50*time.Second)) {
		t.Error("the warning did not hold for the minute")
	}
	if c.waitsGrew(6, now.Add(71*time.Second)) {
		t.Error("the warning outlived the minute")
	}
}
