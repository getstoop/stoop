package chat

import (
	"errors"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/Jhut89/stoop/internal/dbgen"
)

func TestNewInviteCode(t *testing.T) {
	seen := map[string]bool{}
	for range 1000 {
		code, err := newInviteCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != inviteCodeLen {
			t.Fatalf("code %q: want length %d", code, inviteCodeLen)
		}
		for _, r := range code {
			if !strings.ContainsRune(inviteAlphabet, r) {
				t.Fatalf("code %q contains %q, not in alphabet", code, r)
			}
		}
		if seen[code] {
			t.Fatalf("duplicate code %q in 1000 draws", code)
		}
		seen[code] = true
	}
}

func TestInviteRejection(t *testing.T) {
	now := time.Now()
	past, future := now.Add(-time.Hour), now.Add(time.Hour)
	one := int32(1)

	tests := []struct {
		name string
		inv  dbgen.Invite
		code connect.Code
		msg  string
	}{
		{"revoked", dbgen.Invite{RevokedAt: &past}, connect.CodeFailedPrecondition, "revoked"},
		{"revoked wins over expired", dbgen.Invite{RevokedAt: &past, ExpiresAt: &past}, connect.CodeFailedPrecondition, "revoked"},
		{"expired", dbgen.Invite{ExpiresAt: &past}, connect.CodeFailedPrecondition, "expired"},
		{"expires exactly now", dbgen.Invite{ExpiresAt: &now}, connect.CodeFailedPrecondition, "expired"},
		{"exhausted", dbgen.Invite{MaxUses: &one, UseCount: 1}, connect.CodeResourceExhausted, "maximum number of uses"},
		{"still valid (unexpected)", dbgen.Invite{ExpiresAt: &future, MaxUses: &one}, connect.CodeFailedPrecondition, "no longer be used"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := inviteRejection(tc.inv, now)
			var cerr *connect.Error
			if !errors.As(err, &cerr) {
				t.Fatalf("want *connect.Error, got %T", err)
			}
			if cerr.Code() != tc.code {
				t.Errorf("code = %v, want %v", cerr.Code(), tc.code)
			}
			if !strings.Contains(cerr.Message(), tc.msg) {
				t.Errorf("message %q does not mention %q", cerr.Message(), tc.msg)
			}
		})
	}
}
