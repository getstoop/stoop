package instance

import (
	"context"

	"github.com/getstoop/stoop/internal/trustedproxy"
)

const keyTrustedProxies = "trusted_proxies"

// maxTrustedProxies bounds the saved list; a homelab has one or two.
const maxTrustedProxies = 32

// trustedProxies resolves the saved address list, or the environment's
// (STOOP_TRUSTED_PROXIES) when none is saved. A saved empty list trusts
// nothing.
func (s *Service) trustedProxies(ctx context.Context) (trustedproxy.Set, error) {
	var saved []string
	ok, err := s.readJSON(ctx, keyTrustedProxies, &saved)
	if err != nil {
		return trustedproxy.Set{}, err
	}
	if ok {
		set, err := trustedproxy.Parse(saved)
		if err != nil {
			// Saved values were validated on the way in; a bad one here
			// means hand-edited settings. Trust nothing rather than guess.
			return trustedproxy.Set{}, nil
		}
		return set, nil
	}
	return s.env.TrustedProxies, nil
}

// LoadTrustedProxies primes the cache that TrustsPeer reads. Called once
// at startup; UpdateReachability refreshes it on every save, so a change
// takes effect on the next request without a restart.
func (s *Service) LoadTrustedProxies(ctx context.Context) error {
	set, err := s.trustedProxies(ctx)
	if err != nil {
		return err
	}
	s.trusted.Store(&set)
	return nil
}

// TrustsPeer reports whether remoteAddr is a proxy whose forwarded
// headers may be believed. Read on every request, so it never touches the
// database: the answer comes from the cache LoadTrustedProxies fills.
func (s *Service) TrustsPeer(remoteAddr string) bool {
	set := s.trusted.Load()
	if set == nil {
		return false
	}
	return set.Trusted(remoteAddr)
}
