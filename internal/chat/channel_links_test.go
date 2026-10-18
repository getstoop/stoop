package chat_test

import (
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
)

func channelLink(id, name string) string {
	return "<#" + id + ":" + name + ">"
}

func (f groupFixture) newChannel(t *testing.T, spaceID, name string, kind chatv1.ChannelKind) string {
	t.Helper()
	res, err := f.svc.CreateChannel(f.owner, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: spaceID, Name: name, Kind: kind}))
	if err != nil {
		t.Fatal(err)
	}
	return res.Msg.Channel.Id
}

// A link to a public text channel of the space is kept with its current
// name; any other is saved as #name text, so a private channel's ID never
// reaches a reader who can't open it.
func TestChannelLinksAreChecked(t *testing.T) {
	fixture := newGroupFixture(t)
	gardenID := fixture.newChannel(t, fixture.spaceID, "garden", chatv1.ChannelKind_CHANNEL_KIND_TEXT)
	voiceID := fixture.newChannel(t, fixture.spaceID, "porch", chatv1.ChannelKind_CHANNEL_KIND_VOICE)
	legacyID := fixture.newChannel(t, fixture.spaceID, "lounge", chatv1.ChannelKind_CHANNEL_KIND_TEXT)
	fixture.exec(t, "UPDATE channels SET name = 'The Lounge' WHERE id = $1", legacyID)
	other, err := fixture.svc.CreateSpace(fixture.owner, connect.NewRequest(&chatv1.CreateSpaceRequest{Name: "Yard"}))
	if err != nil {
		t.Fatal(err)
	}

	written := channelLink(gardenID, "wrong") + " " + channelLink(fixture.secretID, "secret") + " " +
		channelLink(voiceID, "porch") + " " + channelLink(legacyID, "lounge") + " " +
		channelLink(other.Msg.DefaultChannel.Id, "general") + " " + channelLink("0192f3a4-7b1c-7d2e-9f00-3c4d5e6f7a8c", "gone")
	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, written)
	want := channelLink(gardenID, "garden") + " #secret #porch #lounge #general #gone"
	if stored := fixture.storedContent(t, sent.Id); stored != want {
		t.Errorf("stored content = %q, want %q", stored, want)
	}

	// From a private channel, even a public channel's link is text.
	inSecret := fixture.sendTo(t, fixture.bea, fixture.secretID, "see "+channelLink(gardenID, "garden"))
	if stored := fixture.storedContent(t, inSecret.Id); stored != "see #garden" {
		t.Errorf("link from a private channel stored as %q", stored)
	}
}

// Previews read a link as the channel's current name, or its saved one
// once the channel is gone; content keeps the token as stored.
func TestChannelLinksPreviewsFollowRenames(t *testing.T) {
	fixture := newGroupFixture(t)
	gardenID := fixture.newChannel(t, fixture.spaceID, "garden", chatv1.ChannelKind_CHANNEL_KIND_TEXT)
	sent := fixture.sendTo(t, fixture.owner, fixture.generalID, "see "+channelLink(gardenID, "garden"))
	quote, err := fixture.svc.SendMessage(fixture.cal, connect.NewRequest(&chatv1.SendMessageRequest{
		ChannelId: fixture.generalID, Content: "ok", ReplyToMessageId: sent.Id,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if preview := quote.Msg.Message.ReplyTo.Preview; preview != "see #garden" {
		t.Errorf("reply quote on send = %q", preview)
	}

	fixture.exec(t, "UPDATE channels SET name = 'the-garden' WHERE id = $1", gardenID)
	history := fixture.history(t, fixture.cal)
	if got := history[quote.Msg.Message.Id].ReplyTo.Preview; got != "see #the-garden" {
		t.Errorf("after the rename the reply quotes %q", got)
	}
	if got := history[sent.Id].Content; got != "see "+channelLink(gardenID, "garden") {
		t.Errorf("content after the rename = %q, want the token as stored", got)
	}

	fixture.exec(t, "DELETE FROM channels WHERE id = $1", gardenID)
	if got := fixture.history(t, fixture.cal)[quote.Msg.Message.Id].ReplyTo.Preview; got != "see #garden" {
		t.Errorf("after the channel's deletion the reply quotes %q", got)
	}
}
