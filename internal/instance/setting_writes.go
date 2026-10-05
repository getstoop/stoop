package instance

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/getstoop/stoop/internal/dbgen"
)

func (s *Service) writeJSON(ctx context.Context, key string, v any) error {
	return s.writeSettings(ctx, []settingWrite{{key, v}})
}

// settingWrite is one validated value waiting to be saved.
type settingWrite struct {
	key   string
	value any
}

// writeSettings saves every write or none, so a handler that validates
// first and then calls this once can't half-apply a refused save.
func (s *Service) writeSettings(ctx context.Context, writes []settingWrite) error {
	if len(writes) == 0 {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := s.q.WithTx(tx)
	for _, write := range writes {
		raw, err := json.Marshal(write.value)
		if err != nil {
			return fmt.Errorf("encode %s: %w", write.key, err)
		}
		if err := queries.UpsertSetting(ctx, dbgen.UpsertSettingParams{Key: write.key, Value: raw}); err != nil {
			return fmt.Errorf("write %s: %w", write.key, err)
		}
	}
	return tx.Commit(ctx)
}
