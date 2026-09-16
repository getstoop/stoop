package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/chat"
	"github.com/getstoop/stoop/internal/db/dbtest"
	"github.com/getstoop/stoop/internal/events"
)

// See docs/architecture/messaging.md#announcement-channels.
func TestAnnouncementChannels(t *testing.T) {
	pool := dbtest.New(t)
	bus := events.NewInProcBus()
	svc := chat.New(pool, bus, botDirectory{pool})
	owner := newUser(t, pool, "casey", authctx.RoleMember)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	operator := newUser(t, pool, "operator", authctx.RoleAdmin)
	beaID := authctx.UserID(bea)

	sp, err := svc.CreateSpace(owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	for _, ctx := range []context.Context{ada, bea, operator} {
		inv, err := svc.CreateInvite(owner, connect.NewRequest(&chatv1.CreateInviteRequest{SpaceId: spaceID}))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := svc.JoinSpace(ctx, connect.NewRequest(&chatv1.JoinSpaceRequest{Code: inv.Msg.Invite.Code})); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.SetMemberRole(owner, connect.NewRequest(&chatv1.SetMemberRoleRequest{
		SpaceId: spaceID, UserId: beaID, Role: chatv1.SpaceRole_SPACE_ROLE_ADMIN,
	})); err != nil {
		t.Fatal(err)
	}
	bot := newBot(t, pool, "uptime")
	if err := svc.AddBotMember(context.Background(), spaceID, bot); err != nil {
		t.Fatal(err)
	}

	send := func(ctx context.Context, content, replyTo string) (*chatv1.Message, error) {
		res, err := svc.SendMessage(ctx, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: channelID, Content: content, ReplyToMessageId: replyTo,
		}))
		if err != nil {
			return nil, err
		}
		return res.Msg.Message, nil
	}
	adaOld, err := send(ada, "before", "")
	if err != nil {
		t.Fatal(err)
	}

	setPolicy := func(ctx context.Context, channel string, p chatv1.ChannelPostPolicy) (*chatv1.Channel, error) {
		res, err := svc.UpdateChannel(ctx, connect.NewRequest(&chatv1.UpdateChannelRequest{ChannelId: channel, PostPolicy: &p}))
		if err != nil {
			return nil, err
		}
		return res.Msg.Channel, nil
	}
	if _, err := setPolicy(ada, channelID, chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS); code(err) != connect.CodePermissionDenied {
		t.Errorf("member sets the policy: want permission_denied, got %v", err)
	}
	sub := bus.Subscribe("space:" + spaceID)
	defer sub.Close()
	ch, err := setPolicy(bea, channelID, chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS)
	if err != nil {
		t.Fatal(err)
	}
	if ch.PostPolicy != chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS {
		t.Errorf("response policy = %v", ch.PostPolicy)
	}
	if ev := <-sub.Events(); ev.GetChannelUpdated().GetPostPolicy() != chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS {
		t.Errorf("published %v, want channel_updated with the admins policy", ev.Payload)
	}

	// A member reads and reacts, and deletes their own, but doesn't post,
	// reply, edit or upload.
	if _, err := send(ada, "nice!", ""); code(err) != connect.CodePermissionDenied {
		t.Errorf("member posts: want permission_denied, got %v", err)
	}
	if _, err := send(ada, "nice!", adaOld.Id); code(err) != connect.CodePermissionDenied {
		t.Errorf("member replies: want permission_denied, got %v", err)
	}
	if _, err := svc.EditMessage(ada, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: adaOld.Id, Content: "after"})); code(err) != connect.CodePermissionDenied {
		t.Errorf("member edits an earlier message: want permission_denied, got %v", err)
	}
	if _, err := svc.ChannelSpaceToPostIn(ada, authctx.UserID(ada), channelID); code(err) != connect.CodePermissionDenied {
		t.Errorf("member uploads: want permission_denied, got %v", err)
	}

	// Admins, the owner, an instance admin and a bot post.
	announcement, err := send(bea, "moving boxes on Saturday", "")
	if err != nil {
		t.Errorf("space admin posts: %v", err)
	}
	for name, ctx := range map[string]context.Context{"owner": owner, "instance admin": operator} {
		if _, err := send(ctx, "hello from "+name, ""); err != nil {
			t.Errorf("%s posts: %v", name, err)
		}
	}
	if _, err := send(hookIdentity(bot, channelID, authctx.MessagesPost), "up again", ""); err != nil {
		t.Errorf("member bot posts through its hook: %v", err)
	}
	if _, err := svc.ChannelSpaceToPostIn(bea, beaID, channelID); err != nil {
		t.Errorf("admin uploads: %v", err)
	}
	// Identity only: a token that grants posting and nothing else.
	beaToken := authctx.WithIdentity(context.Background(), authctx.Identity{
		UserID: beaID, Role: authctx.RoleMember,
		Credential: authctx.Credential{ID: uuid.NewString(), Kind: authctx.CredentialPersonalToken, Grants: []authctx.Action{authctx.MessagesPost}},
	})
	if _, err := send(beaToken, "from a token", ""); err != nil {
		t.Errorf("admin posts with a messages.post token: %v", err)
	}

	if _, err := svc.ToggleReaction(ada, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: announcement.GetId(), Emoji: "👍"})); err != nil {
		t.Errorf("member reacts: %v", err)
	}
	if _, err := svc.DeleteMessage(ada, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: adaOld.Id})); err != nil {
		t.Errorf("member deletes their own: %v", err)
	}

	// Back to everyone.
	if _, err := setPolicy(bea, channelID, chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_EVERYONE); err != nil {
		t.Fatal(err)
	}
	if _, err := send(ada, "thanks", ""); err != nil {
		t.Errorf("member posts once it's everyone again: %v", err)
	}

	// Text channels only, and a real policy.
	voice, err := svc.CreateChannel(owner, connect.NewRequest(&chatv1.CreateChannelRequest{
		SpaceId: spaceID, Name: "standup", Kind: chatv1.ChannelKind_CHANNEL_KIND_VOICE,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := setPolicy(owner, voice.Msg.Channel.Id, chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS); code(err) != connect.CodeInvalidArgument {
		t.Errorf("voice channel: want invalid_argument, got %v", err)
	}
	if _, err := setPolicy(owner, channelID, chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_UNSPECIFIED); code(err) != connect.CodeInvalidArgument {
		t.Errorf("unspecified policy: want invalid_argument, got %v", err)
	}
	dm, err := svc.OpenDirectMessage(owner, connect.NewRequest(&chatv1.OpenDirectMessageRequest{UserIds: []string{beaID}}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := setPolicy(owner, dm.Msg.DirectMessage.Channel.Id, chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_ADMINS); code(err) != connect.CodeInvalidArgument {
		t.Errorf("direct message: want invalid_argument, got %v", err)
	}
	if dm.Msg.DirectMessage.Channel.PostPolicy != chatv1.ChannelPostPolicy_CHANNEL_POST_POLICY_EVERYONE {
		t.Errorf("direct message policy = %v, want everyone", dm.Msg.DirectMessage.Channel.PostPolicy)
	}
}
