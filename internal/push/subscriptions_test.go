package push

import (
	"bytes"
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	commonv1 "github.com/getstoop/stoop/gen/stoop/common/v1"
	pushv1 "github.com/getstoop/stoop/gen/stoop/push/v1"
	"github.com/getstoop/stoop/internal/apierr/apierrtest"
)

func (fix *fixture) stored(t *testing.T, sessionID string) (endpoint string, p256dh []byte, kinds []int32, failures int32) {
	t.Helper()
	if err := fix.pool.QueryRow(context.Background(),
		`SELECT endpoint, p256dh, kinds, failures FROM push_subscriptions WHERE credential_id = $1`, sessionID,
	).Scan(&endpoint, &p256dh, &kinds, &failures); err != nil {
		t.Fatalf("read subscription: %v", err)
	}
	return endpoint, p256dh, kinds, failures
}

// Registering again replaces the session's one subscription, kinds are
// kept sorted and unique, and an update changes only the kinds.
func TestRegisterReplacesAndUpdateChangesKinds(t *testing.T) {
	fix := setup(t)
	ctx, session := fix.session(t)

	first := validRegistration(t)
	first.Kinds = append(first.Kinds, chatv1.ActivityKind_ACTIVITY_KIND_MENTION)
	if _, err := fix.svc.RegisterPushSubscription(ctx, connect.NewRequest(first)); err != nil {
		t.Fatal(err)
	}
	if _, _, kinds, _ := fix.stored(t, session); !slices.Equal(kinds, []int32{1, 3}) {
		t.Errorf("kinds = %v, want [1 3]", kinds)
	}
	if _, err := fix.pool.Exec(context.Background(), `UPDATE push_subscriptions SET failures = 4`); err != nil {
		t.Fatal(err)
	}

	second := validRegistration(t)
	second.Endpoint = "https://relay.example/push/def"
	if _, err := fix.svc.RegisterPushSubscription(ctx, connect.NewRequest(second)); err != nil {
		t.Fatal(err)
	}
	if n := fix.subscriptions(t, session); n != 1 {
		t.Fatalf("%d subscriptions for one session, want 1", n)
	}
	endpoint, p256dh, _, failures := fix.stored(t, session)
	if endpoint != second.Endpoint || !bytes.Equal(p256dh, second.P256Dh) || failures != 0 {
		t.Errorf("after replacing: endpoint %q, failures %d; want the second registration with a clean record", endpoint, failures)
	}

	if _, err := fix.svc.UpdatePushSubscription(ctx, connect.NewRequest(&pushv1.UpdatePushSubscriptionRequest{
		Kinds: []chatv1.ActivityKind{chatv1.ActivityKind_ACTIVITY_KIND_THREAD_REPLY},
	})); err != nil {
		t.Fatal(err)
	}
	if endpoint, _, kinds, _ := fix.stored(t, session); !slices.Equal(kinds, []int32{4}) || endpoint != second.Endpoint {
		t.Errorf("after update: kinds %v endpoint %q", kinds, endpoint)
	}
	// Empty is allowed: none wanted.
	if _, err := fix.svc.UpdatePushSubscription(ctx, connect.NewRequest(&pushv1.UpdatePushSubscriptionRequest{})); err != nil {
		t.Fatal(err)
	}
	if _, _, kinds, _ := fix.stored(t, session); len(kinds) != 0 {
		t.Errorf("kinds = %v after an empty update", kinds)
	}
}

// Each session has its own subscription, and deleting is idempotent.
func TestDeleteIsPerSessionAndIdempotent(t *testing.T) {
	fix := setup(t)
	phone, phoneSession := fix.session(t)
	tablet, tabletSession := fix.session(t)
	for _, ctx := range []context.Context{phone, tablet} {
		if _, err := fix.svc.RegisterPushSubscription(ctx, connect.NewRequest(validRegistration(t))); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if _, err := fix.svc.DeletePushSubscription(phone, connect.NewRequest(&pushv1.DeletePushSubscriptionRequest{})); err != nil {
			t.Fatal(err)
		}
	}
	if fix.subscriptions(t, phoneSession) != 0 || fix.subscriptions(t, tabletSession) != 1 {
		t.Error("deleting the phone's subscription touched the wrong rows")
	}
	_, err := fix.svc.UpdatePushSubscription(phone, connect.NewRequest(&pushv1.UpdatePushSubscriptionRequest{}))
	apierrtest.ExpectCode(t, err, connect.CodeNotFound, "update with nothing registered")
}

// The subscription goes with its session, by the cascade alone.
func TestSubscriptionGoesWithItsSession(t *testing.T) {
	fix := setup(t)
	ctx, session := fix.session(t)
	if _, err := fix.svc.RegisterPushSubscription(ctx, connect.NewRequest(validRegistration(t))); err != nil {
		t.Fatal(err)
	}
	if _, err := fix.pool.Exec(context.Background(), `DELETE FROM credentials WHERE id = $1`, session); err != nil {
		t.Fatal(err)
	}
	if n := fix.subscriptions(t, session); n != 0 {
		t.Errorf("%d subscriptions outlived their session", n)
	}
	// A request still carrying the ended session can't bring one back.
	_, err := fix.svc.RegisterPushSubscription(ctx, connect.NewRequest(validRegistration(t)))
	apierrtest.ExpectCode(t, err, connect.CodeUnauthenticated, "register with an ended session")
}

func TestOnlyASessionManagesASubscription(t *testing.T) {
	fix := setup(t)
	token := fix.token()
	_, err := fix.svc.RegisterPushSubscription(token, connect.NewRequest(validRegistration(t)))
	apierrtest.ExpectCode(t, err, connect.CodePermissionDenied, "register with a token")
	_, err = fix.svc.UpdatePushSubscription(token, connect.NewRequest(&pushv1.UpdatePushSubscriptionRequest{}))
	apierrtest.ExpectCode(t, err, connect.CodePermissionDenied, "update with a token")
	_, err = fix.svc.DeletePushSubscription(token, connect.NewRequest(&pushv1.DeletePushSubscriptionRequest{}))
	apierrtest.ExpectCode(t, err, connect.CodePermissionDenied, "delete with a token")
}

func TestRegisterRefusesBadInput(t *testing.T) {
	fix := setup(t)
	ctx, session := fix.session(t)
	offCurve := validRegistration(t).P256Dh
	offCurve[64] ^= 1
	compressed := append([]byte{0x02}, validRegistration(t).P256Dh[1:33]...)
	cases := []struct {
		name  string
		edit  func(*pushv1.RegisterPushSubscriptionRequest)
		field string
	}{
		{"no endpoint", func(r *pushv1.RegisterPushSubscriptionRequest) { r.Endpoint = "" }, "endpoint"},
		{"http endpoint", func(r *pushv1.RegisterPushSubscriptionRequest) { r.Endpoint = "http://relay.example/push" }, "endpoint"},
		{"not a URL", func(r *pushv1.RegisterPushSubscriptionRequest) { r.Endpoint = "relay.example/push" }, "endpoint"},
		{"no host", func(r *pushv1.RegisterPushSubscriptionRequest) { r.Endpoint = "https:///push" }, "endpoint"},
		{"userinfo", func(r *pushv1.RegisterPushSubscriptionRequest) { r.Endpoint = "https://who:pw@relay.example/push" }, "endpoint"},
		{"long endpoint", func(r *pushv1.RegisterPushSubscriptionRequest) {
			r.Endpoint = "https://relay.example/" + strings.Repeat("a", maxEndpoint)
		}, "endpoint"},
		{"short key", func(r *pushv1.RegisterPushSubscriptionRequest) { r.P256Dh = r.P256Dh[:64] }, "p256dh"},
		{"compressed key", func(r *pushv1.RegisterPushSubscriptionRequest) { r.P256Dh = compressed }, "p256dh"},
		{"off-curve key", func(r *pushv1.RegisterPushSubscriptionRequest) { r.P256Dh = offCurve }, "p256dh"},
		{"short auth", func(r *pushv1.RegisterPushSubscriptionRequest) { r.Auth = r.Auth[:15] }, "auth"},
		{"no local id", func(r *pushv1.RegisterPushSubscriptionRequest) { r.LocalServerId = "" }, "local_server_id"},
		{"long local id", func(r *pushv1.RegisterPushSubscriptionRequest) { r.LocalServerId = strings.Repeat("x", 33) }, "local_server_id"},
		{"unspecified kind", func(r *pushv1.RegisterPushSubscriptionRequest) {
			r.Kinds = []chatv1.ActivityKind{chatv1.ActivityKind_ACTIVITY_KIND_UNSPECIFIED}
		}, "kinds[0]"},
		{"unknown kind", func(r *pushv1.RegisterPushSubscriptionRequest) {
			r.Kinds = []chatv1.ActivityKind{chatv1.ActivityKind_ACTIVITY_KIND_MENTION, chatv1.ActivityKind_ACTIVITY_KIND_DM, 99}
		}, "kinds[2]"},
		{"NUL in local id", func(r *pushv1.RegisterPushSubscriptionRequest) { r.LocalServerId = "k3x\x00pq" }, "local_server_id"},
		{"newline in local id", func(r *pushv1.RegisterPushSubscriptionRequest) { r.LocalServerId = "k3x\npq" }, "local_server_id"},
		{"space in local id", func(r *pushv1.RegisterPushSubscriptionRequest) { r.LocalServerId = "k3x pq" }, "local_server_id"},
		{"non-ASCII local id", func(r *pushv1.RegisterPushSubscriptionRequest) { r.LocalServerId = "kéxpq" }, "local_server_id"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := validRegistration(t)
			tc.edit(req)
			_, err := fix.svc.RegisterPushSubscription(ctx, connect.NewRequest(req))
			apierrtest.ExpectCode(t, err, connect.CodeInvalidArgument, tc.name)
			if got := violatedField(err); got != tc.field {
				t.Errorf("field = %q, want %q", got, tc.field)
			}
		})
	}
	if n := fix.subscriptions(t, session); n != 0 {
		t.Errorf("%d subscriptions stored from refused requests", n)
	}
	for _, id := range []string{"k3x9pq", "Home_Server-2", strings.Repeat("z", maxLocalServerID)} {
		req := validRegistration(t)
		req.LocalServerId = id
		if _, err := fix.svc.RegisterPushSubscription(ctx, connect.NewRequest(req)); err != nil {
			t.Errorf("local server id %q refused: %v", id, err)
		}
	}
	_, err := fix.svc.UpdatePushSubscription(ctx, connect.NewRequest(&pushv1.UpdatePushSubscriptionRequest{Kinds: []chatv1.ActivityKind{99}}))
	apierrtest.ExpectCode(t, err, connect.CodeInvalidArgument, "update with an unknown kind")
}

func violatedField(err error) string {
	var cerr *connect.Error
	if !errors.As(err, &cerr) {
		return ""
	}
	for _, detail := range cerr.Details() {
		if msg, derr := detail.Value(); derr == nil {
			if violation, ok := msg.(*commonv1.FieldViolation); ok {
				return violation.Field
			}
		}
	}
	return ""
}
