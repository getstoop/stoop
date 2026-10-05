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

// Policy is the registration policy as stored and as exposed through the
// auth module's RegistrationPolicy port.
type Policy string

const (
	PolicyOpen   Policy = "open"
	PolicyInvite Policy = "invite"
	PolicyClosed Policy = "closed"
)

const (
	keyRegistrationPolicy = "registration_policy"
	keySpaceCreation      = "space_creation"
	// keyStorageQuota caps total upload storage in bytes; absent or 0 is
	// unlimited. Read by the files module through its Policy port.
	keyStorageQuota = "storage_quota_bytes"
	// keyMaxUpload caps one uploaded file in bytes; absent or 0 means the
	// operator set no limit
	keyMaxUpload = "max_upload_bytes"
	// keyPasswordSignIn: who may use the username/password form. Seeded
	// from STOOP_PASSWORD_SIGN_IN (seed_env.go).
	keyPasswordSignIn = "password_sign_in"
	// keyInstanceName: shown in the browser tab. Seeded from
	// STOOP_INSTANCE_NAME, or with a random name when that is unset.
	keyInstanceName = "instance_name"
	// keySelfDeletion: whether a person may delete their own account. On
	// unless the operator turns it off. Read by auth through its
	// DeletionPolicy port.
	keySelfDeletion = "self_deletion"
)

// PasswordSignIn is who may sign in (and register) with a password; the
// auth module consumes it as a string through its PasswordPolicy port.
type PasswordSignIn string

const (
	PasswordEveryone PasswordSignIn = "everyone"
	PasswordAdmins   PasswordSignIn = "admins"
	PasswordOff      PasswordSignIn = "off"
)

// UseInstanceNameEnv supplies STOOP_INSTANCE_NAME, for a process that
// doesn't run Seed (stoop admin).
func (s *Service) UseInstanceNameEnv(name string) { s.instanceNameEnv = name }

// UsePasswordSignInEnv supplies STOOP_PASSWORD_SIGN_IN.
func (s *Service) UsePasswordSignInEnv(v string) { s.passwordEnv = v }

// PasswordSignIn is the setting in force: saved, else environment, else
// everyone. Also the auth module's port.
func (s *Service) PasswordSignIn(ctx context.Context) (string, error) {
	fallback := s.passwordEnv
	if fallback == "" {
		fallback = string(PasswordEveryone)
	}
	return s.readSetting(ctx, keyPasswordSignIn, fallback)
}

// SetPasswordSignIn writes the setting without the provider guard — the
// CLI's break-glass (`stoop admin password-login everyone`).
func (s *Service) SetPasswordSignIn(ctx context.Context, v PasswordSignIn) error {
	switch v {
	case PasswordEveryone, PasswordAdmins, PasswordOff:
	default:
		return fmt.Errorf("password sign-in must be everyone, admins, or off (got %q)", v)
	}
	raw, _ := json.Marshal(v)
	if err := s.q.UpsertSetting(ctx, dbgen.UpsertSettingParams{Key: keyPasswordSignIn, Value: raw}); err != nil {
		return fmt.Errorf("write %s: %w", keyPasswordSignIn, err)
	}
	return nil
}

// SpaceCreation is who may create spaces.
type SpaceCreation string

const (
	SpaceCreationAdmins   SpaceCreation = "admins"
	SpaceCreationEveryone SpaceCreation = "everyone"
)

// Defaults are the first-boot values; they never override stored settings.
type Defaults struct {
	RegistrationPolicy Policy
	// InstanceNameEnv is STOOP_INSTANCE_NAME. Empty means Seed picks a
	// random name.
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
	s.instanceNameEnv = d.InstanceNameEnv
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

// readSetting decodes one JSON-string setting, returning fallback if unset.
func (s *Service) readSetting(ctx context.Context, key, fallback string) (string, error) {
	return readSettingOr(ctx, s, key, fallback)
}

// SpaceCreationPolicy is the current setting.
func (s *Service) SpaceCreationPolicy(ctx context.Context) (SpaceCreation, error) {
	v, err := s.readSetting(ctx, keySpaceCreation, string(SpaceCreationAdmins))
	return SpaceCreation(v), err
}

// MembersMayCreateSpaces satisfies the chat module's port.
func (s *Service) MembersMayCreateSpaces(ctx context.Context) (bool, error) {
	p, err := s.SpaceCreationPolicy(ctx)
	return p == SpaceCreationEveryone, err
}

// RegistrationPolicy is the current policy; it also satisfies the auth
// module's port (which sees it as a string).
func (s *Service) RegistrationPolicy(ctx context.Context) (string, error) {
	policy, err := readSettingOr(ctx, s, keyRegistrationPolicy, PolicyInvite)
	return string(policy), err
}

// InstanceName is the current setting: saved, else the environment, else
// "Stoop". The last only happens when the database was wiped under a
// running server (make dev-reset, the e2e harness): Seed picks the random
// name at boot, and nothing re-runs it until the next one.
func (s *Service) InstanceName(ctx context.Context) (string, error) {
	fallback := s.instanceNameEnv
	if fallback == "" {
		fallback = "Stoop"
	}
	return s.readSetting(ctx, keyInstanceName, fallback)
}

// StorageQuotaBytes implements files.Policy: the upload cap, 0 = unlimited.
func (s *Service) StorageQuotaBytes(ctx context.Context) (int64, error) {
	return readSettingOr(ctx, s, keyStorageQuota, int64(0))
}

// UseUploadCeiling supplies the hard per-file cap the files module
// enforces regardless of settings. It bounds what an operator may save,
// so the admin page refuses an impossible number instead of storing one
// that would be silently clamped at upload time.
func (s *Service) UseUploadCeiling(n int64) { s.uploadCeiling = n }

// MaxUploadBytes implements files.Policy: the operator's cap on one file,
// 0 = they set none (the caller's own ceiling then applies).
func (s *Service) MaxUploadBytes(ctx context.Context) (int64, error) {
	return readSettingOr(ctx, s, keyMaxUpload, int64(0))
}

// effectiveMaxUpload resolves the setting against the ceiling the way the
// files module does, so the number on the status is the one an upload
// will actually be measured against.
func (s *Service) effectiveMaxUpload(ctx context.Context) (int64, error) {
	n, err := s.MaxUploadBytes(ctx)
	if err != nil {
		return 0, err
	}
	if s.uploadCeiling <= 0 {
		return n, nil
	}
	if n <= 0 || n > s.uploadCeiling {
		return s.uploadCeiling, nil
	}
	return n, nil
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
		NeedsSetup: n == 0, RegistrationPolicy: toProtoPolicy(Policy(p)),
		SpaceCreation: toProtoSpaceCreation(sc), StorageQuotaBytes: quota,
		LoginProviders: summaries, PasswordSignIn: toProtoPasswordSignIn(PasswordSignIn(pw)),
		MaxUploadBytes: maxUpload, InstanceName: name,
		PersonalTokens:    toProtoPersonalTokens(TokenSetting(tokens)),
		WebhooksAvailable: s.webhooksEnv, WebhooksIncoming: incoming, WebhooksOutgoing: outgoing,
		WebhooksAllowPrivateTargets: private, SelfDeletion: selfDeletion,
		SessionLifetimeDays:  int32(sessionDays),
		MessageRetentionDays: int32(messageDays), AttachmentRetentionDays: int32(attachmentDays),
		VoiceAvailable: s.VoiceAvailable(),
	}, nil
}

// SelfDeletion is whether a person may delete their own account. Also
// the auth module's port.
func (s *Service) SelfDeletion(ctx context.Context) (bool, error) {
	return s.readBool(ctx, keySelfDeletion, true)
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
		p, ok := policyFromProto(*msg.RegistrationPolicy)
		if !ok {
			return connect.NewError(connect.CodeInvalidArgument, errors.New("registration_policy must be open, invite, or closed"))
		}
		writes = append(writes, settingWrite{keyRegistrationPolicy, p})
	}
	if msg.SpaceCreation != nil {
		var sc SpaceCreation
		switch *msg.SpaceCreation {
		case instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_ADMINS:
			sc = SpaceCreationAdmins
		case instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_EVERYONE:
			sc = SpaceCreationEveryone
		default:
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
		pw, ok := passwordSignInFromProto(*msg.PasswordSignIn)
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
		v, err := personalTokensFromProto(*msg.PersonalTokens)
		if err != nil {
			return err
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

func toProtoPasswordSignIn(p PasswordSignIn) instancev1.PasswordSignIn {
	switch p {
	case PasswordAdmins:
		return instancev1.PasswordSignIn_PASSWORD_SIGN_IN_ADMINS
	case PasswordOff:
		return instancev1.PasswordSignIn_PASSWORD_SIGN_IN_OFF
	default:
		return instancev1.PasswordSignIn_PASSWORD_SIGN_IN_EVERYONE
	}
}

func passwordSignInFromProto(p instancev1.PasswordSignIn) (PasswordSignIn, bool) {
	switch p {
	case instancev1.PasswordSignIn_PASSWORD_SIGN_IN_EVERYONE:
		return PasswordEveryone, true
	case instancev1.PasswordSignIn_PASSWORD_SIGN_IN_ADMINS:
		return PasswordAdmins, true
	case instancev1.PasswordSignIn_PASSWORD_SIGN_IN_OFF:
		return PasswordOff, true
	default:
		return "", false
	}
}

func toProtoSpaceCreation(p SpaceCreation) instancev1.SpaceCreationPolicy {
	if p == SpaceCreationEveryone {
		return instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_EVERYONE
	}
	return instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_ADMINS
}

func toProtoPolicy(p Policy) instancev1.RegistrationPolicy {
	switch p {
	case PolicyOpen:
		return instancev1.RegistrationPolicy_REGISTRATION_POLICY_OPEN
	case PolicyInvite:
		return instancev1.RegistrationPolicy_REGISTRATION_POLICY_INVITE
	case PolicyClosed:
		return instancev1.RegistrationPolicy_REGISTRATION_POLICY_CLOSED
	default:
		return instancev1.RegistrationPolicy_REGISTRATION_POLICY_UNSPECIFIED
	}
}

func policyFromProto(p instancev1.RegistrationPolicy) (Policy, bool) {
	switch p {
	case instancev1.RegistrationPolicy_REGISTRATION_POLICY_OPEN:
		return PolicyOpen, true
	case instancev1.RegistrationPolicy_REGISTRATION_POLICY_INVITE:
		return PolicyInvite, true
	case instancev1.RegistrationPolicy_REGISTRATION_POLICY_CLOSED:
		return PolicyClosed, true
	default:
		return "", false
	}
}
