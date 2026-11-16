package push

import (
	"context"
	"crypto/ecdh"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"unicode/utf8"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	pushv1 "github.com/getstoop/stoop/gen/stoop/push/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/rowid"
)

// A subscription is one session's: registering again replaces it, and it
// goes with the session (push_subscriptions.credential_id cascades).

const (
	maxEndpoint      = 2048
	maxLocalServerID = 32
	devicePointBytes = 65
	authSecretBytes  = 16
)

func (s *Service) RegisterPushSubscription(ctx context.Context, req *connect.Request[pushv1.RegisterPushSubscriptionRequest]) (*connect.Response[pushv1.RegisterPushSubscriptionResponse], error) {
	id, err := requireSession(ctx)
	if err != nil {
		return nil, err
	}
	msg := req.Msg
	if err := checkEndpoint(msg.Endpoint); err != nil {
		return nil, apierr.Field(connect.CodeInvalidArgument, "endpoint", err)
	}
	if !validDevicePoint(msg.P256Dh) {
		return nil, apierr.Field(connect.CodeInvalidArgument, "p256dh",
			errors.New("the device key must be an uncompressed P-256 public key"))
	}
	if len(msg.Auth) != authSecretBytes {
		return nil, apierr.Field(connect.CodeInvalidArgument, "auth",
			fmt.Errorf("the auth secret must be %d bytes", authSecretBytes))
	}
	if n := utf8.RuneCountInString(msg.LocalServerId); n == 0 || n > maxLocalServerID {
		return nil, apierr.Field(connect.CodeInvalidArgument, "local_server_id",
			fmt.Errorf("the local server id must be 1 to %d characters", maxLocalServerID))
	}
	kinds, err := checkKinds(msg.Kinds)
	if err != nil {
		return nil, err
	}
	err = s.q.PutPushSubscription(ctx, dbgen.PutPushSubscriptionParams{
		ID: rowid.New(), CredentialID: id.SessionID, UserID: id.UserID,
		Endpoint: msg.Endpoint, P256dh: msg.P256Dh, Auth: msg.Auth,
		LocalServerID: msg.LocalServerId, Kinds: kinds,
	})
	if db.HasCode(err, db.ForeignKeyViolation) {
		// The session ended between the credential check and the insert.
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("not logged in"))
	}
	if err != nil {
		return nil, fmt.Errorf("store push subscription: %w", err)
	}
	return connect.NewResponse(&pushv1.RegisterPushSubscriptionResponse{}), nil
}

func (s *Service) UpdatePushSubscription(ctx context.Context, req *connect.Request[pushv1.UpdatePushSubscriptionRequest]) (*connect.Response[pushv1.UpdatePushSubscriptionResponse], error) {
	id, err := requireSession(ctx)
	if err != nil {
		return nil, err
	}
	kinds, err := checkKinds(req.Msg.Kinds)
	if err != nil {
		return nil, err
	}
	updated, err := s.q.SetPushSubscriptionKinds(ctx, dbgen.SetPushSubscriptionKindsParams{CredentialID: id.SessionID, Kinds: kinds})
	if err != nil {
		return nil, fmt.Errorf("update push subscription: %w", err)
	}
	if updated == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("this device isn't registered for notifications"))
	}
	return connect.NewResponse(&pushv1.UpdatePushSubscriptionResponse{}), nil
}

func (s *Service) DeletePushSubscription(ctx context.Context, _ *connect.Request[pushv1.DeletePushSubscriptionRequest]) (*connect.Response[pushv1.DeletePushSubscriptionResponse], error) {
	id, err := requireSession(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.q.DeletePushSubscription(ctx, id.SessionID); err != nil {
		return nil, fmt.Errorf("delete push subscription: %w", err)
	}
	return connect.NewResponse(&pushv1.DeletePushSubscriptionResponse{}), nil
}

func checkEndpoint(endpoint string) error {
	if endpoint == "" {
		return errors.New("an endpoint is required")
	}
	if len(endpoint) > maxEndpoint {
		return fmt.Errorf("the endpoint must be %d characters or fewer", maxEndpoint)
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return errors.New("the endpoint must be an https URL")
	}
	return nil
}

// validDevicePoint reports whether point is an uncompressed P-256 point on the
// curve.
func validDevicePoint(point []byte) bool {
	if len(point) != devicePointBytes {
		return false
	}
	_, err := ecdh.P256().NewPublicKey(point)
	return err == nil
}

// checkKinds refuses an unknown kind and returns the rest sorted, without
// repeats. Empty is allowed: the device wants nothing for now.
func checkKinds(kinds []chatv1.ActivityKind) ([]int32, error) {
	out := make([]int32, 0, len(kinds))
	for _, kind := range kinds {
		if _, known := chatv1.ActivityKind_name[int32(kind)]; !known || kind == chatv1.ActivityKind_ACTIVITY_KIND_UNSPECIFIED {
			return nil, apierr.Field(connect.CodeInvalidArgument, "kinds",
				fmt.Errorf("unknown activity kind %d", kind))
		}
		out = append(out, int32(kind))
	}
	slices.Sort(out)
	return slices.Compact(out), nil
}
