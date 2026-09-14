package instance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/dbgen"
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

func (s *Service) setPersonalTokens(ctx context.Context, p instancev1.PersonalTokens) error {
	var v TokenSetting
	switch p {
	case instancev1.PersonalTokens_PERSONAL_TOKENS_EVERYONE:
		v = TokensEveryone
	case instancev1.PersonalTokens_PERSONAL_TOKENS_ADMINS:
		v = TokensAdmins
	case instancev1.PersonalTokens_PERSONAL_TOKENS_OFF:
		v = TokensOff
	default:
		return connect.NewError(connect.CodeInvalidArgument, errors.New("personal_tokens must be everyone, admins, or off"))
	}
	raw, _ := json.Marshal(v)
	if err := s.q.UpsertSetting(ctx, dbgen.UpsertSettingParams{Key: keyPersonalTokens, Value: raw}); err != nil {
		return fmt.Errorf("write %s: %w", keyPersonalTokens, err)
	}
	return nil
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
	if err := requireAction(ctx, authctx.InstanceUsersManage); err != nil {
		return nil, err
	}
	tokens, err := s.users.ListUserTokens(ctx, req.Msg.UserId)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.ListUserTokensResponse{Tokens: tokens}), nil
}

func (s *Service) RevokeUserToken(ctx context.Context, req *connect.Request[instancev1.RevokeUserTokenRequest]) (*connect.Response[instancev1.RevokeUserTokenResponse], error) {
	if err := requireAction(ctx, authctx.InstanceUsersManage); err != nil {
		return nil, err
	}
	if err := s.users.RevokeUserToken(ctx, req.Msg.UserId, req.Msg.TokenId); err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.RevokeUserTokenResponse{}), nil
}
