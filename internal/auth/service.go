// Package auth owns users and sessions: registration, login, and the
// interceptor that authenticates every Connect request. It owns the users and
// sessions tables; other modules learn about users only through exported
// lookup methods wired as ports in internal/app.
package auth

import (
	"crypto/rand"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/alexedwards/argon2id"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/dbgen"
)

type Options struct {
	// SecureCookies marks session cookies Secure; enable behind HTTPS.
	SecureCookies bool
	// Argon2Params tunes password hashing; nil uses defaults suited to
	// small servers (64 MiB, t=2). Lower memory on Pi-class hardware.
	Argon2Params *argon2id.Params
	// PublicProcedures are additional Connect procedure names (e.g.
	// "/stoop.instance.v1.InstanceService/GetInstanceStatus") that may be
	// called without a session.
	PublicProcedures []string
}

type Service struct {
	pool   *pgxpool.Pool
	q      *dbgen.Queries
	opts   Options
	argon2 *argon2id.Params
	guard  *loginGuard
	// dummyHash is verified against when the username doesn't exist, so
	// an unknown user costs the same time as a wrong password and the
	// response can't be timed to enumerate accounts.
	dummyHash string
	policy    RegistrationPolicy
	invites   InviteRedeemer
	providers ProviderSource
	passwords PasswordPolicy
	// stateKey signs the short-lived login-state cookie (loginflow.go).
	// Per-process: a restart mid-sign-in just expires the attempt.
	stateKey []byte
	// oidcCache holds discovery results per issuer+client (oidc.go).
	oidcCache oidcCache
}

func New(pool *pgxpool.Pool, opts Options) *Service {
	params := opts.Argon2Params
	if params == nil {
		params = &argon2id.Params{
			Memory:      64 * 1024,
			Iterations:  2,
			Parallelism: 2,
			SaltLength:  16,
			KeyLength:   32,
		}
	}
	dummy, err := argon2id.CreateHash(uuid.NewString(), params)
	if err != nil {
		// argon2id only fails on entropy exhaustion; nothing sensible to do.
		panic(fmt.Sprintf("auth: create dummy hash: %v", err))
	}
	stateKey := make([]byte, 32)
	if _, err := rand.Read(stateKey); err != nil {
		panic(fmt.Sprintf("auth: read random: %v", err))
	}
	return &Service{pool: pool, q: dbgen.New(pool), opts: opts, argon2: params,
		guard: newLoginGuard(), dummyHash: dummy, stateKey: stateKey}
}

func notFoundOr(err error, what string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return connect.NewError(connect.CodeNotFound, fmt.Errorf("%s not found", what))
	}
	return err
}
