// On or off as a dot and a word, with the reason it is off beside it.
export function StateCell({
  on,
  note,
  reason,
}: {
  on: boolean;
  // A quiet qualifier under a thing that is on: "12 sent".
  note?: string;
  reason?: string;
}) {
  return (
    <>
      <span className={`dt-state ${on ? "" : "off"}`}>{on ? "On" : "Off"}</span>
      {on
        ? note && <span className="dt-subline small">{note}</span>
        : reason && (
            <span className="dt-subline dt-state-reason">{reason}</span>
          )}
    </>
  );
}
