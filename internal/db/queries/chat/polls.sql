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
