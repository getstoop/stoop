package integrations

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/db/dbtest"
)

// The Queue contract, written against the interface so a second backend
// inherits it: ordering within a lane, one in flight per lane, lease
// expiry counting as an attempt.
func TestPostgresQueueContract(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	spaceID, userID, laneA, laneB := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, q := range []string{
		`INSERT INTO users (id, username, display_name, role) VALUES ('` + userID + `', 'casey', 'Casey', 'admin')`,
		`INSERT INTO spaces (id, name, owner_id) VALUES ('` + spaceID + `', 'Porch', '` + userID + `')`,
		`INSERT INTO outgoing_webhooks (id, space_id, url, secret, event_types, name, created_by) VALUES ('` + laneA + `', '` + spaceID + `', 'https://a.example', 'x', '{}', 'a', '` + userID + `')`,
		`INSERT INTO outgoing_webhooks (id, space_id, url, secret, event_types, name, created_by) VALUES ('` + laneB + `', '` + spaceID + `', 'https://b.example', 'x', '{}', 'b', '` + userID + `')`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	clock := time.Now()
	q := NewPostgresQueue(pool)
	q.now = func() time.Time { return clock }

	var queue Queue = q
	ids := map[string]string{}
	for i, lane := range []struct{ lane, name string }{{laneA, "a1"}, {laneA, "a2"}, {laneB, "b1"}} {
		id := newID()
		ids[lane.name] = id
		if err := queue.Enqueue(ctx, Item{ID: id, Lane: lane.lane, Event: "message.created", Sequence: uint64(i + 1), Body: []byte("{}")}); err != nil {
			t.Fatal(err)
		}
	}

	// One item per lane at a time, oldest first.
	leased, err := queue.Lease(ctx, 10, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if len(leased) != 2 || leased[0].ID != ids["a1"] || leased[1].ID != ids["b1"] || leased[0].Attempt != 1 {
		t.Fatalf("first lease = %+v", leased)
	}
	if again, _ := queue.Lease(ctx, 10, 30*time.Second); len(again) != 0 {
		t.Errorf("leased behind a live lease: %+v", again)
	}

	// Acking a1 releases the lane for a2; a nacked b1 waits its delay.
	if err := queue.Ack(ctx, ids["a1"], Attempt{StatusCode: 200}); err != nil {
		t.Fatal(err)
	}
	if err := queue.Nack(ctx, ids["b1"], 5*time.Second, Attempt{StatusCode: 500}); err != nil {
		t.Fatal(err)
	}
	leased, _ = queue.Lease(ctx, 10, 30*time.Second)
	if len(leased) != 1 || leased[0].ID != ids["a2"] {
		t.Fatalf("after ack = %+v", leased)
	}
	clock = clock.Add(6 * time.Second)
	leased, _ = queue.Lease(ctx, 10, 30*time.Second)
	if len(leased) != 1 || leased[0].ID != ids["b1"] || leased[0].Attempt != 2 {
		t.Fatalf("after the nack delay = %+v", leased)
	}

	// An expired lease comes back as another attempt; a dead item never does.
	clock = clock.Add(time.Minute)
	leased, _ = queue.Lease(ctx, 10, 30*time.Second)
	got := map[string]int{}
	for _, l := range leased {
		got[l.ID] = l.Attempt
	}
	if got[ids["a2"]] != 2 || got[ids["b1"]] != 3 {
		t.Fatalf("after lease expiry = %v", got)
	}
	if err := queue.Dead(ctx, ids["a2"], Attempt{Error: "gave up"}); err != nil {
		t.Fatal(err)
	}
	if err := queue.Ack(ctx, ids["b1"], Attempt{StatusCode: 204}); err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(time.Minute)
	if leased, _ = queue.Lease(ctx, 10, 30*time.Second); len(leased) != 0 {
		t.Errorf("finished items leased again: %+v", leased)
	}

	// The success cleared its body; the dead item kept it for redelivery.
	var bodies []bool
	rows, err := pool.Query(ctx, `SELECT body IS NULL FROM webhook_deliveries WHERE id IN ($1, $2) ORDER BY id = $1 DESC`, ids["a1"], ids["a2"])
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var isNull bool
		if err := rows.Scan(&isNull); err != nil {
			t.Fatal(err)
		}
		bodies = append(bodies, isNull)
	}
	rows.Close()
	if len(bodies) != 2 || !bodies[0] || bodies[1] {
		t.Errorf("body kept for success / cleared for dead: %v", bodies)
	}
}
