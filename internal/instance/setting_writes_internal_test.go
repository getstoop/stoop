package instance

import (
	"context"
	"testing"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// A save's after-commit steps run once its writes commit, and never when
// they fail.
func TestCommitRunsAfterCommitStepsOnlyOnSuccess(t *testing.T) {
	svc := New(dbtest.New(t), oneUser{})
	ctx := context.Background()

	applied := 0
	refused := &settingSave{}
	refused.write(keyInstanceName, "Casey's stoop")
	refused.write(keyPublicURL, func() {}) // can't be encoded, so nothing commits
	refused.then(func() { applied++ })
	if err := svc.commit(ctx, refused); err == nil {
		t.Fatal("a write that can't be encoded must fail the save")
	}
	if applied != 0 {
		t.Fatalf("after-commit step ran for a failed save")
	}
	if name, err := svc.InstanceName(ctx); err != nil || name == "Casey's stoop" {
		t.Fatalf("a failed save wrote part of itself: %q, %v", name, err)
	}

	saved := &settingSave{}
	saved.write(keyInstanceName, "Casey's stoop")
	saved.then(func() { applied++ })
	if err := svc.commit(ctx, saved); err != nil {
		t.Fatal(err)
	}
	if applied != 1 {
		t.Fatalf("after-commit step ran %d times, want 1", applied)
	}
}
