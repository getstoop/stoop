package realtime

import (
	"context"
	"time"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
)

// Do not disturb as the gateway holds it: read through a port on connect,
// followed from DoNotDisturbChanged, and ended by a timer only where it has
// an end. docs/proposals/presence-and-dnd.md.

type dndSetting struct {
	on    bool
	until *time.Time
}

// UseDoNotDisturb wires the lookup. Without it nobody reads as being on do
// not disturb.
func (g *Gateway) UseDoNotDisturb(l DoNotDisturbLookup) { g.dnd = l }

// lookupDoNotDisturb reads a person's do not disturb; false when it could
// not be read, so what the gateway already holds stands.
func (g *Gateway) lookupDoNotDisturb(ctx context.Context, userID string) (dndSetting, bool) {
	if g.dnd == nil {
		return dndSetting{}, false
	}
	on, until, err := g.dnd.DoNotDisturb(ctx, userID)
	if err != nil {
		g.log.Error("look up do not disturb", "user_id", userID, "err", err)
		return dndSetting{}, false
	}
	return dndSetting{on: on, until: until}, true
}

func dndFrom(c *realtimev1.DoNotDisturbChanged) dndSetting {
	s := dndSetting{on: c.Dnd}
	if c.Dnd && c.Until != nil {
		until := c.Until.AsTime()
		s.until = &until
	}
	return s
}

// applyDoNotDisturb records a person's do not disturb; true when what
// others see changed. When it reaches its end, the timer says so.
func (g *Gateway) applyDoNotDisturb(userID string, s dndSetting) bool {
	return g.presence.setDnd(userID, s.on, s.until, func() {
		g.publishPresence(userID, g.presence.spacesOf(userID), true)
	})
}
