package push

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"unicode/utf8"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
)

// The fixtures are the contract's examples (docs/architecture/push-payload.md)
// and are byte for byte what the server writes for them, so a decoder on
// the phone can be tested against the same files.
func TestPayloadFixtures(t *testing.T) {
	files, err := filepath.Glob("testdata/payload-*.json")
	if err != nil || len(files) < 4 {
		t.Fatalf("fixtures: %v, %v", files, err)
	}
	for _, file := range files {
		t.Run(filepath.Base(file), func(t *testing.T) {
			raw, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			raw = bytes.TrimSuffix(raw, []byte("\n"))
			decoder := json.NewDecoder(bytes.NewReader(raw))
			decoder.DisallowUnknownFields()
			var payload Payload
			if err := decoder.Decode(&payload); err != nil {
				t.Fatalf("does not decode as a Payload: %v", err)
			}
			if payload.V != PayloadVersion || payload.ServerID == "" || payload.ItemID == "" || payload.ChannelID == "" || payload.MessageID == "" {
				t.Errorf("fixture lacks a required field: %+v", payload)
			}
			var fields map[string]any
			_ = json.Unmarshal(raw, &fields)
			if len(fields) != 14 {
				t.Errorf("%d fields, want all 14 present", len(fields))
			}
			// What the server writes for it, unless the fixture shows a
			// cut, whose preview the server would have cut itself.
			if !payload.PreviewCut {
				if got := encodePayload(payload, payloadLimit); !bytes.Equal(got, raw) {
					t.Errorf("the server writes\n%s\nnot\n%s", got, raw)
				}
			}
		})
	}
}

// A preview too long for the limit is cut on a rune boundary to fit, and
// flagged; one that fits is left alone.
func TestPayloadPreviewIsCutToFit(t *testing.T) {
	base := Payload{
		V: PayloadVersion, ServerID: "k3x9pq", ItemID: "0193a5b2-0000-7000-8000-000000000001", Kind: 1,
		SpaceID: "0193a5b2-0000-7000-8000-0000000000a1", ChannelID: "0193a5b2-0000-7000-8000-0000000000c1",
		MessageID: "0193a5b2-0000-7000-8000-0000000000e1", ActorName: "Grace Hopper",
		SpaceName: "The Stoop", ChannelName: "general", Waiting: 3,
	}
	short := base
	short.Preview = "fits <easily> & \"quoted\""
	var decoded Payload
	if err := json.Unmarshal(encodePayload(short, payloadLimit), &decoded); err != nil || decoded.Preview != short.Preview || decoded.PreviewCut {
		t.Errorf("a short preview came back %q (cut %v), %v", decoded.Preview, decoded.PreviewCut, err)
	}

	for name, unit := range map[string]string{
		"ascii": "a", "accented": "é", "emoji": "🧪", "quote": "\"", "control": "\x01", "separator": " ", "mixed": "aé🧪\"\n<",
	} {
		t.Run(name, func(t *testing.T) {
			long := base
			long.Preview = strings.Repeat(unit, 4000)
			body := encodePayload(long, payloadLimit)
			if len(body) > payloadLimit {
				t.Fatalf("%d bytes, limit %d", len(body), payloadLimit)
			}
			var got Payload
			if err := json.Unmarshal(body, &got); err != nil {
				t.Fatalf("not JSON: %v", err)
			}
			if !got.PreviewCut || !utf8.ValidString(got.Preview) || !strings.HasPrefix(long.Preview, got.Preview) || got.Preview == "" {
				t.Fatalf("preview cut to %d bytes, flagged %v", len(got.Preview), got.PreviewCut)
			}
			// As much as fits: one more rune would not.
			next, size := utf8.DecodeRuneInString(long.Preview[len(got.Preview):])
			over := got
			over.Preview += string(next)
			if size > 0 && len(encodeJSON(over)) <= payloadLimit {
				t.Errorf("cut short: %d bytes and another rune would fit", len(body))
			}
		})
	}

	broken := base
	broken.Preview = "bad \xff byte"
	if err := json.Unmarshal(encodePayload(broken, payloadLimit), &decoded); err != nil || decoded.Preview != "bad � byte" {
		t.Errorf("invalid UTF-8 came back %q, %v", decoded.Preview, err)
	}
}

// The topic collapses what the app shows as one notification: a direct
// message's conversation, a thread reply's thread; any other item is its
// own. It is 32 base64url characters.
func TestPushTopic(t *testing.T) {
	dm := func(id string) ItemFacts {
		return ItemFacts{ID: id, Kind: int32(chatv1.ActivityKind_ACTIVITY_KIND_DM), ChannelID: "dm-1"}
	}
	reply := func(id string) ItemFacts {
		return ItemFacts{ID: id, Kind: int32(chatv1.ActivityKind_ACTIVITY_KIND_THREAD_REPLY), ChannelID: "c-1", ThreadRootID: "root-1"}
	}
	mentionIn := func(id string) ItemFacts {
		return ItemFacts{ID: id, Kind: int32(chatv1.ActivityKind_ACTIVITY_KIND_MENTION), ChannelID: "c-1", ThreadRootID: "root-1"}
	}
	shape := regexp.MustCompile(`^[A-Za-z0-9_-]{32}$`)
	for _, item := range []ItemFacts{dm("a"), reply("a"), mentionIn("a")} {
		if !shape.MatchString(pushTopic(item)) {
			t.Errorf("topic %q is not 32 base64url characters", pushTopic(item))
		}
	}
	if pushTopic(dm("a")) != pushTopic(dm("b")) || pushTopic(reply("a")) != pushTopic(reply("b")) {
		t.Error("one conversation or thread got two topics")
	}
	if pushTopic(mentionIn("a")) == pushTopic(mentionIn("b")) {
		t.Error("two mentions share a topic")
	}
	if pushTopic(mentionIn("root-1")) == pushTopic(reply("x")) {
		t.Error("a mention collapses with a thread's replies")
	}
}
