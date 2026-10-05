package upgrade

import (
	"context"
	"fmt"
	"os"

	"github.com/getstoop/stoop/internal/release"
)

// Rollback puts the previous bundle files back and restarts, once the
// running, newer image has confirmed the release in them can start
// against the database. It fails closed: no answer, no rollback. The
// older image is never asked: releases up to 0.2.0 treat an unknown
// verb as "serve".
func (u *Upgrader) Rollback(ctx context.Context) error {
	current, err := u.preflight(ctx)
	if err != nil {
		return err
	}
	prev, err := os.ReadFile(u.path(prevFile))
	if err != nil {
		return fmt.Errorf("no %s to roll back to", prevFile)
	}
	target := TagOf(string(prev))
	if target == "" {
		return fmt.Errorf("cannot read the stoop image tag from %s", prevFile)
	}
	u.say("rolling back %s -> %s", current, target)
	oldest, ok := u.startable(ctx)
	if !ok {
		return fmt.Errorf("could not confirm that %s can start against this database (the %s image did not answer `migrate status`).\nTo go back anyway: mv %s %s && docker compose up -d", target, current, prevFile, composeFile)
	}
	if release.Older(target, oldest) {
		return fmt.Errorf("%s cannot start against this database: only %s and later can, because an upgrade contained a contract migration.\nRestore the backup taken before that upgrade instead: docs/self-hosting/backups.md → Restoring in place", target, oldest)
	}
	if err := u.confirm(fmt.Sprintf("Put %s back and restart?", target)); err != nil {
		return err
	}
	parked := composeFile + rolledBack
	if err := os.Rename(u.path(composeFile), u.path(parked)); err != nil {
		return err
	}
	if err := os.Rename(u.path(prevFile), u.path(composeFile)); err != nil {
		return err
	}
	for _, name := range companions {
		if _, err := os.Stat(u.path(name + ".prev")); err == nil {
			_ = os.Rename(u.path(name), u.path(name+rolledBack))
			if err := os.Rename(u.path(name+".prev"), u.path(name)); err != nil {
				return err
			}
		}
	}
	if res := u.up(ctx); res.Code != 0 {
		u.showLogs(ctx)
		return fmt.Errorf("%s did not come up healthy; the %s file is kept as %s", target, current, parked)
	}
	u.say("back on %s; the %s file is kept as %s", target, current, parked)
	return nil
}
