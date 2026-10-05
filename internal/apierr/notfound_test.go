package apierr

import (
	"errors"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	"github.com/getstoop/stoop/internal/apierr/apierrtest"
)

func TestNotFoundOrNoRows(t *testing.T) {
	for name, err := range map[string]error{
		"bare":    pgx.ErrNoRows,
		"wrapped": fmt.Errorf("get hook: %w", pgx.ErrNoRows),
	} {
		got := NotFoundOr(err, "webhook")
		apierrtest.RequireCode(t, got, connect.CodeNotFound, name)
		if message := got.(*connect.Error).Message(); message != "webhook not found" {
			t.Errorf("%s: message = %q", name, message)
		}
	}
}

func TestNotFoundOrOtherError(t *testing.T) {
	other := errors.New("connection reset")
	if got := NotFoundOr(other, "webhook"); got != other {
		t.Errorf("got %v, want the same error back", got)
	}
}

func TestNotFoundOrNil(t *testing.T) {
	if got := NotFoundOr(nil, "webhook"); got != nil {
		t.Errorf("got %v, want nil", got)
	}
}
