package instance

import (
	"context"

	instancev1 "github.com/getstoop/stoop/gen/stoop/instance/v1"
)

// keySelfDeletion: whether a person may delete their own account. On
// unless the operator turns it off. Read by auth through its
// DeletionPolicy port.
const keySelfDeletion = "self_deletion"

// SelfDeletion is whether a person may delete their own account. Also
// the auth module's port.
func (s *Service) SelfDeletion(ctx context.Context) (bool, error) {
	return s.readBool(ctx, keySelfDeletion, true)
}

func stageSelfDeletion(_ context.Context, msg *instancev1.UpdateSettingsRequest, save *settingSave) error {
	stageBool(save, keySelfDeletion, msg.SelfDeletion)
	return nil
}
