// Placeholder rows at an edge of the view with more messages beyond it:
// the shape of a page before it lands, so a reader scrolling up sees that
// more is coming and sees it arrive. Drawn whenever the edge has more, not
// only while a page is out, so the edge keeps one height between pages —
// a head resizing in view would move every row under it — and the bars
// pulse while a page is out. The rows mean nothing to assistive tech; a
// hidden line says what is loading, as the text it replaced did. Their
// classes are their own, not the message row's: the browser suite counts
// .message as a message.
export function MessageSkeleton({
  edge,
  loading,
}: {
  edge: "older" | "newer";
  loading: boolean;
}) {
  return (
    <div className="message-skeleton" data-edge={edge} data-loading={loading}>
      {loading && (
        <span className="visually-hidden">
          {edge === "older"
            ? "Loading earlier messages…"
            : "Loading newer messages…"}
        </span>
      )}
      <div aria-hidden="true">
        {ROWS.map(({ key, ...row }) => (
          <SkeletonRow key={key} {...row} />
        ))}
      </div>
    </div>
  );
}

// Three rows shaped like a short exchange: a message of two lines, a
// follow-up from the same author, then another author. Each line is its
// width in percent of the content column.
const ROWS: {
  key: string;
  continued: boolean;
  lines: Record<string, number>;
}[] = [
  { key: "a", continued: false, lines: { first: 72, second: 48 } },
  { key: "b", continued: true, lines: { first: 56 } },
  { key: "c", continued: false, lines: { first: 64, second: 28 } },
];

function SkeletonRow({
  continued,
  lines,
}: {
  continued: boolean;
  lines: Record<string, number>;
}) {
  return (
    <div className={`skeleton-row ${continued ? "continued" : ""}`.trim()}>
      {!continued && (
        <>
          <span className="skeleton-bar skeleton-avatar" />
          <div className="skeleton-meta">
            <span className="skeleton-bar skeleton-author" />
            <span className="skeleton-bar skeleton-time" />
          </div>
        </>
      )}
      <div className="skeleton-lines">
        {Object.entries(lines).map(([key, width]) => (
          <span
            key={key}
            className="skeleton-bar"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    </div>
  );
}
