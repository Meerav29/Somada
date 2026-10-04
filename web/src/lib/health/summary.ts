import type { DailyEntry, HealthSummary } from './types'

type Maybe = number | null

const present = (values: Maybe[]): number[] => values.filter((v): v is number => v != null)

function avgStat(values: Maybe[]): Maybe {
  const c = present(values)
  return c.length ? +(c.reduce((a, b) => a + b, 0) / c.length).toFixed(1) : null
}

// Seed-free min/max: a null seed would coerce to 0 in Math.min/Math.max.
function extreme(values: Maybe[], pick: (...n: number[]) => number): Maybe {
  const c = present(values)
  return c.length ? pick(...c) : null
}

/** Port of the classic computeSummaryStats (index.html). */
export function computeSummaryStats(days: DailyEntry[]): HealthSummary {
  const bestStepsDay = days.reduce<DailyEntry | null>(
    (best, d) => (!best || (d.steps || 0) > (best.steps || 0) ? d : best),
    null,
  )
  return {
    avg_steps: avgStat(days.map((d) => d.steps)),
    avg_sleep_hours: avgStat(days.map((d) => d.sleep_hours)),
    avg_resting_hr: avgStat(days.map((d) => d.resting_hr)),
    avg_hrv: avgStat(days.map((d) => d.hrv)),
    best_sleep: extreme(days.map((d) => d.sleep_hours), Math.max),
    worst_sleep: extreme(days.map((d) => d.sleep_hours), Math.min),
    best_steps_day: bestStepsDay ? bestStepsDay.date : null,
    total_days: days.length,
  }
}
