import { BellOffIcon } from "./Icons";

// The red muted bell beside the name of something the reader muted.
export function MutedMark() {
  return (
    <span className="muted-mark" role="img" aria-label="Muted">
      <BellOffIcon size={14} />
    </span>
  );
}
