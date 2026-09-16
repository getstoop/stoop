// "(deleted)" after a name, wherever a name renders, for an account its
// owner deleted. The words they wrote stay; this says who is no longer
// here to have written them.
export function DeletedMark({ deleted }: { deleted: boolean | undefined }) {
  if (!deleted) return null;
  return <span className="deleted-mark">(deleted)</span>;
}
