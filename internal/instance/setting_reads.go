package instance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// settingsSnapshot is every saved setting, read with one query and carried
// on the context of a read that needs many (the status, reachability).
type settingsSnapshot map[string][]byte

type snapshotKey struct{}

// withSettings returns ctx carrying every saved setting, so the reads made
// with it cost one query between them. A ctx that already carries them is
// returned as it is. Only for reads: a write made under it is not seen.
func (s *Service) withSettings(ctx context.Context) (context.Context, error) {
	if _, ok := ctx.Value(snapshotKey{}).(settingsSnapshot); ok {
		return ctx, nil
	}
	rows, err := s.q.ListSettings(ctx)
	if err != nil {
		return ctx, fmt.Errorf("read settings: %w", err)
	}
	snapshot := make(settingsSnapshot, len(rows))
	for _, row := range rows {
		snapshot[row.Key] = row.Value
	}
	return context.WithValue(ctx, snapshotKey{}, snapshot), nil
}

// lookupSetting is one saved value and whether there is one, from the
// snapshot on ctx when it carries one.
func (s *Service) lookupSetting(ctx context.Context, key string) ([]byte, bool, error) {
	if snapshot, ok := ctx.Value(snapshotKey{}).(settingsSnapshot); ok {
		raw, found := snapshot[key]
		return raw, found, nil
	}
	raw, err := s.q.GetSetting(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("read %s: %w", key, err)
	}
	return raw, true, nil
}

// readSettingOr decodes one setting, or returns fallback when none is saved.
func readSettingOr[T any](ctx context.Context, s *Service, key string, fallback T) (T, error) {
	raw, found, err := s.lookupSetting(ctx, key)
	if err != nil || !found {
		return fallback, err
	}
	var value T
	if err := json.Unmarshal(raw, &value); err != nil {
		return fallback, fmt.Errorf("decode %s: %w", key, err)
	}
	return value, nil
}
