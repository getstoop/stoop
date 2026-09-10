import { useEffect, useRef } from "react";
import { openLinkForPath, underAutomation } from "../api/desktopLinks";
import type { SharedLinkKind } from "../api/shareLinks";

// What a shared link says it is. Never the name of the space, channel or
// person it leads to: nothing has been looked up at this point, and a DM
// link names a conversation only its participants may see.
const SUBTITLE: Record<Exclude<SharedLinkKind, "">, string> = {
  invite: "You've been invited to a space on someone's stoop.",
  message: "Someone shared a message with you on a stoop.",
  channel: "Someone shared a conversation with you on a stoop.",
  space: "Someone shared a space with you on a stoop.",
};

// What a shared link lands on in a browser: the app, or here. It does
// nothing with the link — the path is a string on its way somewhere else
// — so it never redeems an invite or marks a channel read, and a dead
// link still fails where it always did, on the page that handles it.
// docs/architecture/desktop.md → Deep links.
export function LinkHandoff({
  path,
  kind,
  onContinue,
}: {
  path: string;
  kind: Exclude<SharedLinkKind, "">;
  onContinue: () => void;
}) {
  const link = openLinkForPath(path);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || underAutomation()) return;
    fired.current = true;
    location.href = link;
  }, [link]);

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Stoop</h1>
        <p className="login-subtitle">{SUBTITLE[kind]}</p>
        <div className="open-in-app">
          <p className="muted">Opening Stoop…</p>
          <a className="provider-button" href={link}>
            Open in the Stoop app
          </a>
          <button type="button" className="link" onClick={onContinue}>
            Continue in this browser
          </button>
        </div>
      </div>
    </div>
  );
}
