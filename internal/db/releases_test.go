package db_test

import (
	"testing"

	"github.com/getstoop/stoop/internal/db"
)

func TestReleases(t *testing.T) {
	ms, err := db.Migrations()
	if err != nil {
		t.Fatal(err)
	}
	known := map[int64]bool{}
	for _, m := range ms {
		known[m.Version] = true
	}
	var prev db.Release
	for i, r := range db.Releases {
		if i > 0 && r.Migration <= prev.Migration {
			t.Errorf("%s (%d) is not after %s (%d)", r.Version, r.Migration, prev.Version, prev.Migration)
		}
		if !known[r.Migration] {
			t.Errorf("%s names migration %d, which the binary does not carry", r.Version, r.Migration)
		}
		prev = r
	}
	if r, ok := db.OldestStartable(db.Floor); !ok || r.Migration < db.Floor {
		t.Errorf("no tagged release starts against the floor %d: got %+v", db.Floor, r)
	}
}

func TestOldestStartable(t *testing.T) {
	if r, ok := db.OldestStartable(0); !ok || r.Version != "0.1.0" {
		t.Errorf("floor 0: got %+v %v, want 0.1.0", r, ok)
	}
	if r, ok := db.OldestStartable(29); !ok || r.Version != "0.2.0" {
		t.Errorf("floor 29: got %+v %v, want 0.2.0", r, ok)
	}
	if _, ok := db.OldestStartable(1 << 40); ok {
		t.Error("a floor above every release should have no startable release")
	}
}

func TestMigrationsAreOrdered(t *testing.T) {
	ms, err := db.Migrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) < 42 || ms[0].Version != 1 || ms[0].Name != "init" {
		t.Fatalf("got %d migrations starting %+v", len(ms), ms[0])
	}
	newest, err := db.Newest()
	if err != nil {
		t.Fatal(err)
	}
	if newest != ms[len(ms)-1].Version {
		t.Errorf("Newest() = %d, last listed = %d", newest, ms[len(ms)-1].Version)
	}
}
