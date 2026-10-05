package instance

import (
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
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

// stageTURN validates a save of the relay; no URLs at all clears it.
func stageTURN(msg *instancev1.UpdateReachabilityRequest, current Reachability, save *settingSave) error {
	in := msg.Turn
	if in == nil {
		return nil
	}
	relay := TURNRelay{
		URLs: trimAll(in.Urls), Username: strings.TrimSpace(in.Username),
		Credential: keepSecret(in.Credential, current.TURN.Credential), STUNURLs: trimAll(in.StunUrls),
	}
	if len(relay.URLs) == 0 && len(relay.STUNURLs) == 0 {
		relay = TURNRelay{}
	} else if err := validateTURN(relay); err != nil {
		return err
	}
	save.write(keyTURN, relay)
	return nil
}

// toProto is the relay as the API shows it: the credential only as set
// or not.
func (relay TURNRelay) toProto() *instancev1.TurnRelay {
	return &instancev1.TurnRelay{
		Urls: relay.URLs, Username: relay.Username,
		HasCredential: relay.Credential != "", StunUrls: relay.STUNURLs,
	}
}
