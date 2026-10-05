package instance

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
	"github.com/getstoop/stoop/internal/apierr"
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

// stageStorageLimits validates a save of the storage quota and the
// per-file cap together, since each bounds the other.
func (s *Service) stageStorageLimits(ctx context.Context, msg *instancev1.UpdateSettingsRequest, save *settingSave) error {
	quota, err := s.StorageQuotaBytes(ctx)
	if err != nil {
		return err
	}
	if requested := msg.StorageQuotaBytes; requested != nil {
		if *requested < 0 {
			return apierr.Field(connect.CodeInvalidArgument, "storage_quota_bytes", errors.New("the storage limit must be 0 (no limit) or more"))
		}
		quota = *requested
		save.write(keyStorageQuota, *requested)
	}
	if msg.MaxUploadBytes != nil {
		perFile := *msg.MaxUploadBytes
		if perFile < 0 {
			return apierr.Field(connect.CodeInvalidArgument, "max_upload_bytes", errors.New("the size per file must be 0 (no limit) or more"))
		}
		if s.uploadCeiling > 0 && perFile > s.uploadCeiling {
			return apierr.Field(connect.CodeInvalidArgument, "max_upload_bytes",
				fmt.Errorf("the size per file must be %d MB or less", s.uploadCeiling>>20))
		}
		// A per-file cap above the total storage limit is a limit that can
		// never be reached. Judged against the quota in this request when
		// it sets one.
		if quota > 0 && perFile > quota {
			return apierr.Field(connect.CodeInvalidArgument, "max_upload_bytes",
				fmt.Errorf("the size per file is more than the upload storage limit of %d MB", quota>>20))
		}
		save.write(keyMaxUpload, perFile)
	}
	return nil
}
