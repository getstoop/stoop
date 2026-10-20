import { useServerOrigins } from "../../api/queries";
import { linkedMessage } from "../../api/shareLinks";
import { linksIn } from "../../core/markdown";
import { LinkedMessageCard } from "./LinkedMessageCard";

// As many cards as a message gets link previews.
const MAX_CARDS = 3;

// A card for each link in a message that leads to a message on this
// server. docs/architecture/messaging.md → Links to messages.
export function LinkedMessages({ content }: { content: string }) {
  const origins = useServerOrigins();
  // No link, no parse: most messages stop here.
  if (!content.includes("://")) return null;
  const targets = linksIn(content)
    .map((href) => linkedMessage(href, origins))
    .filter((target) => target !== null)
    .filter(
      (target, index, all) =>
        all.findIndex((other) => other.messageId === target.messageId) ===
        index,
    )
    .slice(0, MAX_CARDS);
  if (targets.length === 0) return null;
  return (
    <div className="link-previews">
      {targets.map((target) => (
        <LinkedMessageCard key={target.messageId} target={target} />
      ))}
    </div>
  );
}
