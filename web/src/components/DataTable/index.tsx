import {
  type ExpandedState,
  functionalUpdate,
  type RowData,
  useTable,
} from "@tanstack/react-table";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { Footer } from "./Footer";
import { alignClass, features, type TableColumn } from "./features";
import { HeaderCell } from "./HeaderCell";
import { Toolbar } from "./Toolbar";

export type { TableColumn } from "./features";
export { PersonCell } from "./PersonCell";
export { StateCell } from "./StateCell";

const SKELETON_ROWS = [0, 1, 2];

// The table every settings list is built from (styles/data-table.css;
// docs/architecture/web.md → Tables). Sections declare columns and hand
// over rows; search, sort and paging are TanStack Table's, kept inside.
// Columns must be stable between renders: module scope or useMemo.
export function DataTable<T extends RowData>({
  rows,
  columns,
  rowId,
  search,
  noun,
  empty,
  pageSize = 25,
  rowInactive,
  rowError,
  rowProps,
  detail,
  ordered = false,
  hidden,
}: {
  // undefined while loading.
  rows: T[] | undefined;
  columns: TableColumn<T>[];
  rowId: (row: T) => string;
  // Present on a list that can grow long: a filter box over the table.
  search?: { placeholder: string; label: string; text: (row: T) => string };
  // Singular and plural, for the count: ["member", "members"].
  noun: [string, string];
  // Said in place of the table when there are no rows at all.
  empty: string;
  pageSize?: number;
  // The rows' order is the data (Channels): no sorting, no paging.
  ordered?: boolean;
  // Dead rows (deactivated bots) stay out of the way behind a counted
  // switch in the toolbar. A search still finds them. `when` must be
  // stable (module scope), like the columns.
  hidden?: { label: string; when: (row: T) => boolean };
  rowInactive?: (row: T) => boolean;
  // A failed action's message, shown on the row it was for.
  rowError?: (row: T) => string | null | undefined;
  // Extra attributes for the <tr>, e.g. data-* hooks.
  rowProps?: (row: T) => Record<string, string>;
  // A full-width row under a parent that owns a list (an account's
  // tokens). Rows that can open get a chevron in a leading column.
  detail?: {
    canExpand: (row: T) => boolean;
    // Accessible name for the chevron: "Tokens of @casey".
    label: (row: T) => string;
    render: (row: T) => ReactNode;
    // Both or neither: a section that opens rows itself (Test opens the
    // delivery log) owns the state, keyed by row id.
    expanded?: Record<string, boolean>;
    onExpandedChange?: (next: Record<string, boolean>) => void;
  };
}) {
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const hiddenWhen = hidden?.when;
  const searching = query.trim() !== "";
  const data = useMemo(
    () =>
      rows && hiddenWhen && !showHidden && !searching
        ? rows.filter((r) => !hiddenWhen(r))
        : rows,
    [rows, hiddenWhen, showHidden, searching],
  );
  const hiddenCount = useMemo(
    () => (rows && hiddenWhen ? rows.filter(hiddenWhen).length : 0),
    [rows, hiddenWhen],
  );
  const table = useTable({
    features,
    columns,
    data: data ?? (EMPTY as T[]),
    getRowId: rowId,
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: ordered ? Number.MAX_SAFE_INTEGER : pageSize,
      },
    },
    enableSorting: !ordered,
    // A refetch after an action must not throw the reader back to page 1
    // or close the detail row they were working in.
    autoResetAll: false,
    autoResetPageIndex: false,
    sortDescFirst: false,
    ...(detail?.expanded && {
      state: { expanded: detail.expanded as ExpandedState },
      onExpandedChange: (updater) => {
        const next = functionalUpdate(updater, detail.expanded ?? {});
        detail.onExpandedChange?.(next === true ? {} : next);
      },
    }),
    getRowCanExpand: (row) => detail?.canExpand(row.original) ?? false,
    getColumnCanGlobalFilter: () => true,
    globalFilterFn: (row, _columnId, needle: string) =>
      search ? search.text(row.original).toLowerCase().includes(needle) : true,
  });

  const total = data?.length ?? 0;
  const matched = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.state.pagination;
  const pageCount = table.getPageCount();
  // Rows can leave the last page (a kick, a narrower search).
  useEffect(() => {
    if (pageIndex > 0 && pageIndex >= pageCount)
      table.setPageIndex(Math.max(0, pageCount - 1));
  }, [pageIndex, pageCount, table]);

  if (rows && rows.length === 0) {
    return (
      <div className="dt-box">
        <p className="dt-message">{empty}</p>
      </div>
    );
  }

  const onQuery = (q: string) => {
    setQuery(q);
    table.setGlobalFilter(q.trim().toLowerCase());
    table.setPageIndex(0);
  };
  const sorting = table.state.sorting[0];
  const onSort = (value: string) => {
    const [id, dir] = value.split(":");
    table.setSorting(id ? [{ id, desc: dir === "desc" }] : []);
    table.setPageIndex(0);
  };
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const labelOf = (header: unknown) =>
    typeof header === "string" ? header : "";
  const pageRows = table.getRowModel().rows;
  const from = pageIndex * pageSize;

  return (
    <div className="dt-wrap">
      {(search || hiddenCount > 0) && (
        <Toolbar
          search={
            search && {
              query,
              onQuery,
              placeholder: search.placeholder,
              label: search.label,
            }
          }
          hidden={
            hidden && hiddenCount > 0
              ? {
                  label: `${hidden.label} (${hiddenCount})`,
                  shown: showHidden,
                  onToggle: setShowHidden,
                }
              : undefined
          }
          count={
            matched === total
              ? `${total} ${total === 1 ? noun[0] : noun[1]}`
              : `${matched} of ${total}`
          }
          sortChoices={headers
            .filter((h) => h.column.getCanSort())
            .map((h) => ({
              id: h.column.id,
              label: labelOf(h.column.columnDef.header),
            }))}
          sortValue={
            sorting ? `${sorting.id}:${sorting.desc ? "desc" : "asc"}` : ""
          }
          onSort={onSort}
        />
      )}
      <div className="dt-box">
        <table className={`dt ${detail ? "expandable" : ""}`} aria-busy={!rows}>
          <colgroup>
            {detail && <col className="dt-expand-col" />}
            {headers.map((h) => (
              <col
                key={h.id}
                style={{ width: h.column.columnDef.meta?.width }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {detail && <th />}
              {headers.map((h) => (
                <HeaderCell
                  key={h.id}
                  label={labelOf(h.column.columnDef.header)}
                  meta={h.column.columnDef.meta}
                  sorted={h.column.getIsSorted()}
                  onSort={
                    h.column.getCanSort()
                      ? () => {
                          h.column.toggleSorting();
                          table.setPageIndex(0);
                        }
                      : undefined
                  }
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {!rows &&
              SKELETON_ROWS.map((i) => (
                <tr key={i} className="dt-row">
                  {detail && <td />}
                  {headers.map((h) => (
                    <td key={h.id}>
                      {!h.column.columnDef.meta?.actions && (
                        <span className="dt-skeleton" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            {pageRows.map((row) => {
              const error = rowError?.(row.original);
              const open = detail && row.getIsExpanded();
              return (
                <Fragment key={row.id}>
                  <tr
                    className={`dt-row ${rowInactive?.(row.original) ? "inactive" : ""}`}
                    {...rowProps?.(row.original)}
                  >
                    {detail && (
                      <td className="dt-expand">
                        {row.getCanExpand() && (
                          <button
                            type="button"
                            className="icon-button dt-expander"
                            aria-expanded={row.getIsExpanded()}
                            aria-label={detail.label(row.original)}
                            onClick={() => row.toggleExpanded()}
                          >
                            <span aria-hidden="true">▶</span>
                          </button>
                        )}
                      </td>
                    )}
                    {row.getAllCells().map((cell, i) => {
                      const def = cell.column.columnDef;
                      return (
                        <td
                          key={cell.id}
                          className={
                            i === 0 ? "dt-primary" : alignClass(def.meta)
                          }
                          data-label={
                            i > 0 ? labelOf(def.header) || undefined : undefined
                          }
                        >
                          <table.FlexRender cell={cell} />
                          {i === 0 && error && <CellError>{error}</CellError>}
                        </td>
                      );
                    })}
                  </tr>
                  {open && (
                    <tr className="dt-detail">
                      <td colSpan={headers.length + 1}>
                        {detail.render(row.original)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows && matched === 0 && !searching && (
          <p className="dt-message">{empty}</p>
        )}
        {rows && matched === 0 && searching && (
          <p className="dt-message">
            No {noun[1]} match “{query.trim()}”.{" "}
            <button type="button" className="chip" onClick={() => onQuery("")}>
              Clear
            </button>
          </p>
        )}
        {matched > pageSize && (
          <Footer
            from={from + 1}
            to={from + pageRows.length}
            total={matched}
            canPrev={table.getCanPreviousPage()}
            canNext={table.getCanNextPage()}
            onPrev={() => table.previousPage()}
            onNext={() => table.nextPage()}
          />
        )}
      </div>
    </div>
  );
}

const EMPTY: unknown[] = [];

function CellError({ children }: { children: ReactNode }) {
  return (
    <span className="dt-row-error error small" role="alert">
      {children}
    </span>
  );
}
