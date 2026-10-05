package instance

import (
	"context"
)

const (
	// keyStorageQuota caps total upload storage in bytes; absent or 0 is
	// unlimited. Read by the files module through its Policy port.
	keyStorageQuota = "storage_quota_bytes"
	// keyMaxUpload caps one uploaded file in bytes; absent or 0 means the
	// operator set no limit
	keyMaxUpload = "max_upload_bytes"
)

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
