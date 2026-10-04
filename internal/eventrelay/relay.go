// Package eventrelay carries events.Bus publishes from a `stoop jobs`
// process to the server over Postgres NOTIFY, so what a job publishes
// reaches the gateway and the browsers behind it. A Publisher wraps the
// runner's bus and raises a notification per publish; a Listener in the
// server turns each notification back into a publish on its own bus.
// See docs/architecture/realtime.md → The bus.
package eventrelay

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"google.golang.org/protobuf/proto"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
)

// Channel is the Postgres channel the runner notifies and the server
// listens on.
const Channel = "stoop_events"

// maxPayload is what NOTIFY accepts; a larger event is dropped, never
// truncated.
const maxPayload = 8000

var errPayloadTooLarge = errors.New("event is larger than NOTIFY carries")

// encode writes the topic and the marshalled event as one text-safe
// payload: the topic, a space, the event in base64.
func encode(topic string, ev *realtimev1.ServerEvent) (string, error) {
	marshalled, err := proto.Marshal(ev)
	if err != nil {
		return "", fmt.Errorf("marshal event: %w", err)
	}
	payload := topic + " " + base64.StdEncoding.EncodeToString(marshalled)
	if len(payload) > maxPayload {
		return "", fmt.Errorf("%w: %d bytes", errPayloadTooLarge, len(payload))
	}
	return payload, nil
}

// decode is encode's inverse.
func decode(payload string) (string, *realtimev1.ServerEvent, error) {
	topic, encoded, found := strings.Cut(payload, " ")
	if !found || topic == "" {
		return "", nil, errors.New("payload has no topic")
	}
	marshalled, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", nil, fmt.Errorf("decode event: %w", err)
	}
	ev := &realtimev1.ServerEvent{}
	if err := proto.Unmarshal(marshalled, ev); err != nil {
		return "", nil, fmt.Errorf("unmarshal event: %w", err)
	}
	return topic, ev, nil
}
