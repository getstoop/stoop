package push

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/webpush"
)

// What a notification carries, encrypted to the device: the facts the
// phone composes its title, subtitle and body from, never the composed
// strings. The contract is docs/architecture/push-payload.md; the
// fixtures in testdata/ are its examples.

// PayloadVersion is the payload's v. A change a version 1 reader would
// misread raises it.
const PayloadVersion = 1

// Payload is version 1. Every field is always present; a string the item
// has none of is empty.
type Payload struct {
	V            int    `json:"v"`
	ServerID     string `json:"serverId"`
	ItemID       string `json:"itemId"`
	Kind         int32  `json:"kind"`
	SpaceID      string `json:"spaceId"`
	ChannelID    string `json:"channelId"`
	ThreadRootID string `json:"threadRootId"`
	MessageID    string `json:"messageId"`
	ActorName    string `json:"actorName"`
	Preview      string `json:"preview"`
	// PreviewCut says the preview was shortened to fit the payload limit.
	PreviewCut  bool   `json:"previewCut"`
	SpaceName   string `json:"spaceName"`
	ChannelName string `json:"channelName"`
	// Waiting is the recipient's total on this server, what the app's
	// icon counts for it.
	Waiting int `json:"waiting"`
}

// encodeJSON writes value without HTML escaping, which only spends bytes,
// and without the encoder's trailing newline.
func encodeJSON(value any) []byte {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	// Strings, numbers and booleans: nothing here can fail to encode.
	_ = encoder.Encode(value)
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n"))
}

// encodePayload is the payload as sent, its preview cut on a rune
// boundary until the whole fits webpush.MaxPayloadBytes. A JSON string
// escapes each character on its own, so the cut adds up each rune's
// encoded size against what is left once the rest is written.
func encodePayload(payload Payload, limit int) []byte {
	payload.Preview = strings.ToValidUTF8(payload.Preview, "�")
	if body := encodeJSON(payload); len(body) <= limit {
		return body
	}
	preview := payload.Preview
	payload.Preview, payload.PreviewCut = "", true
	budget := limit - len(encodeJSON(payload))
	used, end := 0, 0
	for index, char := range preview {
		// A rune's string, quoted, less the quotes.
		cost := len(encodeJSON(string(char))) - 2
		if used+cost > budget {
			break
		}
		used += cost
		end = index + len(string(char))
	}
	payload.Preview = preview[:end]
	return encodeJSON(payload)
}

// payloadLimit is the most a payload may take.
const payloadLimit = webpush.MaxPayloadBytes

// collapseKey is what a newer notification replaces an older one by: the
// mobile app's notification identifier less its server (core
// activityEntryKey, by kind): a direct message's conversation, a thread
// reply's thread, and any other item on its own.
func collapseKey(item ItemFacts) string {
	key := item.ID
	switch chatv1.ActivityKind(item.Kind) {
	case chatv1.ActivityKind_ACTIVITY_KIND_DM:
		key = item.ChannelID
	case chatv1.ActivityKind_ACTIVITY_KIND_THREAD_REPLY:
		if item.ThreadRootID != "" {
			key = item.ThreadRootID
		}
	}
	return strconv.Itoa(int(item.Kind)) + ":" + key
}

// pushTopic is the Topic header for an item (RFC 8030 §5.4): 24 bytes of
// the collapse key's SHA-256 in base64url, 32 characters, so the push
// service sees no id of ours.
func pushTopic(item ItemFacts) string {
	sum := sha256.Sum256([]byte(collapseKey(item)))
	return base64.RawURLEncoding.EncodeToString(sum[:24])
}
