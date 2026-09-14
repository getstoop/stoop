package integrations

import (
	"encoding/json"
	"mime"
	"strings"
	"unicode/utf8"
)

// Vendor adapters: each sender's body shape, coerced to the text that is
// posted. See docs/proposals/webhooks.md → Adapters.

// maxPostRunes is chat's message limit (internal/chat/messages.go).
const maxPostRunes = 4000

// adapt turns a request body into message text; "" means nothing to post.
// Plain text is posted as sent; anything else is read as JSON when it is.
func adapt(contentType string, raw []byte) string {
	mt, _, _ := mime.ParseMediaType(contentType)
	if mt != "text/plain" && (mt == "application/json" || looksLikeJSON(raw)) {
		return strings.TrimSpace(fromJSON(raw))
	}
	return strings.TrimSpace(string(raw))
}

func looksLikeJSON(raw []byte) bool {
	return strings.HasPrefix(strings.TrimSpace(string(raw)), "{")
}

// fromJSON reads, in order: Stoop and Slack's text, Discord's content,
// then Slack attachments.
func fromJSON(raw []byte) string {
	var body struct {
		Text        string `json:"text"`
		Content     string `json:"content"`
		Attachments []struct {
			Title string `json:"title"`
			Text  string `json:"text"`
		} `json:"attachments"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return ""
	}
	if t := strings.TrimSpace(body.Text); t != "" {
		return t
	}
	if t := strings.TrimSpace(body.Content); t != "" {
		return t
	}
	var parts []string
	for _, a := range body.Attachments {
		for _, p := range []string{a.Title, a.Text} {
			if p = strings.TrimSpace(p); p != "" {
				parts = append(parts, p)
			}
		}
	}
	return strings.Join(parts, "\n")
}

// truncate cuts text to the message limit, ending it with an ellipsis.
func truncate(text string) string {
	if utf8.RuneCountInString(text) <= maxPostRunes {
		return text
	}
	runes := []rune(text)
	return strings.TrimRight(string(runes[:maxPostRunes-1]), " \n") + "…"
}
