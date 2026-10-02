package rowid

import (
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

func TestNewIsVersion7AndOrdered(t *testing.T) {
	first := New()
	second := New()

	parsed, err := uuid.Parse(first)
	if err != nil {
		t.Fatalf("parse %q: %v", first, err)
	}
	if parsed.Version() != 7 {
		t.Fatalf("version = %d, want 7", parsed.Version())
	}
	if first == second {
		t.Fatalf("two ids are equal: %q", first)
	}
	if first > second {
		t.Fatalf("ids out of order: %q then %q", first, second)
	}
}

func TestRequire(t *testing.T) {
	if err := Require(New(), "user"); err != nil {
		t.Fatalf("a well-formed id: %v", err)
	}
	for _, id := range []string{"nope", ""} {
		err := Require(id, "user")
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("Require(%q) code = %v, want not found", id, connect.CodeOf(err))
		}
		var connectErr *connect.Error
		if !errors.As(err, &connectErr) || connectErr.Message() != "user not found" {
			t.Errorf("Require(%q) = %v, want message %q", id, err, "user not found")
		}
	}
}
