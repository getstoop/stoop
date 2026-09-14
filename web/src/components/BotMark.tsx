import { isBot } from "../api/identity";
import type { IdentityKind } from "../gen/stoop/access/v1/access_pb";
import { BotIcon } from "./Icons";
import { Tooltip } from "./Tooltip";

// The bot glyph after a name, wherever a name renders: nothing for a
// person, the icon with a "Bot" tooltip for a bot. It never replaces the
// avatar and never sits on it.
export function BotMark({ kind }: { kind: IdentityKind | undefined }) {
  if (!isBot(kind)) return null;
  return (
    <Tooltip text="Bot">
      <span className="bot-mark" role="img" aria-label="Bot">
        <BotIcon />
      </span>
    </Tooltip>
  );
}
