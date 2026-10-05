package instance

import (
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	"github.com/getstoop/stoop/internal/apierr"
)

const keyTURN = "turn"

// TURNRelay is a relay with fixed credentials.
type TURNRelay struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username"`
	Credential string   `json:"credential"`
	STUNURLs   []string `json:"stun_urls"`
}

func validateTURN(t TURNRelay) error {
	for _, list := range []struct {
		field string
		urls  []string
	}{{"turn.urls", t.URLs}, {"turn.stun_urls", t.STUNURLs}} {
		for _, u := range list.urls {
			if !strings.HasPrefix(u, "turn:") && !strings.HasPrefix(u, "turns:") && !strings.HasPrefix(u, "stun:") && !strings.HasPrefix(u, "stuns:") {
				return apierr.Field(connect.CodeInvalidArgument, list.field,
					fmt.Errorf("%q is not a turn:, turns:, stun:, or stuns: URL", u))
			}
		}
	}
	if len(t.URLs) > 0 && (t.Username == "" || t.Credential == "") {
		field := "turn.credential"
		if t.Username == "" {
			field = "turn.username"
		}
		return apierr.Field(connect.CodeInvalidArgument, field,
			errors.New("a TURN relay needs a username and credential"))
	}
	return nil
}
