package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Plan is what Migrate would do to a database: read by `stoop migrate
// status` and `plan` before an upgrade, and by nothing else. See
// docs/architecture/data.md → Upgrades and rollback.
type Plan struct {
	Applied    int64       // highest migration applied; 0 on an empty database
	Newest     int64       // this binary's newest migration
	Floor      int64       // schema_floor in the database
	FloorAfter int64       // the floor once Pending has run
	Pending    []Migration // what Migrate would apply, in order
	Ahead      []int64     // applied migrations this binary does not carry
}

// Contract is whether Pending raises the floor: after it, the release
// that made this database can no longer start against it.
func (p Plan) Contract() bool { return p.FloorAfter > p.Floor }

// Refused is why Migrate would refuse this database, or nil.
func (p Plan) Refused() error {
	if p.Floor > p.Newest {
		return fmt.Errorf("database was changed by a newer Stoop that needs migration %d or later; this binary knows up to %d: run the newer version, or restore the backup taken before it", p.Floor, p.Newest)
	}
	return nil
}

// Inspect reads the database and changes nothing.
func Inspect(ctx context.Context, pool *pgxpool.Pool) (Plan, error) {
	ms, err := Migrations()
	if err != nil {
		return Plan{}, err
	}
	p := Plan{Newest: ms[len(ms)-1].Version}
	if p.Floor, err = readFloor(ctx, pool); err != nil {
		return Plan{}, err
	}
	applied, err := readApplied(ctx, pool)
	if err != nil {
		return Plan{}, err
	}
	known := map[int64]bool{}
	for _, m := range ms {
		known[m.Version] = true
		if !applied[m.Version] {
			p.Pending = append(p.Pending, m)
		}
	}
	for v := range applied {
		if v > p.Applied {
			p.Applied = v
		}
		if !known[v] {
			p.Ahead = append(p.Ahead, v)
		}
	}
	p.FloorAfter = p.Floor
	if len(p.Pending) > 0 && Floor > p.FloorAfter {
		p.FloorAfter = Floor
	}
	return p, nil
}

// readApplied is the set of migration versions goose has recorded, empty
// on a database goose has never touched.
func readApplied(ctx context.Context, pool *pgxpool.Pool) (map[int64]bool, error) {
	var exists bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('public.goose_db_version') IS NOT NULL").Scan(&exists); err != nil {
		return nil, fmt.Errorf("read applied migrations: %w", err)
	}
	applied := map[int64]bool{}
	if !exists {
		return applied, nil
	}
	rows, err := pool.Query(ctx, "SELECT version_id FROM goose_db_version WHERE is_applied AND version_id > 0")
	if err != nil {
		return nil, fmt.Errorf("read applied migrations: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		applied[v] = true
	}
	return applied, rows.Err()
}
