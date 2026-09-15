package auth

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	authv1 "github.com/getstoop/stoop/gen/stoop/auth/v1"
	"github.com/getstoop/stoop/internal/accesswire"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Users: the current user's own record, the lookups other modules consume
// through ports, and the proto conversions.

func (s *Service) GetMe(ctx context.Context, _ *connect.Request[authv1.GetMeRequest]) (*connect.Response[authv1.GetMeResponse], error) {
	user, err := s.q.GetUserByID(ctx, authctx.UserID(ctx))
	if err != nil {
		return nil, fmt.Errorf("look up user: %w", err)
	}
	return connect.NewResponse(&authv1.GetMeResponse{
		User: toProtoUser(user), Permissions: accesswire.ToProto(myActions(ctx)),
	}), nil
}

// myActions is every instance and own-account action the caller may use
// with the credential they called with. Members may also create spaces when
// the instance allows it; that policy is chat's, and not reflected here.
func myActions(ctx context.Context) []authctx.Action {
	var out []authctx.Action
	for _, a := range authctx.AllActions() {
		if authctx.Allows(ctx, a) {
			out = append(out, a)
		}
	}
	return out
}

// GetUserProfile is one person's public face, for their profile card.
// Any signed-in caller may read any profile: this is the same tier of
// information as an avatar (docs/architecture/files.md), so there is
// no membership test and an unknown id can say so plainly.
func (s *Service) GetUserProfile(ctx context.Context, req *connect.Request[authv1.GetUserProfileRequest]) (*connect.Response[authv1.GetUserProfileResponse], error) {
	row, err := s.q.GetUserProfile(ctx, req.Msg.UserId)
	if err != nil {
		return nil, notFoundOr(err, "user")
	}
	dnd, _ := dndState(row.Dnd, row.DndUntil, time.Now())
	return connect.NewResponse(&authv1.GetUserProfileResponse{
		Profile: &authv1.PublicProfile{
			Id: row.ID, Username: row.Username, DisplayName: row.DisplayName,
			AvatarFileId: deref(row.AvatarFileID),
			Pronouns:     row.Pronouns, Bio: row.Bio,
			Kind: accesswire.KindToProto(authctx.IdentityKind(row.Kind)),
			Dnd:  dnd,
		},
	}), nil
}

// CountUsers reports how many accounts exist. Exposed for the instance
// module's UserCounter port (a zero count means first-run setup).
func (s *Service) CountUsers(ctx context.Context) (int64, error) {
	return s.q.CountUsers(ctx)
}

// PublicUser is the subset of user data exposed to other modules.
type PublicUser struct {
	ID           string
	Username     string
	DisplayName  string
	Role         authctx.Role
	Kind         authctx.IdentityKind
	AvatarFileID string
}

// GetPublicUsers is the lookup other modules consume (via ports wired in
// internal/app) to render user info such as message authors.
func (s *Service) GetPublicUsers(ctx context.Context, ids []string) ([]PublicUser, error) {
	rows, err := s.q.GetUsersByIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("look up users: %w", err)
	}
	users := make([]PublicUser, len(rows))
	for i, r := range rows {
		users[i] = PublicUser{
			ID: r.ID, Username: r.Username, DisplayName: r.DisplayName,
			Role: authctx.Role(r.Role), Kind: authctx.IdentityKind(r.Kind), AvatarFileID: deref(r.AvatarFileID),
		}
	}
	return users, nil
}

func toProtoUser(u dbgen.User) *authv1.User {
	dnd, dndUntil := dndState(u.Dnd, u.DndUntil, time.Now())
	return &authv1.User{
		Id:           u.ID,
		Username:     u.Username,
		DisplayName:  u.DisplayName,
		CreatedAt:    timestamppb.New(u.CreatedAt),
		Role:         toProtoRole(authctx.Role(u.Role)),
		AvatarFileId: deref(u.AvatarFileID),
		// A provider-created account has no password until it sets one.
		HasPassword:     u.PasswordHash != nil,
		UsernamePending: u.UsernamePending,
		UsernameFrozen:  u.UsernameFrozen,
		Pronouns:        u.Pronouns,
		Bio:             u.Bio,
		Kind:            accesswire.KindToProto(authctx.IdentityKind(u.Kind)),
		Dnd:             dnd,
		DndUntil:        timestampOrNil(dndUntil),
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func toProtoRole(r authctx.Role) authv1.InstanceRole {
	switch r {
	case authctx.RoleAdmin:
		return authv1.InstanceRole_INSTANCE_ROLE_ADMIN
	case authctx.RoleMember:
		return authv1.InstanceRole_INSTANCE_ROLE_MEMBER
	default:
		return authv1.InstanceRole_INSTANCE_ROLE_UNSPECIFIED
	}
}
