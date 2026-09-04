package files

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
)

type quotaOnly int64

func (q quotaOnly) StorageQuotaBytes(context.Context) (int64, error) { return int64(q), nil }
func (q quotaOnly) MaxUploadBytes(context.Context) (int64, error)    { return 0, nil }

// Six inserts that would each fit on their own race for a quota with room
// for one. recordFile sums usage under the lock, so exactly one lands.
func TestRecordFileHoldsQuotaUnderConcurrency(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	owner := uuid.NewString()
	if _, err := pool.Exec(ctx, "INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 'o', 'o', 'x')", owner); err != nil {
		t.Fatal(err)
	}
	s := &Service{q: dbgen.New(pool), pool: pool, policy: quotaOnly(100)}

	const racers = 6
	errs := make([]error, racers)
	var wg sync.WaitGroup
	for i := range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id := uuid.NewString()
			_, errs[i] = s.recordFile(ctx, dbgen.CreateFileParams{
				ID: id, Kind: string(KindAttachment), OwnerID: owner, ContentType: "text/plain",
				Size: 60, Sha256: []byte{0}, StorageKey: "attachment/" + id, Name: "f",
			})
		}()
	}
	wg.Wait()

	landed := 0
	for _, err := range errs {
		switch {
		case err == nil:
			landed++
		case !errors.Is(err, ErrStorageFull):
			t.Errorf("unexpected error: %v", err)
		}
	}
	if landed != 1 {
		t.Errorf("rows recorded = %d, want 1", landed)
	}
	u, err := s.q.StorageUsage(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if u.Bytes > 100 {
		t.Errorf("usage %d exceeds the quota", u.Bytes)
	}
}

func TestInflightLimit(t *testing.T) {
	in := newInflight(2)
	for i := range 2 {
		if !in.acquire("a") {
			t.Fatalf("acquire %d should pass", i+1)
		}
	}
	if in.acquire("a") {
		t.Error("third acquire should be refused")
	}
	if !in.acquire("b") {
		t.Error("another key is independent")
	}
	in.release("a")
	if !in.acquire("a") {
		t.Error("a release frees a slot")
	}
	in.release("a")
	in.release("a")
	in.release("b")
	if len(in.byKey) != 0 {
		t.Errorf("idle keys should be dropped, have %v", in.byKey)
	}
}
