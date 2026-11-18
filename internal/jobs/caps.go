package jobs

import (
	"cmp"
	"context"
	"slices"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
)

// A kind with Options.MaxInFlight is leased in its own transaction under
// a per-kind advisory lock, with a limit of the cap less the live leases,
// so dispatchers serialise per kind and no batch overshoots. A kind in a
// capped group takes the group's lock instead and is held to the group's
// cap as well as its own. See
// docs/architecture/runtime.md → Background work.

// leaseTurns orders the capped kinds by when this dispatcher last leased
// each, least recently first, so kinds sharing a group's few slots take
// turns: by name alone, the first would take every slot it frees while
// its backlog lasts. A kind never leased comes first, then by name.
type leaseTurns struct {
	mu   sync.Mutex
	turn uint64
	last map[string]uint64
}

func (t *leaseTurns) leased(kind string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.last == nil {
		t.last = map[string]uint64{}
	}
	t.turn++
	t.last[kind] = t.turn
}

func (t *leaseTurns) order(kinds []cappedKind) []cappedKind {
	t.mu.Lock()
	defer t.mu.Unlock()
	slices.SortStableFunc(kinds, func(left, right cappedKind) int {
		return cmp.Compare(t.last[left.kind], t.last[right.kind])
	})
	return kinds
}

// leaseCapped leases up to free rows of kind without taking its live
// leases past the cap; nil when the cap is reached.
func (s *Service) leaseCapped(ctx context.Context, now time.Time, kind cappedKind, free int, excluded []string) ([]dbgen.Job, error) {
	var rows []dbgen.Job
	err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		queries := s.queries.WithTx(tx)
		// A grouped kind locks its group, so every kind in it serialises
		// on the one count.
		lock := kind.kind
		if kind.group != "" {
			lock = "group:" + kind.group
		}
		if err := queries.LockKindLeasing(ctx, lock); err != nil {
			return err
		}
		live, err := queries.CountLiveLeases(ctx, dbgen.CountLiveLeasesParams{Kind: kind.kind, Now: now})
		if err != nil {
			return err
		}
		limit := min(free, kind.maxInFlight-int(live))
		if kind.group != "" {
			groupLive, err := queries.CountLiveLeasesOfKinds(ctx, dbgen.CountLiveLeasesOfKindsParams{Kinds: kind.groupKinds, Now: now})
			if err != nil {
				return err
			}
			limit = min(limit, kind.groupMax-int(groupLive))
		}
		if limit <= 0 {
			return nil
		}
		rows, err = queries.LeaseJobs(ctx, dbgen.LeaseJobsParams{
			Until: now.Add(s.lease), Now: now, Kinds: []string{kind.kind}, Excluded: excluded, Limit: int32Column(limit),
		})
		return err
	})
	return rows, err
}
