package instance

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
)

// countingDB counts the queries that touch instance_settings.
type countingDB struct {
	pool     *pgxpool.Pool
	settings atomic.Int64
}

func (db *countingDB) count(sql string) {
	if strings.Contains(sql, "instance_settings") {
		db.settings.Add(1)
	}
}

func (db *countingDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	db.count(sql)
	return db.pool.Exec(ctx, sql, args...)
}

func (db *countingDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	db.count(sql)
	return db.pool.Query(ctx, sql, args...)
}

func (db *countingDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	db.count(sql)
	return db.pool.QueryRow(ctx, sql, args...)
}

type oneUser struct{ UserAdmin }

func (oneUser) CountUsers(context.Context) (int64, error) { return 1, nil }

// The status and the reachability settings each read every setting with
// one query, however many they report.
func TestStatusAndReachabilityReadSettingsOnce(t *testing.T) {
	pool := dbtest.New(t)
	svc := New(pool, oneUser{})
	ctx := context.Background()
	if err := svc.writeSettings(ctx, []settingWrite{
		{keyInstanceName, "Casey's stoop"}, {keyStorageQuota, int64(1 << 30)},
		{keyWebhooksIncoming, false}, {keyPublicURL, "https://chat.example.com"},
	}); err != nil {
		t.Fatal(err)
	}
	counter := &countingDB{pool: pool}
	svc.q = dbgen.New(counter)

	status, err := svc.status(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if status.InstanceName != "Casey's stoop" || status.StorageQuotaBytes != 1<<30 || status.WebhooksIncoming {
		t.Errorf("status read the wrong values: %+v", status)
	}
	if got := counter.settings.Swap(0); got != 1 {
		t.Errorf("status: %d settings queries, want 1", got)
	}

	if _, err := svc.GetInstanceStatus(ctx, connect.NewRequest(&instancev1.GetInstanceStatusRequest{})); err != nil {
		t.Fatal(err)
	}
	if got := counter.settings.Swap(0); got != 1 {
		t.Errorf("GetInstanceStatus: %d settings queries, want 1", got)
	}

	reachability, err := svc.Reachability(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if reachability.PublicURL != "https://chat.example.com" {
		t.Errorf("reachability read the wrong public URL: %q", reachability.PublicURL)
	}
	if got := counter.settings.Swap(0); got != 1 {
		t.Errorf("reachability: %d settings queries, want 1", got)
	}
}
