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
	"strconv"
	"strings"

	"google.golang.org/protobuf/proto"

	realtimev1 "github.com/getstoop/stoop/gen/stoop/realtime/v1"
	"github.com/getstoop/stoop/internal/rowid"
)

// Channel is the Postgres channel the runner notifies and the server
// listens on.
const Channel = "stoop_events"

// maxPayload is what one NOTIFY accepts. An event that does not fit is
// sent as up to maxParts pieces in one transaction, so they arrive
// together and in order; one larger still is dropped, never truncated.
const (
	maxPayload = 8000
	maxParts   = 8
)

var errEventTooLarge = errors.New("event is larger than the relay carries")

// A whole event is "<topic> <base64>". A piece of one is
// "<topic> <batch> <index> <count> <base64 slice>", the batch id naming
// the event the pieces rebuild.
const partMarker = "+"

// encode writes the topic and the marshalled event as the payloads to
// notify: one for an event that fits, several for one that does not.
func encode(topic string, ev *realtimev1.ServerEvent) ([]string, error) {
	marshalled, err := proto.Marshal(ev)
	if err != nil {
		return nil, fmt.Errorf("marshal event: %w", err)
	}
	encoded := base64.StdEncoding.EncodeToString(marshalled)
	if whole := topic + " " + encoded; len(whole) <= maxPayload {
		return []string{whole}, nil
	}
	batch := rowid.New()
	head := topic + " " + partMarker + batch + " "
	room := maxPayload - len(head) - len(" 00 00")
	count := (len(encoded) + room - 1) / room
	if count > maxParts {
		return nil, fmt.Errorf("%w: %d bytes", errEventTooLarge, len(encoded))
	}
	parts := make([]string, 0, count)
	for index := range count {
		slice := encoded[index*room : min((index+1)*room, len(encoded))]
		parts = append(parts, head+strconv.Itoa(index)+" "+strconv.Itoa(count)+" "+slice)
	}
	return parts, nil
}

// part is one decoded payload: a whole event, or a piece with its place
// in the batch.
type part struct {
	topic   string
	batch   string
	index   int
	count   int
	encoded string
}

// decodePayload splits a notification's payload into its fields.
func decodePayload(payload string) (part, error) {
	topic, rest, found := strings.Cut(payload, " ")
	if !found || topic == "" {
		return part{}, errors.New("payload has no topic")
	}
	if !strings.HasPrefix(rest, partMarker) {
		return part{topic: topic, count: 1, encoded: rest}, nil
	}
	fields := strings.SplitN(rest[len(partMarker):], " ", 4)
	if len(fields) != 4 {
		return part{}, errors.New("piece has too few fields")
	}
	index, err := strconv.Atoi(fields[1])
	if err != nil {
		return part{}, fmt.Errorf("piece index: %w", err)
	}
	count, err := strconv.Atoi(fields[2])
	if err != nil {
		return part{}, fmt.Errorf("piece count: %w", err)
	}
	if count < 1 || count > maxParts || index < 0 || index >= count {
		return part{}, fmt.Errorf("piece %d of %d is out of range", index, count)
	}
	return part{topic: topic, batch: fields[0], index: index, count: count, encoded: fields[3]}, nil
}

// decodeEvent is encode's inverse for a whole event's base64.
func decodeEvent(encoded string) (*realtimev1.ServerEvent, error) {
	marshalled, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode event: %w", err)
	}
	ev := &realtimev1.ServerEvent{}
	if err := proto.Unmarshal(marshalled, ev); err != nil {
		return nil, fmt.Errorf("unmarshal event: %w", err)
	}
	return ev, nil
}

// assembly collects the pieces of one event as they arrive.
type assembly struct {
	pieces   []string
	received int
}

// assembler rebuilds events sent in pieces. One connection's
// notifications arrive in order, and a batch is notified in one
// transaction, so its pieces arrive together; a batch left unfinished
// belongs to a connection that failed and is forgotten with it.
type assembler struct {
	open map[string]*assembly
}

func newAssembler() *assembler { return &assembler{open: map[string]*assembly{}} }

// add takes one decoded payload and returns the event it completes, or
// nil while more pieces are due.
func (a *assembler) add(p part) (*realtimev1.ServerEvent, error) {
	if p.batch == "" {
		return decodeEvent(p.encoded)
	}
	current, ok := a.open[p.batch]
	if !ok {
		current = &assembly{pieces: make([]string, p.count)}
		a.open[p.batch] = current
	}
	if len(current.pieces) != p.count {
		delete(a.open, p.batch)
		return nil, fmt.Errorf("piece %d says %d pieces, the batch %d", p.index, p.count, len(current.pieces))
	}
	if current.pieces[p.index] == "" {
		current.received++
	}
	current.pieces[p.index] = p.encoded
	if current.received < p.count {
		return nil, nil
	}
	delete(a.open, p.batch)
	return decodeEvent(strings.Join(current.pieces, ""))
}
