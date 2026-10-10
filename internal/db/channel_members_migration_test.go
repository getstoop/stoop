package db_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// Migration 00062 keeps everyone in every text channel of their spaces,
// gives a space with no default channel its first text channel as one,
// and makes every default channel required.
func TestChannelMembersMigrationBackfills(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer func() { _ = sqlDB.Close() }()
	goose.SetBaseFS(os.DirFS("."))
	defer goose.SetBaseFS(nil)
	if err := goose.DownToContext(ctx, sqlDB, "migrations", 61); err != nil {
		t.Fatal(err)
	}
	const (
		ada     = "00000000-0000-7000-8000-000000000001"
		bea     = "00000000-0000-7000-8000-000000000002"
		porch   = "00000000-0000-7000-8000-000000000010"
		yard    = "00000000-0000-7000-8000-000000000011"
		general = "00000000-0000-7000-8000-000000000020"
		random  = "00000000-0000-7000-8000-000000000021"
		steps   = "00000000-0000-7000-8000-000000000022"
		lawn    = "00000000-0000-7000-8000-000000000023"
		shed    = "00000000-0000-7000-8000-000000000024"
	)
	for _, statement := range []string{
		`INSERT INTO users (id, username) VALUES ('` + ada + `', 'ada'), ('` + bea + `', 'bea')`,
		`INSERT INTO spaces (id, name, owner_id) VALUES ('` + porch + `', 'Porch', '` + ada + `'), ('` + yard + `', 'Yard', '` + ada + `')`,
		`INSERT INTO space_members (space_id, user_id, role) VALUES
			('` + porch + `', '` + ada + `', 'owner'), ('` + porch + `', '` + bea + `', 'member'),
			('` + yard + `', '` + ada + `', 'owner')`,
		// Porch has no default chosen; random sorts first by position.
		`INSERT INTO channels (id, space_id, name, kind, position) VALUES
			('` + general + `', '` + porch + `', 'general', 1, 1),
			('` + random + `', '` + porch + `', 'random', 1, 0),
			('` + steps + `', '` + porch + `', 'steps', 2, 0),
			('` + lawn + `', '` + yard + `', 'lawn', 1, 0),
			('` + shed + `', '` + yard + `', 'shed', 1, 1)`,
		`UPDATE spaces SET default_channel_id = '` + shed + `' WHERE id = '` + yard + `'`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}
	if err := goose.UpContext(ctx, sqlDB, "migrations"); err != nil {
		t.Fatal(err)
	}

	count := func(query string, args ...any) int {
		t.Helper()
		var found int
		if err := pool.QueryRow(ctx, query, args...).Scan(&found); err != nil {
			t.Fatal(err)
		}
		return found
	}
	// Two people in Porch's two text channels, one in Yard's two; nobody
	// in the voice channel.
	if rows := count(`SELECT count(*) FROM channel_members`); rows != 6 {
		t.Errorf("channel_members rows = %d, want 6", rows)
	}
	if rows := count(`SELECT count(*) FROM channel_members WHERE channel_id = $1`, steps); rows != 0 {
		t.Errorf("voice channel has %d member rows, want 0", rows)
	}
	for space, want := range map[string]string{porch: random, yard: shed} {
		var chosen string
		if err := pool.QueryRow(ctx, `SELECT default_channel_id FROM spaces WHERE id = $1`, space).Scan(&chosen); err != nil {
			t.Fatal(err)
		}
		if chosen != want {
			t.Errorf("space %s default = %s, want %s", space, chosen, want)
		}
	}
	if required := count(`SELECT count(*) FROM channels WHERE required`); required != 2 {
		t.Errorf("required channels = %d, want 2", required)
	}
	if required := count(`SELECT count(*) FROM channels WHERE required AND id IN ($1, $2)`, random, shed); required != 2 {
		t.Errorf("the default channels are not the required ones")
	}

	// Leaving the space takes the channel rows with it.
	if _, err := pool.Exec(ctx, `DELETE FROM space_members WHERE user_id = $1`, bea); err != nil {
		t.Fatal(err)
	}
	if rows := count(`SELECT count(*) FROM channel_members WHERE user_id = $1`, bea); rows != 0 {
		t.Errorf("rows after leaving the space = %d, want 0", rows)
	}
	// Only a space's text channel can be required.
	if _, err := pool.Exec(ctx, `UPDATE channels SET required = true WHERE id = $1`, steps); err == nil {
		t.Error("a voice channel was allowed to be required")
	}
}
