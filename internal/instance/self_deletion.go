package instance

import (
	"context"
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
