package jobs

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
)

// A kind with Options.MaxInFlight is leased in its own transaction under
// a per-kind advisory lock, with a limit of the cap less the live leases,
// so dispatchers serialise per kind and no batch overshoots. See
// docs/architecture/runtime.md → Background work.

// leaseCapped leases up to free rows of kind without taking its live
// leases past the cap; nil when the cap is reached.
func (s *Service) leaseCapped(ctx context.Context, now time.Time, kind cappedKind, free int, excluded []string) ([]dbgen.Job, error) {
	var rows []dbgen.Job
	err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		queries := s.queries.WithTx(tx)
		if err := queries.LockKindLeasing(ctx, kind.kind); err != nil {
			return err
		}
		live, err := queries.CountLiveLeases(ctx, dbgen.CountLiveLeasesParams{Kind: kind.kind, Now: now})
		if err != nil {
			return err
		}
		limit := min(free, kind.maxInFlight-int(live))
		if limit <= 0 {
			return nil
		}
		rows, err = queries.LeaseJobs(ctx, dbgen.LeaseJobsParams{
			Until: now.Add(s.lease), Now: now, Kinds: []string{kind.kind}, Excluded: excluded, Limit: int32(limit),
		})
		return err
	})
	return rows, err
}
