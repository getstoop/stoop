package chat_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	accessv1 "github.com/getstoop/stoop/gen/stoop/access/v1"
	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

func permissionSet(s *chatv1.Space) map[accessv1.Permission]bool {
	out := map[accessv1.Permission]bool{}
	for _, p := range s.MyPermissions {
		out[p] = true
	}
	return out
}

func sameSet(got map[accessv1.Permission]bool, want ...accessv1.Permission) bool {
	if len(got) != len(want) {
		return false
	}
	for _, p := range want {
		if !got[p] {
			return false
		}
	}
	return true
}

// my_permissions is the server's answer for the viewer and the credential
// they called with.
func TestMyPermissions(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), dbDirectory{pool})
	owner := newUser(t, pool, "owner", authctx.RoleMember)
	member := newUser(t, pool, "member", authctx.RoleMember)

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	if got := permissionSet(sp.Msg.Space); !got[accessv1.Permission_PERMISSION_SPACE_DELETE] || !got[accessv1.Permission_PERMISSION_CHANNELS_MANAGE] {
		t.Errorf("the owner's permissions %v lack delete or channels.manage", sp.Msg.Space.MyPermissions)
	}

	inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	joined, err := svc.JoinSpace(member, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code}))
	if err != nil {
		t.Fatal(err)
	}
	memberHolds := []accessv1.Permission{
		accessv1.Permission_PERMISSION_SPACE_READ, accessv1.Permission_PERMISSION_MESSAGES_READ,
		accessv1.Permission_PERMISSION_MESSAGES_POST, accessv1.Permission_PERMISSION_VOICE_JOIN,
	}
	if got := permissionSet(joined.Msg.Space); !sameSet(got, memberHolds...) {
		t.Errorf("a member's permissions = %v", joined.Msg.Space.MyPermissions)
	}

	if _, err := pool.Exec(context.Background(), `UPDATE spaces SET members_can_invite = true WHERE id = $1`, spaceID); err != nil {
		t.Fatal(err)
	}
	after, err := svc.GetSpace(member, connect.NewRequest(&chatv1.GetSpaceRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if !permissionSet(after.Msg.Space)[accessv1.Permission_PERMISSION_INVITES_CREATE] {
		t.Error("members_can_invite should add invites.create to a member's permissions")
	}

	id, _ := authctx.From(owner)
	id.Credential = authctx.Credential{
		Kind:   authctx.CredentialPersonalToken,
		Grants: []authctx.Action{authctx.SpaceRead, authctx.MessagesRead},
	}
	readOnly, err := svc.GetSpace(authctx.WithIdentity(context.Background(), id), connect.NewRequest(&chatv1.GetSpaceRequest{SpaceId: spaceID}))
	if err != nil {
		t.Fatal(err)
	}
	if got := permissionSet(readOnly.Msg.Space); !sameSet(got, accessv1.Permission_PERMISSION_SPACE_READ, accessv1.Permission_PERMISSION_MESSAGES_READ) {
		t.Errorf("the owner's read-only token permissions = %v", readOnly.Msg.Space.MyPermissions)
	}

	id.Credential.Bounded = true
	id.Credential.Spaces = []string{"00000000-0000-0000-0000-000000000001"}
	listed, err := svc.ListSpaces(authctx.WithIdentity(context.Background(), id), connect.NewRequest(&chatv1.ListSpacesRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Msg.Spaces) != 0 {
		t.Errorf("a token bounded elsewhere listed %d spaces", len(listed.Msg.Spaces))
	}
}

// A credential narrower than its holder's role is refused what the role
// alone would allow: both gates must pass.
func TestCredentialNarrowsRole(t *testing.T) {
	pool := dbtest.New(t)
	svc := chat.New(pool, events.NewInProcBus(), noDirectory{})

	owner := newUser(t, pool, "owner", authctx.RoleMember)
	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID := sp.Msg.Space.Id
	channels, err := svc.ListChannels(owner, connect.NewRequest(&chatv1.ListChannelsRequest{SpaceId: spaceID}))
	if err != nil || len(channels.Msg.Channels) == 0 {
		t.Fatalf("list channels: %v", err)
	}
	channelID := channels.Msg.Channels[0].Id

	id, _ := authctx.From(owner)
	id.Credential = authctx.Credential{
		ID: "t", Kind: authctx.CredentialPersonalToken,
		Grants: []authctx.Action{authctx.SpaceRead, authctx.MessagesRead},
	}
	readOnly := authctx.WithIdentity(context.Background(), id)

	refusedByToken := func(name string, err error) {
		t.Helper()
		if code(err) != connect.CodePermissionDenied || !strings.Contains(err.Error(), "token") {
			t.Errorf("%s: want a token refusal, got %v", name, err)
		}
	}

	_, err = svc.CreateChannel(readOnly, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "nope"}))
	refusedByToken("owner's read-only token CreateChannel", err)
	_, err = svc.SendMessage(readOnly, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: channelID, Content: "hi"}))
	refusedByToken("owner's read-only token SendMessage", err)
	_, err = svc.DeleteSpace(readOnly, connect.NewRequest(&chatv1.DeleteSpaceRequest{SpaceId: spaceID}))
	refusedByToken("owner's read-only token DeleteSpace", err)

	if _, err := svc.ListMessages(readOnly, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID})); err != nil {
		t.Errorf("read-only token ListMessages: %v", err)
	}
	if ok, err := svc.MayReadSpace(readOnly, spaceID); err != nil || !ok {
		t.Errorf("read-only token MayReadSpace: %v, %v", ok, err)
	}

	id.Credential.Grants = []authctx.Action{authctx.SpaceRead}
	if ok, err := svc.MayReadSpace(authctx.WithIdentity(context.Background(), id), spaceID); err != nil || ok {
		t.Errorf("token without messages.read MayReadSpace: %v, %v", ok, err)
	}

	// The right grant, bounded to a different space.
	id.Credential = authctx.Credential{
		ID: "t", Kind: authctx.CredentialPersonalToken,
		Grants:  []authctx.Action{authctx.ChannelsManage, authctx.MessagesRead},
		Bounded: true, Spaces: []string{"00000000-0000-0000-0000-000000000001"},
	}
	elsewhere := authctx.WithIdentity(context.Background(), id)
	_, err = svc.CreateChannel(elsewhere, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "nope"}))
	refusedByToken("token bounded to another space CreateChannel", err)
	_, err = svc.ListMessages(elsewhere, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: channelID}))
	refusedByToken("token bounded to another space ListMessages", err)

	id.Credential.Spaces = []string{spaceID}
	if _, err := svc.CreateChannel(authctx.WithIdentity(context.Background(), id),
		connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: "allowed"})); err != nil {
		t.Errorf("token bounded to this space CreateChannel: %v", err)
	}
}
