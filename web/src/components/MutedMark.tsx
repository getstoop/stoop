import { BellOffIcon } from "./Icons";
import { Tooltip } from "./Tooltip";

// The red muted bell beside the name of something the reader muted. A
// tip says what the mute means where the mark stands alone.
export function MutedMark({ tip, detail }: { tip?: string; detail?: string }) {
  return (
    <Tooltip text={tip} detail={detail} side="bottom">
      <span className="muted-mark" role="img" aria-label={tip ?? "Muted"}>
        <BellOffIcon size={14} />
      </span>
    </Tooltip>
  );
}
