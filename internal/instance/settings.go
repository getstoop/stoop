package instance

import (
	"context"
	"encoding/json"
	"fmt"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
	"github.com/getstoop/stoop/internal/authctx"
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
	smtp, err := s.SMTPSettings(ctx)
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
		EmailEnabled:   smtp.Enabled && smtp.Host != "",
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
	// save changes nothing. The first refusal in this order is reported.
	save := &settingSave{}
	for _, stage := range []func(context.Context, *instancev1.UpdateSettingsRequest, *settingSave) error{
		stageSessionLifetime, stageRetention, stageInstanceName, stageRegistrationPolicy,
		stageSpaceCreation, s.stageStorageLimits, s.stagePasswordSignIn, stagePersonalTokens,
		stageWebhooks, stageSelfDeletion,
	} {
		if err := stage(ctx, msg, save); err != nil {
			return err
		}
	}
	return s.commit(ctx, save)
}
