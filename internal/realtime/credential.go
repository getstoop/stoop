package realtime

import (
	"github.com/coder/websocket"

	"github.com/getstoop/stoop/internal/authctx"
)

// StatusCredentialRevoked is the close code sent when the session a
// connection was opened with is revoked. A client must not reconnect
// with it.
const StatusCredentialRevoked websocket.StatusCode = 4001

// opensSocket is which credentials may open /ws: a session only
// (docs/architecture/realtime.md#credentials).
func opensSocket(kind authctx.CredentialKind) bool {
	return kind == authctx.CredentialSession
}
