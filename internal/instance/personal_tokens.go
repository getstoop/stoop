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

// PersonalTokens is the effective setting, everyone when unset. Also the
// auth module's port.
func (s *Service) PersonalTokens(ctx context.Context) (string, error) {
	return s.readSetting(ctx, keyPersonalTokens, string(TokensEveryone))
}

func personalTokensFromProto(p instancev1.PersonalTokens) (TokenSetting, error) {
	switch p {
	case instancev1.PersonalTokens_PERSONAL_TOKENS_EVERYONE:
		return TokensEveryone, nil
	case instancev1.PersonalTokens_PERSONAL_TOKENS_ADMINS:
		return TokensAdmins, nil
	case instancev1.PersonalTokens_PERSONAL_TOKENS_OFF:
		return TokensOff, nil
	}
	return "", connect.NewError(connect.CodeInvalidArgument, errors.New("personal_tokens must be everyone, admins, or off"))
}

func toProtoPersonalTokens(v TokenSetting) instancev1.PersonalTokens {
	switch v {
	case TokensAdmins:
		return instancev1.PersonalTokens_PERSONAL_TOKENS_ADMINS
	case TokensOff:
		return instancev1.PersonalTokens_PERSONAL_TOKENS_OFF
	default:
		return instancev1.PersonalTokens_PERSONAL_TOKENS_EVERYONE
	}
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
