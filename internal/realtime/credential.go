package realtime

import (
	"github.com/coder/websocket"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// A connection is opened with a credential, and what it hears is what the
// credential covers (docs/proposals/access-model.md). Space topics are
// subscribed only where messages.read covers the space; the user topic is
// always subscribed, since it is the control plane (joins, revocation),
// and admits filters what it delivers.

// StatusCredentialRevoked is the close code sent when the credential a
// connection was opened with is revoked. A client must not reconnect
// with it.
const StatusCredentialRevoked websocket.StatusCode = 4001

// opensSocket is which credentials may open /ws: sessions and personal
// tokens. A bot's token stays off the socket in v1.
func opensSocket(k authctx.CredentialKind) bool {
	return k == authctx.CredentialSession || k == authctx.CredentialPersonalToken
}

// coversOwn reports whether c covers an action on the caller's own
// account, which a bounded credential never reaches.
func coversOwn(c authctx.Credential, a authctx.Action) bool {
	return c.Covers(a) && c.Reaches("", "")
}

func coversSpace(c authctx.Credential, a authctx.Action, spaceID string) bool {
	return c.Covers(a) && c.Reaches(spaceID, "")
}

// coveredSpaces is the subset of a user's spaces whose events c may hear.
func coveredSpaces(c authctx.Credential, spaceIDs []string) []string {
	out := make([]string, 0, len(spaceIDs))
	for _, id := range spaceIDs {
		if coversSpace(c, authctx.MessagesRead, id) {
			out = append(out, id)
		}
	}
	return out
}

// admits is the per-connection filter on what the user topic carries: a
// revocation only for the credential it names, direct-message events only
// with dms.read, and activity only with activity.read plus both read
// grants, since every item previews a message from a space or a direct
// message. Everything else on the topic is the user's own state (joins,
// read markers, mutes).
func admits(c authctx.Credential, ev *realtimev1.ServerEvent) bool {
	dm := func(spaceID string) bool { return spaceID != "" || coversOwn(c, authctx.DMsRead) }
	switch p := ev.Payload.(type) {
	case *realtimev1.ServerEvent_CredentialRevoked:
		return p.CredentialRevoked.CredentialId == c.ID
	case *realtimev1.ServerEvent_ActivityItemCreated:
		return coversOwn(c, authctx.ActivityRead) && c.Covers(authctx.MessagesRead) && coversOwn(c, authctx.DMsRead)
	case *realtimev1.ServerEvent_MessageCreated:
		return dm(p.MessageCreated.SpaceId)
	case *realtimev1.ServerEvent_MessageUpdated:
		return dm(p.MessageUpdated.SpaceId)
	case *realtimev1.ServerEvent_MessageDeleted:
		return dm(p.MessageDeleted.SpaceId)
	case *realtimev1.ServerEvent_ReactionsChanged:
		return dm(p.ReactionsChanged.SpaceId)
	case *realtimev1.ServerEvent_MessagePinned:
		return dm(p.MessagePinned.SpaceId)
	case *realtimev1.ServerEvent_UserTyping:
		return dm(p.UserTyping.SpaceId)
	}
	return true
}
