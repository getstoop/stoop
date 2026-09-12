import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { canManageChannels } from "../../api/permissions";
import { setMessagePinned, usePins } from "../../api/pins";
import { useMembers, useSpaces } from "../../api/queries";
import { PinIcon } from "../Icons";
import { PinRow } from "./PinRow";

// The pin in a channel header, and the panel it opens: what this channel
// keeps. Every member reads it; whoever manages channels pins and unpins.
// docs/proposals/pinned-messages.md.
export function PinnedMessages({
  spaceId,
  channelId,
}: {
  spaceId: string;
  channelId: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: spaces } = useSpaces();
  const { data: members } = useMembers(spaceId);
  const space = spaces?.find((s) => s.id === spaceId);
  const usernames = new Set(members?.map((m) => m.username.toLowerCase()));
  const manage = !!space && canManageChannels(space);
  const { data: pins, isPending } = usePins(channelId, open);

  // Closing the way the ⋮ menu closes: Escape, a click outside, or a
  // scroll that would leave the panel floating away from its button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    const id = setTimeout(() => window.addEventListener("mousedown", onClick));
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // A new channel is a new list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close when the channel changes
  useEffect(() => setOpen(false), [channelId]);

  return (
    <div ref={ref} className={`pins-anchor ${open ? "open" : ""}`}>
      <button
        type="button"
        className="icon-button pins-button"
        aria-label="Pinned messages"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <PinIcon />
      </button>
      {open && (
        <div className="pins-panel" role="menu">
          <div className="pins-head">
            <span className="pins-title">Pinned messages</span>
            {!!pins?.length && (
              <span className="muted small">{pins.length}</span>
            )}
            <button
              type="button"
              className="chip pins-close"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          <div className="pins-list">
            {isPending ? (
              <p className="pins-empty muted">Loading…</p>
            ) : pins?.length ? (
              pins.map((pin) =>
                pin.message ? (
                  <PinRow
                    key={pin.message.id}
                    pin={pin}
                    usernames={usernames}
                    canUnpin={manage}
                    onOpen={() => {
                      setOpen(false);
                      navigate({
                        to: "/s/$spaceId/c/$channelId",
                        params: { spaceId, channelId },
                        search: { m: pin.message?.id },
                      });
                    }}
                    onUnpin={() =>
                      pin.message &&
                      setMessagePinned(queryClient, pin.message, false)
                    }
                  />
                ) : null,
              )
            ) : (
              <div className="pins-empty">
                <p className="muted">Nothing pinned yet.</p>
                {manage && (
                  <p className="hint">
                    Pin a message from its hover actions to keep it here.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
