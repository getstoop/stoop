// "1–25 of 47" and the pager. Rendered only when there is a second page.
export function Footer({
  from,
  to,
  total,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  from: number;
  to: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="dt-footer">
      <span className="muted small">
        {from}–{to} of {total}
      </span>
      <span className="dt-pager">
        <button
          type="button"
          className="chip"
          disabled={!canPrev}
          onClick={onPrev}
        >
          Prev
        </button>
        <button
          type="button"
          className="chip"
          disabled={!canNext}
          onClick={onNext}
        >
          Next
        </button>
      </span>
    </div>
  );
}
