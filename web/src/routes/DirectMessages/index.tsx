import { Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { useDirectMessages } from "../../api/dms";
import { closeDrawerOnLink } from "../../components/MenuButton";
import { NewConversation } from "../../components/NewConversation";
import { DMRow } from "./DMRow";

// /dm: the direct-message list in the sidebar slot (so the phone drawer
// works unchanged), the conversation via Outlet. A DM is a channel with
// no space; ChannelView renders it with spaceId "". A conversation with
// more than two people is a group, named after who is in it.
export function DMLayout() {
  const { data: dms } = useDirectMessages();
  const [picking, setPicking] = useState(false);

  return (
    <>
      <aside className="channel-sidebar" onClickCapture={closeDrawerOnLink}>
        <header className="sidebar-header">
          {/* .sidebar-header is a column; the row is what puts the
              control beside the name, as the space sidebar does. */}
          <div className="sidebar-header-row">
            <span className="space-name">Direct messages</span>
            <button
              type="button"
              className="icon-button"
              aria-label="New conversation"
              title="New conversation"
              onClick={() => setPicking(true)}
            >
              +
            </button>
          </div>
        </header>
        <div className="channel-list dm-list">
          {dms?.map(
            (dm) => dm.channel && <DMRow key={dm.channel.id} dm={dm} />,
          )}
          {dms && dms.length === 0 && (
            <p className="muted small dm-empty">
              No conversations yet. Start one with the + above, or click
              someone's name and choose Message.
            </p>
          )}
        </div>
      </aside>
      <Outlet />
      {picking && <NewConversation onClose={() => setPicking(false)} />}
    </>
  );
}
