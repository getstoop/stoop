package chat_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// @channel and @here reach the people in the channel, not the space.
func TestChannelAndHereReachTheChannel(t *testing.T) {
	space := newFixture(t)
	garden := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "garden"})
	space.join(t, space.member, garden.Id)
	space.join(t, space.admin, garden.Id)
	// Everyone but the admin is online; "other" is not in the channel.
	space.svc.UsePresence(fakePresence{authctx.UserID(space.owner), authctx.UserID(space.member), authctx.UserID(space.other)})

	loud := space.send(t, space.owner, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "@channel seedlings on Saturday"})
	slices.Sort(loud.MentionUserIds)
	want := []string{authctx.UserID(space.admin), authctx.UserID(space.member)}
	slices.Sort(want)
	if !loud.MentionsChannel || loud.MentionsEveryone || !slices.Equal(loud.MentionUserIds, want) {
		t.Errorf("@channel: channel = %v, everyone = %v, reached %v, want the two others in the channel", loud.MentionsChannel, loud.MentionsEveryone, loud.MentionUserIds)
	}
	here := space.send(t, space.owner, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "@here quick one"})
	if !here.MentionsHere || len(here.MentionUserIds) != 1 || here.MentionUserIds[0] != authctx.UserID(space.member) {
		t.Errorf("@here reached %v, want only the member, who is in the channel and online", here.MentionUserIds)
	}
	if unread := space.unreadActivity(t, space.other); unread != 0 {
		t.Errorf("someone outside the channel has %d unread, want 0", unread)
	}
	if names := space.memberNames(t, garden.Id); len(names) != 3 {
		t.Errorf("members after @channel = %v, want it to bring nobody in", names)
	}

	// @everyone is words now, for an admin too.
	plain := space.send(t, space.owner, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "@everyone hello"})
	if plain.MentionsEveryone || plain.MentionsChannel || len(plain.MentionUserIds) != 0 {
		t.Errorf("@everyone: %+v, want plain text", plain)
	}
	// A member may not use @channel, and it stays words.
	quiet := space.send(t, space.member, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "@channel please"})
	if quiet.MentionsChannel || len(quiet.MentionUserIds) != 0 {
		t.Errorf("a member's @channel: %+v, want plain text", quiet)
	}
	// A name beside @channel still reaches, and brings in, that person.
	both := space.send(t, space.owner, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "@channel and @other too"})
	if !both.MentionsChannel || !slices.Contains(both.MentionUserIds, authctx.UserID(space.other)) || len(both.MentionUserIds) != 3 {
		t.Errorf("@channel with a name reached %v, want the channel and the named person", both.MentionUserIds)
	}
	if names := space.memberNames(t, garden.Id); !slices.Contains(names, "other") {
		t.Errorf("members = %v, want the named person brought in", names)
	}
}

// Mentioning someone who is in the space but not the channel brings them
// in, with the channel unread from that message on.
func TestAMentionBringsSomeoneIntoTheChannel(t *testing.T) {
	space := newFixture(t)
	garden := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "garden"})
	space.join(t, space.member, garden.Id)
	space.send(t, space.owner, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "rota is up"})
	space.send(t, space.owner, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "bring gloves"})

	sub := space.bus.Subscribe("space:" + space.spaceID)
	defer sub.Close()
	personal := space.bus.Subscribe("user:" + authctx.UserID(space.other))
	defer personal.Close()
	sent := space.send(t, space.member, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "@other can you water on Tuesday?"})

	if created := (<-sub.Events()).GetMessageCreated(); created == nil || created.Id != sent.Id {
		t.Fatal("expected MessageCreated first")
	}
	if joined := (<-sub.Events()).GetChannelMemberJoined(); joined == nil || joined.ChannelId != garden.Id || joined.UserId != authctx.UserID(space.other) {
		t.Fatal("expected ChannelMemberJoined for the mentioned person")
	}
	if item := (<-personal.Events()).GetActivityItemCreated(); item == nil || item.Item.MessageId != sent.Id {
		t.Fatal("expected the mention to reach their activity")
	}
	// Two older messages are behind their marker; the mention is not.
	listed := space.listed(t, space.other, garden.Id)
	if !listed.Joined || listed.UnreadCount != 1 {
		t.Errorf("for the mentioned person: joined = %v, unread = %d, want true and 1", listed.Joined, listed.UnreadCount)
	}
	// They are in it now and can answer.
	space.send(t, space.other, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "yes"})

	// Mentioning someone already in the channel tells nobody they joined.
	space.send(t, space.owner, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "thanks @other"})
	if created := (<-sub.Events()).GetMessageCreated(); created == nil {
		t.Fatal("expected their own message")
	}
	if created := (<-sub.Events()).GetMessageCreated(); created == nil {
		t.Fatal("expected MessageCreated with no join before it")
	}
}

// A mention does not bring in someone who blocked the author, and an edit
// brings in nobody.
func TestMentionsThatBringNobodyIn(t *testing.T) {
	space := newFixture(t)
	garden := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "garden"})
	space.join(t, space.member, garden.Id)

	if _, err := space.svc.BlockUser(space.other, connect.NewRequest(&chatv1.BlockUserRequest{UserId: authctx.UserID(space.member)})); err != nil {
		t.Fatal(err)
	}
	space.send(t, space.member, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "@other hello"})
	if names := space.memberNames(t, garden.Id); slices.Contains(names, "other") {
		t.Errorf("members = %v: a mention brought in someone who blocked its author", names)
	}

	plain := space.send(t, space.member, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "hello admin"})
	if _, err := space.svc.EditMessage(space.member, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: plain.Id, Content: "hello @admin"})); err != nil {
		t.Fatal(err)
	}
	if names := space.memberNames(t, garden.Id); slices.Contains(names, "admin") {
		t.Errorf("members = %v: an edit brought someone in", names)
	}
}
