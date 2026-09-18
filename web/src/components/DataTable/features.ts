import {
  type ColumnDef,
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  metaHelper,
  type RowData,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";

// What a column may say about its own layout (styles/data-table.css).
export type ColumnMeta = {
  // A CSS width for the column: "30%", or px as a number. The first
  // column is left without one so it takes what remains.
  width?: string | number;
  align?: "center" | "end";
  // The actions column: right-aligned, never wraps, top-right on a phone.
  actions?: boolean;
};

// The cell class for a column's alignment.
export function alignClass(meta?: ColumnMeta): string | undefined {
  if (meta?.actions) return "dt-actions";
  if (meta?.align === "center") return "dt-center";
  if (meta?.align === "end") return "dt-end";
  return undefined;
}

// The parts of TanStack Table every settings list uses. Search runs as
// the global filter, which only looks at columns with an accessorFn, so
// a searchable table needs at least one.
export const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    basic: sortFn_basic,
    text: sortFn_text,
    alphanumeric: sortFn_alphanumeric,
    datetime: sortFn_datetime,
  },
  columnMeta: metaHelper<ColumnMeta>(),
});

export type Features = typeof features;
export type TableColumn<T extends RowData> = ColumnDef<Features, T>;
