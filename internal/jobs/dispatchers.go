package jobs

import (
	"context"
	"fmt"
	"time"
)

// NotifyChannel is the Postgres channel the insert of a job raises, so a
// listening dispatcher wakes without waiting for its poll.
const NotifyChannel = "stoop_jobs"

// Dispatcher is one heartbeat row: a process that works the queue.
type Dispatcher struct {
	ID        string
	Host      string
	Workers   int
	StartedAt time.Time
	SeenAt    time.Time
}

// Dispatchers lists every heartbeat row, the most recently seen first.
func (s *Service) Dispatchers(ctx context.Context) ([]Dispatcher, error) {
	rows, err := s.queries.ListDispatchers(ctx)
	if err != nil {
		return nil, fmt.Errorf("list dispatchers: %w", err)
	}
	dispatchers := make([]Dispatcher, len(rows))
	for index, row := range rows {
		dispatchers[index] = Dispatcher{
			ID: row.ID, Host: row.Host, Workers: int(row.Workers), StartedAt: row.StartedAt, SeenAt: row.SeenAt,
		}
	}
	return dispatchers, nil
}
