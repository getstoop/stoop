package chat

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/dbgen"
)

// The edit and reaction writes refuse a placeholder themselves, so one
// that landed after the handler's own check still can't be written onto.
func TestPlaceholderGuardsInTheWrites(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	queries := dbgen.New(pool)
	user := dbtest.NewUser(t, pool, "ada", "member")
	var channel, message string
	if err := pool.QueryRow(ctx,
		`INSERT INTO channels (id, space_id, name, kind, dm_key) VALUES (gen_random_uuid(), NULL, '', 3, $1) RETURNING id`, user).Scan(&channel); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO messages (id, channel_id, author_id, content, deleted_at) VALUES (gen_random_uuid(), $1, $2, '', now()) RETURNING id`,
		channel, user).Scan(&message); err != nil {
		t.Fatal(err)
	}

	if _, err := queries.UpdateMessageContent(ctx, dbgen.UpdateMessageContentParams{ID: message, Content: "back"}); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("editing a placeholder: err = %v, want no rows", err)
	}
	if added, err := queries.AddReaction(ctx, dbgen.AddReactionParams{MessageID: message, UserID: user, Emoji: "👍"}); err != nil || added != 0 {
		t.Errorf("reacting to a placeholder: added %d, err %v; want 0, nil", added, err)
	}
}
