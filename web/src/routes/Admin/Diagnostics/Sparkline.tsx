// A gauge's last fifteen minutes as one muted line with an accent dot on
// the newest sample. Decorative: the tile's value is the number.

const WIDTH = 90;
const HEIGHT = 20;
const PAD = 2;

export function Sparkline({ series }: { series: number[] }) {
  if (series.length === 0) return <svg className="sparkline" aria-hidden />;
  // Zero-based, so a line's height is the count and a flat one stays put.
  const max = Math.max(...series) || 1;
  const y = (v: number) => HEIGHT - PAD - (v / max) * (HEIGHT - 2 * PAD);
  // Newest at the right edge; a short series grows in from there.
  const x = (i: number) => WIDTH - (series.length - 1 - i);
  const points = series.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = `${WIDTH},${y(series[series.length - 1])}`;
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline className="sparkline-line" points={points} />
      <polyline className="sparkline-end" points={`${last} ${last}`} />
    </svg>
  );
}
