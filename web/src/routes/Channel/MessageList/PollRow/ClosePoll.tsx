import { useCallback, useEffect, useId, useRef, useState } from "react";
import { errorText } from "../../../../api/errors";
import { closePoll } from "../../../../api/polls";
import type { Message } from "../../../../gen/stoop/chat/v1/message_pb";
import { useAnchoredCard } from "../../../../hooks/useAnchoredCard";
import { announce } from "../../../../stores/announcer";
import { notice } from "../../../../stores/dialogs";

// The card's Close poll, for its author and moderators, and the question
// it asks first, under the button: closing is for good. The poll changes
// once the server answers; its closing row follows as a new row.
export function ClosePoll({ message }: { message: Message }) {
  const button = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState<DOMRect | null>(null);
  const [closing, setClosing] = useState(false);
  const stop = useCallback(() => setAsking(null), []);

  const close = async () => {
    setClosing(true);
    try {
      await closePoll(message);
      announce("Poll closed");
    } catch (err) {
      notice({ title: "Couldn't close the poll", body: errorText(err) });
    } finally {
      setClosing(false);
      setAsking(null);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`chip poll-close${asking ? " active" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={!!asking}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAsking(asking ? null : rect);
        }}
      >
        Close poll
      </button>
      {asking && (
        <Confirm
          anchor={asking}
          busy={closing}
          opener={button}
          onCancel={stop}
          onConfirm={close}
        />
      )}
    </>
  );
}

const WIDTH = 300;

function Confirm({
  anchor,
  busy,
  opener,
  onCancel,
  onConfirm,
}: {
  anchor: DOMRect;
  busy: boolean;
  opener: React.RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Under the button, its right edge on the button's.
  const { ref, style } = useAnchoredCard(
    new DOMRect(anchor.right - WIDTH, anchor.top, WIDTH, anchor.height),
    onCancel,
    WIDTH,
  );
  const titleId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  const back = () => {
    opener.current?.focus();
    onCancel();
  };
  return (
    <div
      ref={ref}
      className="popover poll-confirm"
      style={style}
      role="alertdialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") opener.current?.focus();
      }}
    >
      <p>
        <strong id={titleId}>Close this poll?</strong> Voting stops and these
        results become final. A closed poll can't be reopened.
      </p>
      <div className="poll-confirm-actions">
        <button ref={cancel} type="button" className="chip" onClick={back}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={onConfirm}
        >
          Close poll
        </button>
      </div>
    </div>
  );
}
