package rowid

import (
	"errors"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/getstoop/stoop/internal/apierr/apierrtest"
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
		apierrtest.ExpectCode(t, err, connect.CodeNotFound, fmt.Sprintf("Require(%q)", id))
		var connectErr *connect.Error
		if !errors.As(err, &connectErr) || connectErr.Message() != "user not found" {
			t.Errorf("Require(%q) = %v, want message %q", id, err, "user not found")
		}
	}
}
