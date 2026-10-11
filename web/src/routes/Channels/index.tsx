import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useChannels, useSpaces } from "../../api/queries";
import { SearchIcon } from "../../components/Icons";
import { Input } from "../../components/Input";
import { MenuButton } from "../../components/MenuButton";
import { ChannelKind } from "../../gen/stoop/chat/v1/channel_pb";
import { BrowserRow } from "./BrowserRow";

// Every text channel in the space, joined or not: the way to find a
// channel and join it.
export function ChannelsPage() {
  const { spaceId } = useParams({ strict: false }) as { spaceId: string };
  const { data: spaces } = useSpaces();
  const { data: channels } = useChannels(spaceId);
  const [filter, setFilter] = useState("");
  const space = spaces?.find((s) => s.id === spaceId);
  const wanted = filter.trim().toLowerCase();
  const shown = (channels ?? []).filter(
    (channel) =>
      channel.kind === ChannelKind.TEXT &&
      (channel.name.toLowerCase().includes(wanted) ||
        channel.topic.toLowerCase().includes(wanted)),
  );

  return (
    <main className="channel-browser">
      <header className="channel-header">
        <MenuButton />
        <span className="channel-title">Channels in {space?.name ?? "…"}</span>
      </header>
      <div className="channel-browser-scroll">
        <Input
          className="channel-browser-find"
          start={<SearchIcon />}
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Find a channel"
          aria-label="Find a channel"
        />
        {channels && shown.length === 0 ? (
          <p className="empty-state">No channel matches.</p>
        ) : (
          <ul className="channel-browser-list">
            {shown.map((channel) => (
              <BrowserRow key={channel.id} channel={channel} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
