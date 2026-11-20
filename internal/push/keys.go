package push

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	pushv1 "github.com/getstoop/stoop/gen/stoop/push/v1"
	"github.com/getstoop/stoop/internal/dbgen"
)

// The signing key (RFC 8292): one P-256 pair per server, made on first use
// and kept in push_keys. The private half never leaves the server.

func (s *Service) GetPushConfig(ctx context.Context, _ *connect.Request[pushv1.GetPushConfigRequest]) (*connect.Response[pushv1.GetPushConfigResponse], error) {
	if _, err := requireSession(ctx); err != nil {
		return nil, err
	}
	public, err := s.signingPublicKey(ctx)
	if err != nil {
		return nil, err
	}
	on, err := s.enabled(ctx)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&pushv1.GetPushConfigResponse{Enabled: on, ApplicationServerKey: public}), nil
}

// signingPublicKey is the key's public point, made and stored first if
// there is none. Two servers racing both insert; the first row stands and
// both read it back.
func (s *Service) signingPublicKey(ctx context.Context) ([]byte, error) {
	s.keyMu.Lock()
	defer s.keyMu.Unlock()
	if s.publicKey != nil {
		return s.publicKey, nil
	}
	row, err := s.q.GetPushKey(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		private, public, genErr := newSigningKey()
		if genErr != nil {
			return nil, genErr
		}
		if err := s.q.InsertPushKey(ctx, dbgen.InsertPushKeyParams{PrivateKey: private, PublicKey: public}); err != nil {
			return nil, fmt.Errorf("store push key: %w", err)
		}
		row, err = s.q.GetPushKey(ctx)
	}
	if err != nil {
		return nil, fmt.Errorf("load push key: %w", err)
	}
	if err := checkSigningKey(row.PrivateKey, row.PublicKey); err != nil {
		return nil, err
	}
	s.publicKey = row.PublicKey
	return s.publicKey, nil
}

// signingKey is the private half, made first if there is none, for
// signing deliveries.
func (s *Service) signingKey(ctx context.Context) (*ecdsa.PrivateKey, error) {
	if _, err := s.signingPublicKey(ctx); err != nil {
		return nil, err
	}
	row, err := s.q.GetPushKey(ctx)
	if err != nil {
		return nil, fmt.Errorf("load push key: %w", err)
	}
	if err := checkSigningKey(row.PrivateKey, row.PublicKey); err != nil {
		return nil, err
	}
	parsed, err := x509.ParsePKCS8PrivateKey(row.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("read push key: %w", err)
	}
	return parsed.(*ecdsa.PrivateKey), nil
}

// newSigningKey returns a fresh pair: the private key as PKCS #8 DER, the
// public key as an uncompressed point.
func newSigningKey() (private, public []byte, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("make push key: %w", err)
	}
	private, err = x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, nil, fmt.Errorf("encode push key: %w", err)
	}
	public, err = publicPoint(key)
	if err != nil {
		return nil, nil, err
	}
	return private, public, nil
}

// checkSigningKey refuses a stored pair whose halves disagree, so a
// damaged row fails here rather than in every notification later.
func checkSigningKey(private, public []byte) error {
	parsed, err := x509.ParsePKCS8PrivateKey(private)
	if err != nil {
		return fmt.Errorf("read push key: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || key.Curve != elliptic.P256() {
		return errors.New("read push key: not a P-256 key")
	}
	derived, err := publicPoint(key)
	if err != nil {
		return err
	}
	if !bytes.Equal(derived, public) {
		return errors.New("read push key: the stored public key does not match the private key")
	}
	return nil
}

func publicPoint(key *ecdsa.PrivateKey) ([]byte, error) {
	public, err := key.PublicKey.ECDH()
	if err != nil {
		return nil, fmt.Errorf("push key: %w", err)
	}
	return public.Bytes(), nil
}
