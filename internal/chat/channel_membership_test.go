package chat_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

func (f fixture) join(t *testing.T, ctx context.Context, channelID string) {
	t.Helper()
	if _, err := f.svc.JoinChannel(ctx, connect.NewRequest(&chatv1.JoinChannelRequest{ChannelId: channelID})); err != nil {
		t.Fatal(err)
	}
}

func (f fixture) leave(t *testing.T, ctx context.Context, channelID string) {
	t.Helper()
	if _, err := f.svc.LeaveChannel(ctx, connect.NewRequest(&chatv1.LeaveChannelRequest{ChannelId: channelID})); err != nil {
		t.Fatal(err)
	}
}

func (f fixture) send(t *testing.T, ctx context.Context, req *chatv1.SendMessageRequest) *chatv1.Message {
	t.Helper()
	res, err := f.svc.SendMessage(ctx, connect.NewRequest(req))
	if err != nil {
		t.Fatal(err)
	}
	return res.Msg.Message
}

func (f fixture) unreadActivity(t *testing.T, ctx context.Context) int32 {
	t.Helper()
	res, err := f.svc.ListActivity(ctx, connect.NewRequest(&chatv1.ListActivityRequest{}))
	if err != nil {
		t.Fatal(err)
	}
	return res.Msg.UnreadCount
}

// Someone in the space but not in a text channel reads it, searches it
// and deletes what they wrote there, and writes nothing until they join.
func TestWritingNeedsTheChannel(t *testing.T) {
	space := newFixture(t)
	garden := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "garden"})
	space.join(t, space.member, garden.Id)
	theirs := space.send(t, space.member, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "tomatoes are in"})
	owners := space.send(t, space.owner, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "rota is up"})
	space.leave(t, space.member, garden.Id)

	writes := map[string]func() error{
		"send": func() error {
			_, err := space.svc.SendMessage(space.member, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "one more thing"}))
			return err
		},
		"edit": func() error {
			_, err := space.svc.EditMessage(space.member, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: theirs.Id, Content: "rewritten"}))
			return err
		},
		"react": func() error {
			_, err := space.svc.ToggleReaction(space.member, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: owners.Id, Emoji: "👍"}))
			return err
		},
		"upload": func() error {
			_, err := space.svc.ChannelSpaceToPostIn(space.member, authctx.UserID(space.member), garden.Id)
			return err
		},
	}
	for name, write := range writes {
		if err := write(); code(err) != connect.CodeFailedPrecondition {
			t.Errorf("%s from outside the channel: code = %v, want FailedPrecondition", name, code(err))
		}
	}

	history, err := space.svc.ListMessages(space.member, connect.NewRequest(&chatv1.ListMessagesRequest{ChannelId: garden.Id}))
	if err != nil || len(history.Msg.Messages) != 2 {
		t.Errorf("reading from outside the channel: %d messages, err %v, want 2", len(history.Msg.Messages), err)
	}
	found, err := space.svc.SearchMessages(space.member, connect.NewRequest(&chatv1.SearchMessagesRequest{
		Scope: &chatv1.SearchMessagesRequest_SpaceId{SpaceId: space.spaceID}, Query: "rota",
	}))
	if err != nil || len(found.Msg.Messages) != 1 {
		t.Errorf("searching from outside the channel: %d results, err %v, want 1", len(found.Msg.Messages), err)
	}
	if _, err := space.svc.DeleteMessage(space.member, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: theirs.Id})); err != nil {
		t.Errorf("deleting your own message from outside the channel: %v", err)
	}

	space.join(t, space.member, garden.Id)
	for name, write := range map[string]func() error{"send": writes["send"], "react": writes["react"]} {
		if err := write(); err != nil {
			t.Errorf("%s after joining: %v", name, err)
		}
	}
}

// Only channels a person is in can be unread for them.
func TestUnreadFollowsTheChannelsYouAreIn(t *testing.T) {
	space := newFixture(t)
	garden := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "garden"})
	space.send(t, space.owner, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "rota is up"})

	spaceUnread := func() bool {
		t.Helper()
		res, err := space.svc.ListSpaces(space.member, connect.NewRequest(&chatv1.ListSpacesRequest{}))
		if err != nil {
			t.Fatal(err)
		}
		return res.Msg.Spaces[0].HasUnread
	}
	if listed := space.listed(t, space.member, garden.Id); listed.UnreadCount != 0 {
		t.Errorf("a channel they are not in shows %d unread, want 0", listed.UnreadCount)
	}
	if spaceUnread() {
		t.Error("the space is unread for a message in a channel they are not in")
	}

	space.join(t, space.member, garden.Id)
	space.send(t, space.owner, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "bring gloves"})
	if listed := space.listed(t, space.member, garden.Id); listed.UnreadCount != 1 {
		t.Errorf("after joining, one new message shows %d unread, want 1", listed.UnreadCount)
	}
	if !spaceUnread() {
		t.Error("the space is not unread for a message in a channel they are in")
	}
}

// Leaving a channel stops what it would have told you: a reply to your
// message and a reply in a thread you were in raise nothing. It also
// takes your mute off the channel.
func TestLeavingAChannelStopsItsActivity(t *testing.T) {
	space := newFixture(t)
	garden := space.newChannel(t, &chatv1.CreateChannelRequest{Name: "garden"})
	space.join(t, space.member, garden.Id)
	space.join(t, space.other, garden.Id)
	root := space.send(t, space.owner, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "who has the hose key"})
	theirs := space.send(t, space.member, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "on the hook"})
	space.send(t, space.member, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "by the door", ThreadRootId: root.Id})
	if _, err := space.svc.SetChannelMuted(space.member, connect.NewRequest(&chatv1.SetChannelMutedRequest{ChannelId: garden.Id, Muted: true})); err != nil {
		t.Fatal(err)
	}

	// While they are in the channel, both reach them.
	space.send(t, space.other, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "found it", ReplyToMessageId: theirs.Id})
	space.send(t, space.other, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "thanks", ThreadRootId: root.Id})
	if unread := space.unreadActivity(t, space.member); unread != 2 {
		t.Fatalf("unread activity while in the channel = %d, want 2", unread)
	}
	// Read, so a later thread reply would start a new item, not refresh one.
	if _, err := space.svc.MarkActivityRead(space.member, connect.NewRequest(&chatv1.MarkActivityReadRequest{All: true})); err != nil {
		t.Fatal(err)
	}

	space.leave(t, space.member, garden.Id)
	if listed := space.listed(t, space.member, garden.Id); listed.Muted {
		t.Error("the channel is still muted after leaving it")
	}
	space.send(t, space.other, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "found it again", ReplyToMessageId: theirs.Id})
	space.send(t, space.other, &chatv1.SendMessageRequest{ChannelId: garden.Id, Content: "thanks again", ThreadRootId: root.Id})
	if unread := space.unreadActivity(t, space.member); unread != 0 {
		t.Errorf("unread activity after leaving = %d, want 0", unread)
	}
}
