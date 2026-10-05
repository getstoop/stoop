package instance

import (
	"errors"
	"strings"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
)

const keyCloudflareTURN = "cloudflare_turn"

// CloudflareTURN is Cloudflare's TURN service.
type CloudflareTURN struct {
	KeyID    string `json:"key_id"`
	APIToken string `json:"api_token"`
}

// stageCloudflareTURN validates a save of the key; no key id clears it.
func stageCloudflareTURN(msg *instancev1.UpdateReachabilityRequest, current Reachability, save *settingSave) error {
	in := msg.Cloudflare
	if in == nil {
		return nil
	}
	cloudflare := CloudflareTURN{KeyID: strings.TrimSpace(in.KeyId), APIToken: strings.TrimSpace(in.ApiToken)}
	if cloudflare.KeyID == "" {
		cloudflare = CloudflareTURN{}
	} else {
		// The token in force belongs to its key; a new key needs its own.
		if current.Cloudflare.KeyID == cloudflare.KeyID {
			cloudflare.APIToken = keepSecret(cloudflare.APIToken, current.Cloudflare.APIToken)
		}
		if cloudflare.APIToken == "" {
			return apierr.Field(connect.CodeInvalidArgument, "cloudflare.api_token",
				errors.New("cloudflare TURN needs the key's API token"))
		}
	}
	save.write(keyCloudflareTURN, cloudflare)
	return nil
}

func (cloudflare CloudflareTURN) toProto() *instancev1.CloudflareTurn {
	return &instancev1.CloudflareTurn{KeyId: cloudflare.KeyID, HasApiToken: cloudflare.APIToken != ""}
}
