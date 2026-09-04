import { useNavigate } from "@tanstack/react-router";
import { markWelcomeSeen } from "../api/welcome";
import type { Channel } from "../gen/stoop/chat/v1/channel_pb";
import type { Space } from "../gen/stoop/chat/v1/space_pb";
import { SpaceIcon } from "./SpaceIcon";
import { WelcomeText } from "./WelcomeText";

// The greeting a space gives someone who has just walked in, shown in
// place of the redirect to the first channel. A pane, not a modal: the
// rail and the channel list stay live behind it, so it reads as a room
// you are standing in rather than something in your way. It is offered
// once — after that the same text is under About this space.
export function SpaceWelcome({
  space,
  channel,
}: {
  space: Space;
  channel?: Channel;
}) {
  const navigate = useNavigate();
  const enter = () => {
    markWelcomeSeen(space.id, space.welcome);
    if (channel) {
      navigate({
        to: "/s/$spaceId/c/$channelId",
        params: { spaceId: space.id, channelId: channel.id },
        replace: true,
      });
    }
  };
  return (
    <main className="space-welcome">
      <div className="space-welcome-card">
        <header className="space-welcome-head">
          <span className="space-pill static" aria-hidden="true">
            <SpaceIcon name={space.name} fileId={space.iconFileId} />
          </span>
          <div>
            <strong>{space.name}</strong>
            {space.description && <p className="muted">{space.description}</p>}
          </div>
        </header>
        <hr className="about-rule" />
        <WelcomeText text={space.welcome} />
        <div className="space-welcome-actions">
          <button type="button" className="primary" onClick={enter}>
            {channel ? `Go to #${channel.name}` : "Continue"}
          </button>
        </div>
      </div>
    </main>
  );
}
