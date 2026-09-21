package apierr

import (
	"errors"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/getstoop/stoop/gen/stoop/common/v1"
)

func TestFieldKeepsTheSentenceAndNamesTheField(t *testing.T) {
	err := Field(connect.CodeInvalidArgument, "name", errors.New("name is too long"))
	if got := connect.CodeOf(err); got != connect.CodeInvalidArgument {
		t.Fatalf("code = %v", got)
	}
	if got := err.Message(); got != "name is too long" {
		t.Fatalf("message = %q", got)
	}
	details := err.Details()
	if len(details) != 1 {
		t.Fatalf("details = %d, want 1", len(details))
	}
	msg, derr := details[0].Value()
	if derr != nil {
		t.Fatal(derr)
	}
	v, ok := msg.(*commonv1.FieldViolation)
	if !ok || v.Field != "name" {
		t.Fatalf("detail = %v", msg)
	}
}
