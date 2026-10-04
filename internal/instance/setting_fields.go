package instance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
)

// The environment-seeded settings as stoop admin setting names them: a
// group ("turn") holds fields ("turn.username"). Every change goes through
// the same Save methods as the admin page, so the CLI can't save what the
// page would refuse.

// SettingGroup is one seeded setting: one row in instance_settings.
type SettingGroup struct {
	Name string
	key  string
	// clearable: an empty value means something (off, none). The name
	// and password sign-in have no empty value.
	clearable bool
}

// SettingGroups is every group, in the order stoop admin lists them.
var SettingGroups = []SettingGroup{
	{"public-url", keyPublicURL, true},
	{"trusted-proxies", keyTrustedProxies, true},
	{"turn", keyTURN, true},
	{"cloudflare-turn", keyCloudflareTURN, true},
	{"tailscale", keyTailscale, true},
	{"cloudflare-tunnel", keyCloudflareTunnel, true},
	{"login-providers", keyLoginProviders, true},
	{"password-sign-in", keyPasswordSignIn, false},
	{"instance-name", keyInstanceName, false},
}

func settingGroup(name string) (SettingGroup, error) {
	for _, group := range SettingGroups {
		if group.Name == name {
			return group, nil
		}
	}
	return SettingGroup{}, fmt.Errorf("no setting group %q", name)
}

// SettingField is one value as stoop admin shows it. A secret's Value is
// only whether it is set.
type SettingField struct {
	Name   string
	Value  string
	Secret bool
	// Saved: the group has a row. Otherwise the value is the
	// environment's, read directly until the next start seeds it.
	Saved bool
}

// secretPlaceholder is how list shows a saved secret.
const secretPlaceholder = "(set)"

var secretFields = []string{"turn.credential", "cloudflare-turn.api-token", "tailscale.auth-key", "cloudflare-tunnel.token"}

func secretShown(secret string) string {
	if secret == "" {
		return ""
	}
	return secretPlaceholder
}

// SettingFields lists every field of every group.
func (s *Service) SettingFields(ctx context.Context) ([]SettingField, error) {
	inForce, err := s.Reachability(ctx)
	if err != nil {
		return nil, err
	}
	providers, err := s.LoginProviders(ctx)
	if err != nil {
		return nil, err
	}
	// Listed without client secrets, so the JSON can be edited and set
	// back: a blank secret keeps the saved one.
	shownProviders := []LoginProvider{}
	for _, provider := range providers {
		provider.ClientSecret = ""
		shownProviders = append(shownProviders, provider)
	}
	providersJSON, err := json.Marshal(shownProviders)
	if err != nil {
		return nil, err
	}
	password, err := s.PasswordSignIn(ctx)
	if err != nil {
		return nil, err
	}
	name, err := s.InstanceName(ctx)
	if err != nil {
		return nil, err
	}
	saved := map[string]bool{}
	for _, group := range SettingGroups {
		var raw json.RawMessage
		if saved[group.Name], err = s.readJSON(ctx, group.key, &raw); err != nil {
			return nil, err
		}
	}
	fields := []struct {
		group, field, value string
		secret              bool
	}{
		{"public-url", "", inForce.PublicURL, false},
		{"trusted-proxies", "", strings.Join(inForce.TrustedProxies.Strings(), ","), false},
		{"turn", "urls", strings.Join(inForce.TURN.URLs, ","), false},
		{"turn", "username", inForce.TURN.Username, false},
		{"turn", "credential", secretShown(inForce.TURN.Credential), true},
		{"turn", "stun-urls", strings.Join(inForce.TURN.STUNURLs, ","), false},
		{"cloudflare-turn", "key-id", inForce.Cloudflare.KeyID, false},
		{"cloudflare-turn", "api-token", secretShown(inForce.Cloudflare.APIToken), true},
		{"tailscale", "enabled", strconv.FormatBool(inForce.Tailscale.Enabled), false},
		{"tailscale", "hostname", inForce.Tailscale.Hostname, false},
		{"tailscale", "funnel", strconv.FormatBool(inForce.Tailscale.Funnel), false},
		{"tailscale", "auth-key", secretShown(inForce.Tailscale.AuthKey), true},
		{"tailscale", "control-url", inForce.Tailscale.ControlURL, false},
		{"cloudflare-tunnel", "enabled", strconv.FormatBool(inForce.CloudflareTunnel.Enabled), false},
		{"cloudflare-tunnel", "token", secretShown(inForce.CloudflareTunnel.Token), true},
		{"login-providers", "", string(providersJSON), false},
		{"password-sign-in", "", password, false},
		{"instance-name", "", name, false},
	}
	out := make([]SettingField, 0, len(fields))
	for _, field := range fields {
		fullName := field.group
		if field.field != "" {
			fullName += "." + field.field
		}
		out = append(out, SettingField{Name: fullName, Value: field.value, Secret: field.secret, Saved: saved[field.group]})
	}
	return out, nil
}

// SetSettingFields saves name=value changes together, all or nothing.
// Fields of a group left out keep their value, and a secret left out is
// kept. The changes must belong to one admin-page form (Hosting, login
// providers, or the rest), since each form saves in its own transaction.
func (s *Service) SetSettingFields(ctx context.Context, changes map[string]string) error {
	inForce, err := s.Reachability(ctx)
	if err != nil {
		return err
	}
	reach := &instancev1.UpdateReachabilityRequest{}
	settings := &instancev1.UpdateSettingsRequest{}
	var providers []*instancev1.LoginProvider
	turn := func() *instancev1.TurnRelay {
		if reach.Turn == nil {
			reach.Turn = &instancev1.TurnRelay{Urls: inForce.TURN.URLs, Username: inForce.TURN.Username, StunUrls: inForce.TURN.STUNURLs}
		}
		return reach.Turn
	}
	cloudflare := func() *instancev1.CloudflareTurn {
		if reach.Cloudflare == nil {
			reach.Cloudflare = &instancev1.CloudflareTurn{KeyId: inForce.Cloudflare.KeyID}
		}
		return reach.Cloudflare
	}
	tailscale := func() *instancev1.TailscaleSettings {
		if reach.Tailscale == nil {
			current := inForce.Tailscale
			reach.Tailscale = &instancev1.TailscaleSettings{
				Enabled: current.Enabled, Hostname: current.Hostname, Funnel: current.Funnel, ControlUrl: current.ControlURL,
			}
		}
		return reach.Tailscale
	}
	tunnel := func() *instancev1.CloudflareTunnelSettings {
		if reach.CloudflareTunnel == nil {
			reach.CloudflareTunnel = &instancev1.CloudflareTunnelSettings{Enabled: inForce.CloudflareTunnel.Enabled}
		}
		return reach.CloudflareTunnel
	}
	names := make([]string, 0, len(changes))
	for name := range changes {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		value := changes[name]
		if value == secretPlaceholder && slices.Contains(secretFields, name) {
			return fmt.Errorf("%s: %s is how list shows a saved secret; leave the field out to keep it", name, secretPlaceholder)
		}
		var flag bool
		if strings.HasSuffix(name, ".enabled") || name == "tailscale.funnel" {
			if flag, err = strconv.ParseBool(value); err != nil {
				return fmt.Errorf("%s takes true or false", name)
			}
		}
		switch name {
		case "public-url":
			reach.PublicUrl = &value
		case "trusted-proxies":
			reach.TrustedProxies = &instancev1.TrustedProxies{Cidrs: splitComma(value)}
		case "turn.urls":
			turn().Urls = splitComma(value)
		case "turn.username":
			turn().Username = value
		case "turn.credential":
			turn().Credential = value
		case "turn.stun-urls":
			turn().StunUrls = splitComma(value)
		case "cloudflare-turn.key-id":
			cloudflare().KeyId = value
		case "cloudflare-turn.api-token":
			cloudflare().ApiToken = value
		case "tailscale.enabled":
			tailscale().Enabled = flag
		case "tailscale.hostname":
			tailscale().Hostname = value
		case "tailscale.funnel":
			tailscale().Funnel = flag
		case "tailscale.auth-key":
			tailscale().AuthKey = value
		case "tailscale.control-url":
			tailscale().ControlUrl = value
		case "cloudflare-tunnel.enabled":
			tunnel().Enabled = flag
		case "cloudflare-tunnel.token":
			tunnel().Token = value
		case "login-providers":
			var list []LoginProvider
			if err := json.Unmarshal([]byte(value), &list); err != nil {
				return fmt.Errorf("login-providers takes a JSON list: %w", err)
			}
			providers = []*instancev1.LoginProvider{}
			for _, provider := range list {
				if provider.ClientSecret == secretPlaceholder {
					return fmt.Errorf("login-providers: %s is not a client secret; leave it blank to keep the saved one", secretPlaceholder)
				}
				providers = append(providers, &instancev1.LoginProvider{
					Id: provider.ID, DisplayName: provider.DisplayName, Icon: provider.Icon, Issuer: provider.Issuer,
					ClientId: provider.ClientID, ClientSecret: provider.ClientSecret,
				})
			}
		case "password-sign-in":
			policy, ok := map[string]instancev1.PasswordSignIn{
				"everyone": instancev1.PasswordSignIn_PASSWORD_SIGN_IN_EVERYONE,
				"admins":   instancev1.PasswordSignIn_PASSWORD_SIGN_IN_ADMINS,
				"off":      instancev1.PasswordSignIn_PASSWORD_SIGN_IN_OFF,
			}[value]
			if !ok {
				return errors.New("password-sign-in takes everyone, admins, or off")
			}
			settings.PasswordSignIn = &policy
		case "instance-name":
			settings.InstanceName = &value
		default:
			return fmt.Errorf("no setting %q", name)
		}
	}
	forms := 0
	for _, touched := range []bool{
		providers != nil, settings.PasswordSignIn != nil || settings.InstanceName != nil,
		reachChanged(reach),
	} {
		if touched {
			forms++
		}
	}
	if forms > 1 {
		return errors.New("set Hosting fields, login-providers, and the other settings in separate commands")
	}
	switch {
	case providers != nil:
		return s.SaveLoginProviders(ctx, providers)
	case reachChanged(reach):
		return s.SaveReachability(ctx, reach)
	}
	return s.SaveSettings(ctx, settings)
}

func reachChanged(reach *instancev1.UpdateReachabilityRequest) bool {
	return reach.PublicUrl != nil || reach.TrustedProxies != nil || reach.Turn != nil ||
		reach.Cloudflare != nil || reach.Tailscale != nil || reach.CloudflareTunnel != nil
}

// ClearSetting saves a group empty: no address, no relay, switched off,
// no providers.
func (s *Service) ClearSetting(ctx context.Context, name string) error {
	group, err := settingGroup(name)
	if err != nil {
		return err
	}
	if !group.clearable {
		return fmt.Errorf("%s can't be empty; set it or reset it", name)
	}
	if group.key == keyLoginProviders {
		return s.SaveLoginProviders(ctx, nil)
	}
	empty := ""
	reach := &instancev1.UpdateReachabilityRequest{}
	switch group.key {
	case keyPublicURL:
		reach.PublicUrl = &empty
	case keyTrustedProxies:
		reach.TrustedProxies = &instancev1.TrustedProxies{}
	case keyTURN:
		reach.Turn = &instancev1.TurnRelay{}
	case keyCloudflareTURN:
		reach.Cloudflare = &instancev1.CloudflareTurn{}
	case keyTailscale:
		reach.Tailscale = &instancev1.TailscaleSettings{}
	case keyCloudflareTunnel:
		reach.CloudflareTunnel = &instancev1.CloudflareTunnelSettings{}
	}
	return s.SaveReachability(ctx, reach)
}

// ResetSetting deletes a group's row, so the environment's value is in
// force again and the next start seeds it. Reports whether a row existed.
// Like the page, it refuses to leave members no way to sign in.
func (s *Service) ResetSetting(ctx context.Context, name string) (bool, error) {
	group, err := settingGroup(name)
	if err != nil {
		return false, err
	}
	switch group.key {
	case keyLoginProviders:
		password, err := s.PasswordSignIn(ctx)
		if err != nil {
			return false, err
		}
		if len(s.loginEnv) == 0 && password != string(PasswordEveryone) {
			return false, errors.New("the environment has no login provider; let everyone use password sign-in first")
		}
	case keyPasswordSignIn:
		providers, err := s.LoginProviders(ctx)
		if err != nil {
			return false, err
		}
		if s.passwordEnv != "" && s.passwordEnv != string(PasswordEveryone) && len(providers) == 0 {
			return false, errors.New("STOOP_PASSWORD_SIGN_IN restricts password sign-in and no login provider is set")
		}
	}
	deleted, err := s.q.DeleteSetting(ctx, group.key)
	if err != nil {
		return false, fmt.Errorf("reset %s: %w", name, err)
	}
	return deleted > 0, nil
}

func splitComma(value string) []string {
	return trimAll(strings.Split(value, ","))
}
