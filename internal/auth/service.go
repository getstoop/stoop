// Package auth owns who someone is: accounts, sign-in, credentials
// (sessions and tokens) and the interceptor that authenticates every
// Connect request. Other modules learn about users only through ports
// wired in internal/app. See docs/architecture/identity.md.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/alexedwards/argon2id"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/db"
	"github.com/getstoop/stoop/internal/dbgen"
	"github.com/getstoop/stoop/internal/events"
	"github.com/getstoop/stoop/internal/kv"
)

type Options struct {
	// SecureCookies marks session cookies Secure; enable behind HTTPS.
	SecureCookies bool
	// Argon2Params tunes password hashing; nil uses defaults suited to
	// small servers (64 MiB, t=2). Lower memory on Pi-class hardware.
	Argon2Params *argon2id.Params
	// Procedures classifies every Connect procedure for the credential gate
	// (see authctx.Rule). A procedure not in the map is refused, so a nil map
	// refuses every call that goes through the interceptor.
	Procedures map[string]authctx.Rule
	// Stores backs the keyed state auth keeps in memory: desktop sign-in
	// attempts and lockouts. nil opens an in-process backend of its own.
	Stores kv.Backend
	// HashSlots is how many password hashes run at once; 0 is
	// defaultHashSlots.
	HashSlots int
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
	// hashSlots bounds the password hashes running at once (hashing.go).
	hashSlots chan struct{}
	hashWait  time.Duration
	policy    RegistrationPolicy
	invites   InviteRedeemer
	providers ProviderSource
	passwords PasswordPolicy
	tokens    TokenPolicy
	sessions  SessionPolicy
	deletion  DeletionPolicy
	departure AccountDeparture
	// bus carries CredentialRevoked to the gateway (revocation.go).
	bus events.Bus
	// stateKey signs the short-lived login-state cookie (loginflow.go).
	// Per-process: a restart mid-sign-in just expires the attempt.
	stateKey []byte
	// oidcCache holds discovery results per issuer+client (oidc.go).
	oidcCache oidcCache
	// desktop holds in-flight desktop sign-in attempts (desktopauth.go).
	desktop *desktopStore
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
	stores := opts.Stores
	if stores == nil {
		stores = kv.NewMemory(nil)
	}
	slots := opts.HashSlots
	if slots <= 0 {
		slots = defaultHashSlots
	}
	return &Service{pool: pool, q: dbgen.New(pool), opts: opts, argon2: params,
		guard: newLoginGuard(stores), dummyHash: dummy, stateKey: stateKey,
		hashSlots: make(chan struct{}, slots), hashWait: hashWait,
		desktop: newDesktopStore(stores)}
}

// randomToken is 32 random bytes as unpadded URL-safe base64 (43 characters).
func randomToken() string {
	raw := make([]byte, 32)
	// Read never fails: since Go 1.24 crypto/rand stops the program instead.
	_, _ = rand.Read(raw)
	return base64.RawURLEncoding.EncodeToString(raw)
}

// hashToken is the SHA-256 the database keeps in place of a token.
func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// newToken makes a secret with the given prefix and the hash to store for it.
func newToken(prefix string) (secret string, hash []byte) {
	secret = prefix + randomToken()
	return secret, hashToken(secret)
}

// inTx runs fn in a transaction with queries bound to it.
func (s *Service) inTx(ctx context.Context, fn func(qtx *dbgen.Queries) error) error {
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error { return fn(s.q.WithTx(tx)) })
}
