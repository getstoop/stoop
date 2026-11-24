-- Polls. Owned by the chat module.
-- Only internal/chat may use these queries.
--
-- A poll is a messages row (kind 7) and reaches a client like any other
-- (messages.sql); these are its votes. internal/chat/polls.go.

-- ListPollVotesForMessages feeds one pass per page, as
-- ListReactionsForMessages does: each poll's votes by option, in the
-- order they were cast.
-- name: ListPollVotesForMessages :many
SELECT message_id, user_id, option_id, created_at
FROM poll_votes
WHERE message_id = ANY(sqlc.arg(message_ids)::uuid[])
ORDER BY message_id, option_id, created_at, user_id;

-- RemovePollVotesExcept takes back every option a person chose on a poll
-- but those in kept: the first half of setting a selection. An empty
-- kept takes the whole vote back.
-- name: RemovePollVotesExcept :execrows
DELETE FROM poll_votes
WHERE message_id = sqlc.arg(message_id)::uuid AND user_id = sqlc.arg(user_id)::uuid
  AND NOT (option_id = ANY(sqlc.arg(kept)::smallint[]));

-- AddPollVotes is the second half: the options chosen that the person
-- had not chosen already. The time is the clock's, not the
-- transaction's start: the caller holds the channel row, so votes are
-- ordered as they were let in.
-- name: AddPollVotes :execrows
INSERT INTO poll_votes (message_id, user_id, option_id, created_at)
SELECT sqlc.arg(message_id)::uuid, sqlc.arg(user_id)::uuid, option_id, clock_timestamp()
FROM unnest(sqlc.arg(option_ids)::smallint[]) AS chosen(option_id)
ON CONFLICT DO NOTHING;

-- ClosePoll writes a poll's data with its closed state in it. Only a
-- live poll takes it; no row means it was deleted meanwhile.
-- name: ClosePoll :execrows
UPDATE messages SET data = sqlc.arg(data)
WHERE id = sqlc.arg(id)::uuid AND kind = 7 AND deleted_at IS NULL;
