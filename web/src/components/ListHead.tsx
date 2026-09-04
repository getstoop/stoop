// The column labels over a settings list (styles/lists.css). An empty
// label leaves a column unnamed, which is what the actions column is.
// Hidden on a phone, where the columns fold into one row.
export function ListHead({ columns }: { columns: string[] }) {
  return (
    <li className="user-list-head" aria-hidden="true">
      {columns.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: labels are static
        <span key={i}>{c}</span>
      ))}
    </li>
  );
}
