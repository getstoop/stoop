package instance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/config"
	"github.com/getstoop/stoop/internal/dbgen"
)

// Defaults are the first-boot values; they never override stored settings.
type Defaults struct {
	RegistrationPolicy Policy
	// InstanceNameEnv is STOOP_INSTANCE_NAME, the name seeded. Empty means
	// Seed picks a random name. As a fallback it is UseInstanceNameEnv's.
	InstanceNameEnv string
}

// Seed writes defaults for any setting that doesn't exist yet.
func (s *Service) Seed(ctx context.Context, d Defaults) error {
	if d.RegistrationPolicy == "" {
		d.RegistrationPolicy = PolicyInvite
	}
	v, _ := json.Marshal(d.RegistrationPolicy)
	if err := s.q.SeedSetting(ctx, dbgen.SeedSettingParams{Key: keyRegistrationPolicy, Value: v}); err != nil {
		return fmt.Errorf("seed %s: %w", keyRegistrationPolicy, err)
	}
	sc, _ := json.Marshal(SpaceCreationAdmins)
	if err := s.q.SeedSetting(ctx, dbgen.SeedSettingParams{Key: keySpaceCreation, Value: sc}); err != nil {
		return fmt.Errorf("seed %s: %w", keySpaceCreation, err)
	}
	name := d.InstanceNameEnv
	if name == "" {
		var err error
		if name, err = randomInstanceName(); err != nil {
			return fmt.Errorf("generate instance name: %w", err)
		}
	}
	nv, _ := json.Marshal(name)
	if err := s.q.SeedSetting(ctx, dbgen.SeedSettingParams{Key: keyInstanceName, Value: nv}); err != nil {
		return fmt.Errorf("seed %s: %w", keyInstanceName, err)
	}
	return nil
}

func (s *Service) status(ctx context.Context) (*instancev1.GetInstanceStatusResponse, error) {
	ctx, err := s.withSettings(ctx)
	if err != nil {
		return nil, err
	}
	n, err := s.users.CountUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("count users: %w", err)
	}
	p, err := s.RegistrationPolicy(ctx)
	if err != nil {
		return nil, err
	}
	sc, err := s.SpaceCreationPolicy(ctx)
	if err != nil {
		return nil, err
	}
	quota, err := s.StorageQuotaBytes(ctx)
	if err != nil {
		return nil, err
	}
	maxUpload, err := s.effectiveMaxUpload(ctx)
	if err != nil {
		return nil, err
	}
	providers, err := s.LoginProviders(ctx)
	if err != nil {
		return nil, err
	}
	pw, err := s.PasswordSignIn(ctx)
	if err != nil {
		return nil, err
	}
	tokens, err := s.PersonalTokens(ctx)
	if err != nil {
		return nil, err
	}
	name, err := s.InstanceName(ctx)
	if err != nil {
		return nil, err
	}
	incoming, err := s.readBool(ctx, keyWebhooksIncoming, true)
	if err != nil {
		return nil, err
	}
	outgoing, err := s.readBool(ctx, keyWebhooksOutgoing, true)
	if err != nil {
		return nil, err
	}
	private, err := s.WebhooksAllowPrivateTargets(ctx)
	if err != nil {
		return nil, err
	}
	selfDeletion, err := s.SelfDeletion(ctx)
	if err != nil {
		return nil, err
	}
	sessionDays, err := s.SessionLifetimeDays(ctx)
	if err != nil {
		return nil, err
	}
	messageDays, err := s.MessageRetentionDays(ctx)
	if err != nil {
		return nil, err
	}
	attachmentDays, err := s.AttachmentRetentionDays(ctx)
	if err != nil {
		return nil, err
	}
	summaries := make([]*instancev1.LoginProviderSummary, len(providers))
	for i, lp := range providers {
		summaries[i] = &instancev1.LoginProviderSummary{
			Id: lp.ID, DisplayName: lp.DisplayName, Icon: lp.Icon,
		}
	}
	return &instancev1.GetInstanceStatusResponse{
		NeedsSetup: n == 0, RegistrationPolicy: registrationPolicies.toProto(Policy(p)),
		SpaceCreation: spaceCreations.toProto(sc), StorageQuotaBytes: quota,
		LoginProviders: summaries, PasswordSignIn: passwordSignIns.toProto(PasswordSignIn(pw)),
		MaxUploadBytes: maxUpload, InstanceName: name,
		PersonalTokens:    personalTokenSettings.toProto(TokenSetting(tokens)),
		WebhooksAvailable: s.webhooksEnv, WebhooksIncoming: incoming, WebhooksOutgoing: outgoing,
		WebhooksAllowPrivateTargets: private, SelfDeletion: selfDeletion,
		SessionLifetimeDays:  int32(sessionDays),
		MessageRetentionDays: int32(messageDays), AttachmentRetentionDays: int32(attachmentDays),
		VoiceAvailable: s.VoiceAvailable(),
	}, nil
}

func (s *Service) GetInstanceStatus(ctx context.Context, _ *connect.Request[instancev1.GetInstanceStatusRequest]) (*connect.Response[instancev1.GetInstanceStatusResponse], error) {
	ctx, err := s.withSettings(ctx)
	if err != nil {
		return nil, err
	}
	st, err := s.status(ctx)
	if err != nil {
		return nil, err
	}
	if st.PublicUrl, err = s.PublicURL(ctx); err != nil {
		return nil, err
	}
	return connect.NewResponse(st), nil
}

func (s *Service) UpdateSettings(ctx context.Context, req *connect.Request[instancev1.UpdateSettingsRequest]) (*connect.Response[instancev1.UpdateSettingsResponse], error) {
	if err := apierr.RequireAction(ctx, authctx.InstanceSettingsManage); err != nil {
		return nil, err
	}
	if err := s.SaveSettings(ctx, req.Msg); err != nil {
		return nil, err
	}
	st, err := s.status(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.UpdateSettingsResponse{Status: st}), nil
}

// SaveSettings saves the fields set in msg. Shared by the admin page and
// stoop admin, which checks no permission.
func (s *Service) SaveSettings(ctx context.Context, msg *instancev1.UpdateSettingsRequest) error {
	// Every field is validated before anything is written, so a refused
	// save changes nothing.
	var writes []settingWrite
	if d := msg.SessionLifetimeDays; d != nil {
		if *d < 0 || *d > config.MaxSessionLifetimeDays {
			return apierr.Field(connect.CodeInvalidArgument, "session_lifetime_days",
				errors.New("a sign-in lasts 1-365 days, or 0 to use the server's default"))
		}
		writes = append(writes, settingWrite{keySessionLifetime, *d})
	}
	if !validRetention(msg.MessageRetentionDays) {
		return errRetentionRange("message_retention_days")
	}
	if !validRetention(msg.AttachmentRetentionDays) {
		return errRetentionRange("attachment_retention_days")
	}
	for key, days := range map[string]*int32{
		keyMessageRetention: msg.MessageRetentionDays, keyAttachmentRetention: msg.AttachmentRetentionDays,
	} {
		if days != nil {
			writes = append(writes, settingWrite{key, *days})
		}
	}
	if msg.InstanceName != nil {
		name := strings.TrimSpace(*msg.InstanceName)
		if name == "" {
			return apierr.Field(connect.CodeInvalidArgument, "instance_name", errors.New("the server name must not be blank"))
		}
		if utf8.RuneCountInString(name) > config.MaxInstanceNameRunes {
			return apierr.Field(connect.CodeInvalidArgument, "instance_name",
				fmt.Errorf("the server name must be %d characters or fewer", config.MaxInstanceNameRunes))
		}
		writes = append(writes, settingWrite{keyInstanceName, name})
	}
	if msg.RegistrationPolicy != nil {
		p, ok := registrationPolicies.fromProto(*msg.RegistrationPolicy)
		if !ok {
			return connect.NewError(connect.CodeInvalidArgument, errors.New("registration_policy must be open, invite, or closed"))
		}
		writes = append(writes, settingWrite{keyRegistrationPolicy, p})
	}
	if msg.SpaceCreation != nil {
		sc, ok := spaceCreations.fromProto(*msg.SpaceCreation)
		if !ok {
			return connect.NewError(connect.CodeInvalidArgument, errors.New("space_creation must be admins or everyone"))
		}
		writes = append(writes, settingWrite{keySpaceCreation, sc})
	}
	quota, err := s.StorageQuotaBytes(ctx)
	if err != nil {
		return err
	}
	if requested := msg.StorageQuotaBytes; requested != nil {
		if *requested < 0 {
			return apierr.Field(connect.CodeInvalidArgument, "storage_quota_bytes", errors.New("the storage limit must be 0 (no limit) or more"))
		}
		quota = *requested
		writes = append(writes, settingWrite{keyStorageQuota, *requested})
	}
	if msg.MaxUploadBytes != nil {
		n := *msg.MaxUploadBytes
		if n < 0 {
			return apierr.Field(connect.CodeInvalidArgument, "max_upload_bytes", errors.New("the size per file must be 0 (no limit) or more"))
		}
		if s.uploadCeiling > 0 && n > s.uploadCeiling {
			return apierr.Field(connect.CodeInvalidArgument, "max_upload_bytes",
				fmt.Errorf("the size per file must be %d MB or less", s.uploadCeiling>>20))
		}
		// A per-file cap above the total storage limit is a limit that can
		// never be reached. Judged against the quota in this request when
		// it sets one.
		if quota > 0 && n > quota {
			return apierr.Field(connect.CodeInvalidArgument, "max_upload_bytes",
				fmt.Errorf("the size per file is more than the upload storage limit of %d MB", quota>>20))
		}
		writes = append(writes, settingWrite{keyMaxUpload, n})
	}
	if msg.PasswordSignIn != nil {
		pw, ok := passwordSignIns.fromProto(*msg.PasswordSignIn)
		if !ok {
			return connect.NewError(connect.CodeInvalidArgument, errors.New("password_sign_in must be everyone, admins, or off"))
		}
		// Never save "nobody can log in": below everyone needs a provider.
		if pw != PasswordEveryone {
			providers, err := s.LoginProviders(ctx)
			if err != nil {
				return err
			}
			if len(providers) == 0 {
				return apierr.Field(connect.CodeFailedPrecondition, "password_sign_in",
					errors.New("add a login provider before restricting password sign-in"))
			}
		}
		writes = append(writes, settingWrite{keyPasswordSignIn, pw})
	}
	if msg.PersonalTokens != nil {
		v, ok := personalTokenSettings.fromProto(*msg.PersonalTokens)
		if !ok {
			return connect.NewError(connect.CodeInvalidArgument, errors.New("personal_tokens must be everyone, admins, or off"))
		}
		writes = append(writes, settingWrite{keyPersonalTokens, v})
	}
	for key, v := range map[string]*bool{
		keyWebhooksIncoming: msg.WebhooksIncoming, keyWebhooksOutgoing: msg.WebhooksOutgoing,
		keyWebhooksAllowPrivateTargets: msg.WebhooksAllowPrivateTargets,
		keySelfDeletion:                msg.SelfDeletion,
	} {
		if v != nil {
			writes = append(writes, settingWrite{key, *v})
		}
	}
	return s.writeSettings(ctx, writes)
}
