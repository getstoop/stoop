package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
	"github.com/getstoop/stoop/internal/events"
)

// One message alerting several people: each gets their own mute stamp,
// a blocker gets nothing, and the preview falls back to the attachment.
func TestActivityForSeveralRecipients(t *testing.T) {
	pool, bus, svc := newTestService(t)
	svc.UseFiles(&dbFiles{pool: pool})
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	joinSpace(t, svc, casey, spaceID, ada, bea)
	adaSub := bus.Subscribe("user:" + authctx.UserID(ada))
	defer adaSub.Close()
	beaSub := bus.Subscribe("user:" + authctx.UserID(bea))
	defer beaSub.Close()

	send := func(t *testing.T, who context.Context, req *chatv1.SendMessageRequest) *chatv1.Message {
		t.Helper()
		req.ChannelId = channelID
		res, err := svc.SendMessage(who, connect.NewRequest(req))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message
	}
	unread := func(t *testing.T, who context.Context) int32 {
		t.Helper()
		list, err := svc.ListActivity(who, connect.NewRequest(&chatv1.ListActivityRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		return list.Msg.UnreadCount
	}

	// ada mutes the channel, then bea the space instead.
	if _, err := svc.SetChannelMuted(ada, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: channelID, Muted: true})); err != nil {
		t.Fatal(err)
	}
	sent := send(t, casey, &chatv1.SendMessageRequest{Content: "@everyone game night"})
	adaItem, beaItem := nextActivityItem(t, adaSub).Item, nextActivityItem(t, beaSub).Item
	if !adaItem.Muted || beaItem.Muted {
		t.Errorf("channel mute: ada muted %v, bea muted %v; want true, false", adaItem.Muted, beaItem.Muted)
	}
	for _, item := range []*chatv1.ActivityItem{adaItem, beaItem} {
		if item.Kind != chatv1.ActivityKind_ACTIVITY_KIND_MENTION || item.MessageId != sent.Id ||
			item.Preview != "@everyone game night" || item.Actor.Username != "casey" || item.SpaceId != spaceID {
			t.Errorf("mention item: %+v", item)
		}
	}
	if _, err := svc.SetChannelMuted(ada, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: channelID, Muted: false})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetSpaceMuted(bea, connect.NewRequest(&chatv1.SetSpaceMutedRequest{SpaceId: spaceID, Muted: true})); err != nil {
		t.Fatal(err)
	}
	send(t, casey, &chatv1.SendMessageRequest{Content: "@everyone again"})
	adaItem, beaItem = nextActivityItem(t, adaSub).Item, nextActivityItem(t, beaSub).Item
	if adaItem.Muted || !beaItem.Muted {
		t.Errorf("space mute: ada muted %v, bea muted %v; want false, true", adaItem.Muted, beaItem.Muted)
	}

	// bea blocks casey: an @everyone still reaches ada, and a reply to
	// bea reaches nobody.
	if _, err := svc.BlockUser(bea, connect.NewRequest(&chatv1.BlockUserRequest{UserId: authctx.UserID(casey)})); err != nil {
		t.Fatal(err)
	}
	beaBefore := unread(t, bea)
	send(t, casey, &chatv1.SendMessageRequest{Content: "@everyone third"})
	if item := nextActivityItem(t, adaSub).Item; item.Preview != "@everyone third" {
		t.Errorf("ada after bea's block: %+v", item)
	}
	beaMessage := send(t, bea, &chatv1.SendMessageRequest{Content: "count me out"})
	send(t, casey, &chatv1.SendMessageRequest{Content: "fair", ReplyToMessageId: beaMessage.Id})
	if got := unread(t, bea); got != beaBefore {
		t.Errorf("bea blocked casey but her unread went %d -> %d", beaBefore, got)
	}

	// An attachment-only reply previews the file.
	adaMessage := send(t, ada, &chatv1.SendMessageRequest{Content: "photos?"})
	photo := newFile(t, pool, casey, spaceID, "attachment", "photo.png")
	send(t, casey, &chatv1.SendMessageRequest{ReplyToMessageId: adaMessage.Id, AttachmentIds: []string{photo}})
	if item := nextActivityItem(t, adaSub).Item; item.Kind != chatv1.ActivityKind_ACTIVITY_KIND_REPLY || item.Preview != "📎 photo.png" {
		t.Errorf("attachment-only reply item: kind %v preview %q", item.Kind, item.Preview)
	}
}

// In a group conversation each participant's feed collapses on its own:
// one who has read the entry gets a new one, one who hasn't gets theirs
// refreshed, and both are told live.
func TestGroupDirectMessageActivityPerParticipant(t *testing.T) {
	pool, bus, svc := newTestService(t)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	sp, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	joinSpace(t, svc, casey, sp.Msg.Space.Id, ada, bea)
	group := openDM(t, svc, casey, authctx.UserID(ada), authctx.UserID(bea))
	adaSub := bus.Subscribe("user:" + authctx.UserID(ada))
	defer adaSub.Close()
	beaSub := bus.Subscribe("user:" + authctx.UserID(bea))
	defer beaSub.Close()

	send := func(t *testing.T, content string) string {
		t.Helper()
		res, err := svc.SendMessage(casey, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: group.Channel.Id, Content: content}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message.Id
	}
	feed := func(t *testing.T, who context.Context) *chatv1.ListActivityResponse {
		t.Helper()
		list, err := svc.ListActivity(who, connect.NewRequest(&chatv1.ListActivityRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		return list.Msg
	}

	send(t, "one")
	nextActivityItem(t, adaSub)
	nextActivityItem(t, beaSub)
	if _, err := svc.MarkActivityRead(ada, connect.NewRequest(&chatv1.MarkActivityReadRequest{All: true})); err != nil {
		t.Fatal(err)
	}
	second := send(t, "two")
	for name, sub := range map[string]*events.Subscription{"ada": adaSub, "bea": beaSub} {
		if item := nextActivityItem(t, sub).Item; item.Kind != chatv1.ActivityKind_ACTIVITY_KIND_DM || item.MessageId != second || item.Preview != "two" || item.SpaceId != "" {
			t.Errorf("%s's second event: %+v", name, item)
		}
	}
	if adaFeed := feed(t, ada); len(adaFeed.Items) != 2 || adaFeed.UnreadCount != 1 || adaFeed.Items[0].MessageId != second {
		t.Errorf("ada read the first: want a new entry beside it, got %d items, %d unread", len(adaFeed.Items), adaFeed.UnreadCount)
	}
	if beaFeed := feed(t, bea); len(beaFeed.Items) != 1 || beaFeed.UnreadCount != 1 || beaFeed.Items[0].MessageId != second {
		t.Errorf("bea had not read: want her one entry refreshed, got %d items, %d unread", len(beaFeed.Items), beaFeed.UnreadCount)
	}
}

// Someone no longer in the space is told nothing when their old message
// is quoted, whether they left, were kicked or were banned (STOOP-438):
// the quote would hand them the new message's text.
func TestQuotingAFormerMemberTellsThemNothing(t *testing.T) {
	pool, _, svc := newTestService(t)
	casey := newUser(t, pool, "casey", authctx.RoleMember)
	ada := newUser(t, pool, "ada", authctx.RoleMember)
	bea := newUser(t, pool, "bea", authctx.RoleMember)
	dot := newUser(t, pool, "dot", authctx.RoleMember)
	sp, err := svc.CreateSpace(casey, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Porch"}))
	if err != nil {
		t.Fatal(err)
	}
	spaceID, channelID := sp.Msg.Space.Id, sp.Msg.DefaultChannel.Id
	joinSpace(t, svc, casey, spaceID, ada, bea, dot)
	send := func(who context.Context, content, replyTo string) string {
		t.Helper()
		res, err := svc.SendMessage(who, connect.NewRequest(&chatv1.SendMessageRequest{
			ChannelId: channelID, Content: content, ReplyToMessageId: replyTo,
		}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Message.Id
	}
	items := func(who context.Context) int {
		t.Helper()
		res, err := svc.ListActivity(who, connect.NewRequest(&chatv1.ListActivityRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		return len(res.Msg.Items)
	}

	adaOld := send(ada, "the ladder is in my garage", "")
	beaOld := send(bea, "I'll water the beds", "")
	dotOld := send(dot, "seedlings are on the step", "")
	if _, err := svc.LeaveSpace(ada, connect.NewRequest(&chatv1.LeaveSpaceRequest{SpaceId: spaceID})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.KickMember(casey, connect.NewRequest(&chatv1.KickMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(bea)})); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.BanMember(casey, connect.NewRequest(&chatv1.BanMemberRequest{SpaceId: spaceID, UserId: authctx.UserID(dot)})); err != nil {
		t.Fatal(err)
	}

	for name, former := range map[string]struct {
		who      context.Context
		original string
	}{"ada (left)": {ada, adaOld}, "bea (kicked)": {bea, beaOld}, "dot (banned)": {dot, dotOld}} {
		before := items(former.who)
		send(casey, "quoting you after you went", former.original)
		if after := items(former.who); after != before {
			t.Errorf("%s got %d activity items for a quote of their old message", name, after-before)
		}
	}
}
