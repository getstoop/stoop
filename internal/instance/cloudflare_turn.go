package instance

const keyCloudflareTURN = "cloudflare_turn"

// CloudflareTURN is Cloudflare's TURN service.
type CloudflareTURN struct {
	KeyID    string `json:"key_id"`
	APIToken string `json:"api_token"`
}
