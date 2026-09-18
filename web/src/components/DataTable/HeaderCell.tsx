import type { SortDirection } from "@tanstack/react-table";
import { alignClass, type ColumnMeta } from "./features";

// One column label. A sortable column's label is a button that cycles
// ascending, descending, default order.
export function HeaderCell({
  label,
  meta,
  sorted,
  onSort,
}: {
  label: string;
  meta?: ColumnMeta;
  sorted: false | SortDirection;
  onSort?: () => void;
}) {
  const ariaSort =
    sorted === "asc"
      ? "ascending"
      : sorted === "desc"
        ? "descending"
        : undefined;
  return (
    <th scope="col" className={alignClass(meta)} aria-sort={ariaSort}>
      {onSort ? (
        <button type="button" className="dt-sort" onClick={onSort}>
          {label}
          <span className="dt-sort-arrow" aria-hidden="true">
            {sorted === "desc" ? "▼" : "▲"}
          </span>
        </button>
      ) : label ? (
        label
      ) : (
        meta?.actions && <span className="dt-sr">Actions</span>
      )}
    </th>
  );
}
