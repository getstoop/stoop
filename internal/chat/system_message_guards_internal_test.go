package chat

import (
	"context"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/getstoop/stoop/gen/stoop/chat/v1"
	"github.com/getstoop/stoop/internal/authctx"
)

// The guards (docs/architecture/messaging.md → System messages): a system
// row refuses everything that assumes a person wrote it, and only
// moderation deletes one.

// guardedWrites is every write a system row refuses, as its author.
func (f *systemRows) guardedWrites(author context.Context, messageID string) map[string]error {
	svc := f.svc
	_, edit := svc.EditMessage(author, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: messageID, Content: "rewritten"}))
	_, react := svc.ToggleReaction(author, connect.NewRequest(&chatv1.ToggleReactionRequest{MessageId: messageID, Emoji: "👍"}))
	_, thread := svc.SendMessage(author, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: f.channel.ID, Content: "in a thread", ThreadRootId: messageID}))
	_, quote := svc.SendMessage(author, connect.NewRequest(&chatv1.SendMessageRequest{ChannelId: f.channel.ID, Content: "quoting", ReplyToMessageId: messageID}))
	_, mute := svc.SetThreadMuted(author, connect.NewRequest(&chatv1.SetThreadMutedRequest{MessageId: messageID, Muted: true}))
	_, read := svc.MarkThreadRead(author, connect.NewRequest(&chatv1.MarkThreadReadRequest{MessageId: messageID}))
	_, pin := svc.SetMessagePinned(author, connect.NewRequest(&chatv1.SetMessagePinnedRequest{MessageId: messageID, Pinned: true}))
	_, dismiss := svc.DismissLinkPreview(author, connect.NewRequest(&chatv1.DismissLinkPreviewRequest{MessageId: messageID, Url: "https://example.com/"}))
	_, deleteThread := svc.DeleteThread(author, connect.NewRequest(&chatv1.DeleteThreadRequest{MessageId: messageID}))
	return map[string]error{
		"edit": edit, "react": react, "start a thread": thread, "quote": quote,
		"mute its thread": mute, "mark its thread read": read, "pin": pin,
		"dismiss a preview": dismiss, "delete its thread": deleteThread,
	}
}

// Every kind refuses every write, asked by its author, who owns the space
// and so passes every permission on the way: what refuses is the kind.
// The row is untouched afterwards.
func TestSystemRowRefusesWhatAPersonWrote(t *testing.T) {
	fixture := newSystemRows(t)
	about := fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "house rules"})
	for _, event := range everyKind(authctx.UserID(fixture.bea), about.Id) {
		row := fixture.record(fixture.ada, fixture.channel, event)
		for write, err := range fixture.guardedWrites(fixture.ada, row.ID) {
			if connect.CodeOf(err) != connect.CodeFailedPrecondition || !errors.Is(err, errSystemMessage) {
				t.Errorf("kind %d, %s: err = %v, want the system-message refusal", event.kind(), write, err)
			}
		}
		// Anyone else is refused as for another person's message, before
		// learning what the row is.
		if _, err := fixture.svc.EditMessage(fixture.bea, connect.NewRequest(&chatv1.EditMessageRequest{MessageId: row.ID, Content: "rewritten"})); connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Errorf("kind %d, edit by someone else: err = %v, want PermissionDenied", event.kind(), err)
		}
		message := fixture.load(row.ID)
		if message.Deleted || message.Pinned || len(message.Reactions) > 0 || message.Thread != nil ||
			message.EditedAt != nil || message.Content != "" {
			t.Errorf("kind %d: row after the refusals = %v, want it as it was", event.kind(), message)
		}
	}
	// Nothing was sent by the refused sends.
	for _, message := range fixture.listed(fixture.ada) {
		if message.Content == "in a thread" || message.Content == "quoting" {
			t.Errorf("a refused send was stored: %v", message)
		}
	}
}

// The same writes on a message someone wrote go through as before.
func TestOrdinaryMessagePassesTheGuards(t *testing.T) {
	fixture := newSystemRows(t)
	message := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "house rules"})
	for write, err := range fixture.guardedWrites(fixture.ada, message.Id) {
		switch {
		case write == "dismiss a preview":
			// The message has no preview for that link, and says so.
			if connect.CodeOf(err) != connect.CodeNotFound {
				t.Errorf("%s: err = %v, want NotFound for a link it does not have", write, err)
			}
		case err != nil:
			t.Errorf("%s: err = %v", write, err)
		}
	}
	if !fixture.load(message.Id).Deleted {
		t.Error("deleting the thread left its root")
	}
}

// Only messages.moderate deletes a system row, in a private channel only
// from inside it. Being its author grants nothing either way: a member
// can't delete a row they caused, and an admin can.
func TestSystemRowDeleteIsModeration(t *testing.T) {
	fixture := newSystemRows(t)
	svc := fixture.svc
	if _, err := svc.SetMemberRole(fixture.ada, connect.NewRequest(&chatv1.SetMemberRoleRequest{
		SpaceId: fixture.spaceID, UserId: authctx.UserID(fixture.bea), Role: chatv1.SpaceRole_SPACE_ROLE_ADMIN,
	})); err != nil {
		t.Fatal(err)
	}
	remove := func(person context.Context, messageID string) error {
		_, err := svc.DeleteMessage(person, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: messageID}))
		return err
	}
	topic := topicChanged{Topic: "Friday nights"}

	byMember := fixture.record(fixture.cat, fixture.channel, topic)
	if err := remove(fixture.cat, byMember.ID); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member deleting a row they caused: err = %v, want PermissionDenied", err)
	}
	if fixture.load(byMember.ID).Deleted {
		t.Fatal("the member's refused delete went through")
	}
	if err := remove(fixture.bea, byMember.ID); err != nil {
		t.Errorf("an admin deleting a member's row: %v", err)
	}
	byAdmin := fixture.record(fixture.bea, fixture.channel, topic)
	if err := remove(fixture.bea, byAdmin.ID); err != nil {
		t.Errorf("an admin deleting a row they caused: %v", err)
	}
	byOwner := fixture.record(fixture.ada, fixture.channel, topic)
	if err := remove(fixture.ada, byOwner.ID); err != nil {
		t.Errorf("the owner deleting a row they caused: %v", err)
	}

	// A private channel bea, an admin, is not in.
	created, err := svc.CreateChannel(fixture.ada, connect.NewRequest(&chatv1.CreateChannelRequest{SpaceId: fixture.spaceID, Name: "back-room", Private: true}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AddChannelMembers(fixture.ada, connect.NewRequest(&chatv1.AddChannelMembersRequest{
		ChannelId: created.Msg.Channel.Id, UserIds: []string{authctx.UserID(fixture.cat)},
	})); err != nil {
		t.Fatal(err)
	}
	private := fixture.channelRow(created.Msg.Channel.Id)
	inPrivate := fixture.record(fixture.cat, private, topic)
	if err := remove(fixture.bea, inPrivate.ID); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("an admin outside the private channel: err = %v, want NotFound", err)
	}
	if err := remove(fixture.cat, inPrivate.ID); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member inside the private channel: err = %v, want PermissionDenied", err)
	}
	if err := remove(fixture.ada, inPrivate.ID); err != nil {
		t.Errorf("the owner inside the private channel: %v", err)
	}

	// A member's own message is still theirs to delete.
	own := fixture.send(fixture.cat, &chatv1.SendMessageRequest{Content: "oops"})
	if err := remove(fixture.cat, own.Id); err != nil {
		t.Errorf("a member deleting their own message: %v", err)
	}
	if err := remove(fixture.cat, fixture.send(fixture.bea, &chatv1.SendMessageRequest{Content: "not yours"}).Id); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("a member deleting someone else's message: err = %v, want PermissionDenied", err)
	}
}

// A deleted system row keeps its kind and place in the log but nothing of
// its event: data is an empty object, the reference is gone, and neither
// history nor ListChanges carries the text it held.
func TestDeletedSystemRowCarriesNoEvent(t *testing.T) {
	fixture := newSystemRows(t)
	ctx := context.Background()
	about := fixture.send(fixture.ada, &chatv1.SendMessageRequest{Content: "house rules"})
	rows := []messageRow{
		fixture.record(fixture.ada, fixture.channel, topicChanged{Topic: "secret plans"}),
		fixture.record(fixture.ada, fixture.channel, channelRenamed{OldName: "secret-old", NewName: "secret-new"}),
		fixture.record(fixture.ada, fixture.channel, membersAdded{UserIDs: []string{authctx.UserID(fixture.bea)}}),
		fixture.record(fixture.ada, fixture.channel, messagePinned{MessageID: about.Id}),
	}
	since := about.Seq
	for _, row := range rows {
		if _, err := fixture.svc.DeleteMessage(fixture.ada, connect.NewRequest(&chatv1.DeleteMessageRequest{MessageId: row.ID})); err != nil {
			t.Fatal(err)
		}
		var (
			kind      int16
			data      string
			reference *string
			deleted   bool
		)
		if err := fixture.pool.QueryRow(ctx,
			`SELECT kind, data::text, reference_message_id::text, deleted_at IS NOT NULL FROM messages WHERE id = $1`, row.ID).
			Scan(&kind, &data, &reference, &deleted); err != nil {
			t.Fatal(err)
		}
		if kind != row.Kind || data != "{}" || reference != nil || !deleted {
			t.Errorf("deleted kind %d row = kind %d data %s reference %v deleted %v, want its kind, {} and no reference",
				row.Kind, kind, data, reference, deleted)
		}
	}
	for _, message := range fixture.listed(fixture.bea) {
		if message.Event != nil {
			t.Errorf("history shows a deleted system row: %v", message)
		}
	}
	changes, err := fixture.svc.ListChanges(fixture.bea, connect.NewRequest(&chatv1.ListChangesRequest{ChannelId: fixture.channel.ID, SinceSeq: since}))
	if err != nil {
		t.Fatal(err)
	}
	if len(changes.Msg.Messages) != len(rows) {
		t.Fatalf("ListChanges carried %d rows, want the %d deletes", len(changes.Msg.Messages), len(rows))
	}
	for _, message := range changes.Msg.Messages {
		if !message.Deleted || message.Reference != nil || strings.Contains(message.String(), "secret") ||
			len(message.Event.GetMembersAdded().GetMembers()) > 0 {
			t.Errorf("ListChanges carries a deleted system row's event: %v", message)
		}
	}
	// The pinned message itself is untouched.
	if pinned := fixture.load(about.Id); pinned.Deleted || pinned.Content != "house rules" {
		t.Errorf("deleting the pin row changed its message: %v", pinned)
	}
}
