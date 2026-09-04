// Sizes on the admin storage tab. Decimal GB, because that is what disk
// and hosting quotas are sold in; attachments use the binary formatter
// in api/files.ts.

export const GB = 1_000_000_000;

export function formatBytes(n: bigint | number): string {
  const v = Number(n);
  if (v >= GB) return `${(v / GB).toFixed(1)} GB`;
  if (v >= 1_000_000) return `${Math.round(v / 1_000_000)} MB`;
  if (v >= 1000) return `${Math.round(v / 1000)} kB`;
  return `${v} B`;
}
