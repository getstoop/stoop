package instance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
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
	// keyPasswordSignIn: who may use the username/password form. Not
	// seeded: STOOP_PASSWORD_SIGN_IN stays live as the fallback.
	keyPasswordSignIn = "password_sign_in"
	// keyInstanceName: shown in the browser tab. Seeded with a random
	// name unless STOOP_INSTANCE_NAME is set, in which case (like
	// keyPasswordSignIn) it's left unseeded and stays live as the
	// fallback.
	keyInstanceName = "instance_name"
)

// MaxInstanceNameRunes bounds the name in characters, not bytes. The
// admin form's maxLength and config's STOOP_INSTANCE_NAME check use the
// same number.
const MaxInstanceNameRunes = 100

// PasswordSignIn is who may sign in (and register) with a password; the
// auth module consumes it as a string through its PasswordPolicy port.
type PasswordSignIn string

const (
	PasswordEveryone PasswordSignIn = "everyone"
	PasswordAdmins   PasswordSignIn = "admins"
	PasswordOff      PasswordSignIn = "off"
)

// UsePasswordSignInEnv supplies the environment fallback.
func (s *Service) UsePasswordSignInEnv(v string) { s.passwordEnv = v }

// PasswordSignIn is the effective setting: saved, else environment, else
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
	// random name instead of seeding one from it.
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
	if d.InstanceNameEnv == "" {
		name, err := randomInstanceName()
		if err != nil {
			return fmt.Errorf("generate instance name: %w", err)
		}
		nv, _ := json.Marshal(name)
		if err := s.q.SeedSetting(ctx, dbgen.SeedSettingParams{Key: keyInstanceName, Value: nv}); err != nil {
			return fmt.Errorf("seed %s: %w", keyInstanceName, err)
		}
	}
	return nil
}

// readSetting decodes one JSON-string setting, returning fallback if unset.
func (s *Service) readSetting(ctx context.Context, key, fallback string) (string, error) {
	raw, err := s.q.GetSetting(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) {
		return fallback, nil
	}
	if err != nil {
		return "", fmt.Errorf("read %s: %w", key, err)
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		return "", fmt.Errorf("decode %s: %w", key, err)
	}
	return v, nil
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
	raw, err := s.q.GetSetting(ctx, keyRegistrationPolicy)
	if errors.Is(err, pgx.ErrNoRows) {
		return string(PolicyInvite), nil
	}
	if err != nil {
		return "", fmt.Errorf("read %s: %w", keyRegistrationPolicy, err)
	}
	var p Policy
	if err := json.Unmarshal(raw, &p); err != nil {
		return "", fmt.Errorf("decode %s: %w", keyRegistrationPolicy, err)
	}
	return string(p), nil
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
	raw, err := s.q.GetSetting(ctx, keyStorageQuota)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read %s: %w", keyStorageQuota, err)
	}
	var n int64
	if err := json.Unmarshal(raw, &n); err != nil {
		return 0, fmt.Errorf("decode %s: %w", keyStorageQuota, err)
	}
	return n, nil
}

// UseUploadCeiling supplies the hard per-file cap the files module
// enforces regardless of settings. It bounds what an operator may save,
// so the admin page refuses an impossible number instead of storing one
// that would be silently clamped at upload time.
func (s *Service) UseUploadCeiling(n int64) { s.uploadCeiling = n }

// MaxUploadBytes implements files.Policy: the operator's cap on one file,
// 0 = they set none (the caller's own ceiling then applies).
func (s *Service) MaxUploadBytes(ctx context.Context) (int64, error) {
	raw, err := s.q.GetSetting(ctx, keyMaxUpload)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read %s: %w", keyMaxUpload, err)
	}
	var n int64
	if err := json.Unmarshal(raw, &n); err != nil {
		return 0, fmt.Errorf("decode %s: %w", keyMaxUpload, err)
	}
	return n, nil
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
	name, err := s.InstanceName(ctx)
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
	}, nil
}

func (s *Service) GetInstanceStatus(ctx context.Context, _ *connect.Request[instancev1.GetInstanceStatusRequest]) (*connect.Response[instancev1.GetInstanceStatusResponse], error) {
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
	if err := requireAdmin(ctx); err != nil {
		return nil, err
	}
	// The name goes first: it is the one field with a validation that can
	// fail on the value alone, and the Server form sends it together with
	// the two policies below. Refusing it before any of them is written
	// keeps a rejected save from half-applying.
	if req.Msg.InstanceName != nil {
		name := strings.TrimSpace(*req.Msg.InstanceName)
		if name == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("instance_name must not be blank"))
		}
		if utf8.RuneCountInString(name) > MaxInstanceNameRunes {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("instance_name must be %d characters or fewer", MaxInstanceNameRunes))
		}
		v, _ := json.Marshal(name)
		if err := s.q.UpsertSetting(ctx, dbgen.UpsertSettingParams{Key: keyInstanceName, Value: v}); err != nil {
			return nil, fmt.Errorf("write %s: %w", keyInstanceName, err)
		}
	}
	if req.Msg.RegistrationPolicy != nil {
		p, ok := policyFromProto(*req.Msg.RegistrationPolicy)
		if !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("registration_policy must be open, invite, or closed"))
		}
		v, _ := json.Marshal(p)
		if err := s.q.UpsertSetting(ctx, dbgen.UpsertSettingParams{Key: keyRegistrationPolicy, Value: v}); err != nil {
			return nil, fmt.Errorf("write %s: %w", keyRegistrationPolicy, err)
		}
	}
	if req.Msg.SpaceCreation != nil {
		var sc SpaceCreation
		switch *req.Msg.SpaceCreation {
		case instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_ADMINS:
			sc = SpaceCreationAdmins
		case instancev1.SpaceCreationPolicy_SPACE_CREATION_POLICY_EVERYONE:
			sc = SpaceCreationEveryone
		default:
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("space_creation must be admins or everyone"))
		}
		v, _ := json.Marshal(sc)
		if err := s.q.UpsertSetting(ctx, dbgen.UpsertSettingParams{Key: keySpaceCreation, Value: v}); err != nil {
			return nil, fmt.Errorf("write %s: %w", keySpaceCreation, err)
		}
	}
	if req.Msg.StorageQuotaBytes != nil {
		if *req.Msg.StorageQuotaBytes < 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("storage_quota_bytes must be 0 (unlimited) or more"))
		}
		v, _ := json.Marshal(*req.Msg.StorageQuotaBytes)
		if err := s.q.UpsertSetting(ctx, dbgen.UpsertSettingParams{Key: keyStorageQuota, Value: v}); err != nil {
			return nil, fmt.Errorf("write %s: %w", keyStorageQuota, err)
		}
	}
	if req.Msg.MaxUploadBytes != nil {
		n := *req.Msg.MaxUploadBytes
		if n < 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("max_upload_bytes must be 0 (no limit) or more"))
		}
		if s.uploadCeiling > 0 && n > s.uploadCeiling {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("max_upload_bytes must be %d MB or less", s.uploadCeiling>>20))
		}
		// A per-file cap above the total storage limit is a limit that can
		// never be reached. Read after the quota branch above, so setting
		// both at once is judged against the new total, not the old one.
		quota, err := s.StorageQuotaBytes(ctx)
		if err != nil {
			return nil, err
		}
		if quota > 0 && n > quota {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("max_upload_bytes must not exceed the upload storage limit of %d MB", quota>>20))
		}
		v, _ := json.Marshal(n)
		if err := s.q.UpsertSetting(ctx, dbgen.UpsertSettingParams{Key: keyMaxUpload, Value: v}); err != nil {
			return nil, fmt.Errorf("write %s: %w", keyMaxUpload, err)
		}
	}
	if req.Msg.PasswordSignIn != nil {
		pw, ok := passwordSignInFromProto(*req.Msg.PasswordSignIn)
		if !ok {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("password_sign_in must be everyone, admins, or off"))
		}
		// Never save "nobody can log in": below everyone needs a provider.
		if pw != PasswordEveryone {
			providers, err := s.LoginProviders(ctx)
			if err != nil {
				return nil, err
			}
			if len(providers) == 0 {
				return nil, connect.NewError(connect.CodeFailedPrecondition,
					errors.New("add a login provider before restricting password sign-in"))
			}
		}
		if err := s.SetPasswordSignIn(ctx, pw); err != nil {
			return nil, err
		}
	}
	st, err := s.status(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&instancev1.UpdateSettingsResponse{Status: st}), nil
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
