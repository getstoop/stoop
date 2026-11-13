import { parseInviteLink } from "../../api/invites";

// What the Invite link field of Add a space holds, going by the server
// the sheet was opened on: nothing, something that isn't an invite
// link, a link to this server (its code), or a link to another one.
// Servers are told apart by their exact address, as everywhere a link
// is matched to a saved server.
export type Pasted =
  | { kind: "empty" }
  | { kind: "not-link" }
  | { kind: "here"; code: string }
  | { kind: "elsewhere"; origin: string };

export function pasted(text: string, serverOrigin: string): Pasted {
  if (!text.trim()) return { kind: "empty" };
  const link = parseInviteLink(text);
  if (!link) return { kind: "not-link" };
  return link.origin === serverOrigin ? { kind: "here", code: link.code } : { kind: "elsewhere", origin: link.origin };
}
