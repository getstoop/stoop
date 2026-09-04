import { PlusIcon } from "./Icons";

// A group's label in the channel sidebar, with the + that adds to the
// group for those who may. The voice group is set off from the text
// group by a rule.
export function ChannelGroupHeading({
  label,
  add,
  onAdd,
  divided,
}: {
  label: string;
  // The add button's name, e.g. "Add voice channel"; absent for members.
  add?: string;
  onAdd?: () => void;
  divided?: boolean;
}) {
  return (
    <div className={`channel-group-heading ${divided ? "divided" : ""}`}>
      <h4>{label}</h4>
      {add && (
        <button
          type="button"
          className={`icon-button channel-add ${label.startsWith("Voice") ? "voice" : ""}`}
          onClick={onAdd}
          aria-label={add}
          title={add}
        >
          <PlusIcon />
        </button>
      )}
    </div>
  );
}
