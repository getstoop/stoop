import { Fragment } from "react";

export type SortChoice = { id: string; label: string };

// Search, the row count, and (phones only, where there is no header to
// tap) a sort select.
export function Toolbar({
  query,
  onQuery,
  placeholder,
  label,
  count,
  sortChoices,
  sortValue,
  onSort,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  label: string;
  count: string;
  sortChoices: SortChoice[];
  // "" for the default order, else "<column id>:asc" or "<column id>:desc".
  sortValue: string;
  onSort: (value: string) => void;
}) {
  return (
    <div className="dt-toolbar">
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {sortChoices.length > 0 && (
        <select
          className="dt-sort-select"
          aria-label="Sort by"
          value={sortValue}
          onChange={(e) => onSort(e.target.value)}
        >
          <option value="">Default order</option>
          {sortChoices.map((c) => (
            <Fragment key={c.id}>
              <option value={`${c.id}:asc`}>{c.label}</option>
              <option value={`${c.id}:desc`}>{c.label}, reversed</option>
            </Fragment>
          ))}
        </select>
      )}
      <span className="dt-count muted small">{count}</span>
    </div>
  );
}
