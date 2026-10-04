/** SVG polyline points for the non-null values, spread evenly over `width` by position. */
export function toPoints(values: (number | null)[], width: number, height: number): string | null {
  const present = values.flatMap((v, i) => (v === null ? [] : [{ v, i }]))
  if (present.length < 2) return null
  const nums = present.map((p) => p.v)
  const min = Math.min(...nums)
  const span = Math.max(...nums) - min || 1
  const lastIndex = values.length - 1
  return present
    .map(({ v, i }) => {
      const x = (i / lastIndex) * width
      const y = height - 2 - ((v - min) / span) * (height - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

const WIDTH = 160
const HEIGHT = 36

export function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const points = toPoints(values, WIDTH, HEIGHT)
  if (points === null) return <p className="muted">{label}: not enough data</p>
  return (
    <svg
      role="img"
      aria-label={label}
      className="sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
    >
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  )
}
