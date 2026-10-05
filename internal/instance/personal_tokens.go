package instance

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
)

// The personal_tokens setting — who may make and use personal tokens — and
// the admin page's view of another account's tokens. Auth enforces the
// setting at every use through its TokenPolicy port.

const keyPersonalTokens = "personal_tokens"

// TokenSetting is who may make and use personal tokens.
type TokenSetting string

const (
	TokensEveryone TokenSetting = "everyone"
	TokensAdmins   TokenSetting = "admins"
	TokensOff      TokenSetting = "off"
)

var personalTokenSettings = newEnumSetting(map[TokenSetting]instancev1.PersonalTokens{
	TokensEveryone: instancev1.PersonalTokens_PERSONAL_TOKENS_EVERYONE,
	TokensAdmins:   instancev1.PersonalTokens_PERSONAL_TOKENS_ADMINS,
	TokensOff:      instancev1.PersonalTokens_PERSONAL_TOKENS_OFF,
}, instancev1.PersonalTokens_PERSONAL_TOKENS_EVERYONE)

// PersonalTokens is the effective setting, everyone when unset. Also the
// auth module's port.
func (s *Service) PersonalTokens(ctx context.Context) (string, error) {
	return s.readSetting(ctx, keyPersonalTokens, string(TokensEveryone))
}

func (s *Service) ListUserTokens(ctx context.Context, req *connect.Request[instancev1.ListUserTokensRequest]) (*connect.Response[instancev1.ListUserTokensResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceUsersManage); err != nil {
		return nil, err
	}
	tokens, err := s.users.ListUserTokens(ctx, req.Msg.UserId)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.ListUserTokensResponse{Tokens: tokens}), nil
}

func (s *Service) RevokeUserToken(ctx context.Context, req *connect.Request[instancev1.RevokeUserTokenRequest]) (*connect.Response[instancev1.RevokeUserTokenResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceUsersManage); err != nil {
		return nil, err
	}
	if err := s.users.RevokeUserToken(ctx, req.Msg.UserId, req.Msg.TokenId); err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.RevokeUserTokenResponse{}), nil
}

func stagePersonalTokens(_ context.Context, msg *instancev1.UpdateSettingsRequest, save *settingSave) error {
	if msg.PersonalTokens == nil {
		return nil
	}
	setting, ok := personalTokenSettings.fromProto(*msg.PersonalTokens)
	if !ok {
		return connect.NewError(connect.CodeInvalidArgument, errors.New("personal_tokens must be everyone, admins, or off"))
	}
	save.write(keyPersonalTokens, setting)
	return nil
}
