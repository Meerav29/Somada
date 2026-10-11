import type { ParseResult } from '../../lib/health/types'

export interface PreviewCard {
  label: string
  value: string
}

export interface PreviewModel {
  days: number
  range: string
  cards: PreviewCard[]
  missing: string[]
  steps: (number | null)[]
  sleep: (number | null)[]
}

const fmt = (n: number | null, digits = 0): string =>
  n === null ? '–' : n.toLocaleString('en-US', { maximumFractionDigits: digits })

const withUnit = (n: number | null, unit: string, digits = 0): string =>
  n === null ? '–' : `${fmt(n, digits)} ${unit}`

export function buildPreview(result: ParseResult): PreviewModel {
  const { summary, stats, daily } = result
  const entries = Object.keys(daily)
    .sort()
    .map((date) => daily[date])
  const missing = (
    [
      ['steps', summary.avg_steps],
      ['sleep', summary.avg_sleep_hours],
      ['resting heart rate', summary.avg_resting_hr],
      ['HRV', summary.avg_hrv],
    ] as const
  )
    .filter(([, value]) => value === null)
    .map(([name]) => name)
  return {
    days: summary.total_days,
    range: stats.firstDate && stats.lastDate ? `${stats.firstDate} to ${stats.lastDate}` : '–',
    cards: [
      { label: 'Average steps', value: fmt(summary.avg_steps) },
      { label: 'Average sleep', value: withUnit(summary.avg_sleep_hours, 'h', 1) },
      { label: 'Average resting HR', value: withUnit(summary.avg_resting_hr, 'bpm') },
      { label: 'Average HRV', value: withUnit(summary.avg_hrv, 'ms') },
    ],
    missing,
    steps: entries.map((e) => e.steps),
    sleep: entries.map((e) => e.sleep_hours),
  }
}
