package main

import (
	"testing"

	"github.com/getstoop/stoop/internal/db"
)

func TestAdminRefusal(t *testing.T) {
	if err := adminRefusal(db.Plan{Applied: 37, Newest: 42, Pending: []db.Migration{{Version: 38, Name: "x"}}}); err == nil {
		t.Error("behind: no refusal")
	}
	if err := adminRefusal(db.Plan{Applied: 999, Newest: 42, Floor: 999}); err == nil {
		t.Error("too old: no refusal")
	}
	if err := adminRefusal(db.Plan{Applied: 45, Newest: 42, Ahead: []int64{45}}); err != nil {
		t.Errorf("ahead, additive: %v", err)
	}
	if err := adminRefusal(db.Plan{Applied: 42, Newest: 42}); err != nil {
		t.Errorf("up to date: %v", err)
	}
}
