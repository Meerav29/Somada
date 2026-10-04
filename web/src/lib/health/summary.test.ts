import { describe, expect, it } from 'vitest'
import { computeSummaryStats } from './summary'
import type { DailyEntry } from './types'

function day(date: string, steps: number | null, sleep: number | null): DailyEntry {
  return {
    date,
    steps,
    heart_rate_avg: null,
    heart_rate_min: null,
    heart_rate_max: null,
    resting_hr: null,
    hrv: null,
    sleep_hours: sleep,
    active_calories: null,
    exercise_minutes: null,
    spo2: null,
  }
}

const days = (sleeps: (number | null)[]) =>
  sleeps.map((s, i) => day(`2025-01-0${i + 1}`, 1000 * (i + 1), s))

describe('computeSummaryStats', () => {
  it('computes best and worst sleep over positive values', () => {
    const s = computeSummaryStats(days([7, 6.5, 8]))
    expect(s.worst_sleep).toBe(6.5)
    expect(s.best_sleep).toBe(8)
  })

  it('ignores nulls', () => {
    const s = computeSummaryStats(days([null, 7, null, 5.5]))
    expect(s.worst_sleep).toBe(5.5)
    expect(s.best_sleep).toBe(7)
  })

  it('keeps no-data stats null instead of 0', () => {
    for (const input of [[], days([null, null])]) {
      const s = computeSummaryStats(input)
      expect(s.worst_sleep).toBeNull()
      expect(s.best_sleep).toBeNull()
      expect(s.avg_sleep_hours).toBeNull()
    }
  })

  it('computes the other stats', () => {
    const s = computeSummaryStats(days([7, 6.5, 8]))
    expect(s.best_steps_day).toBe('2025-01-03')
    expect(s.total_days).toBe(3)
    expect(s.avg_steps).toBe(2000)
    expect(computeSummaryStats([]).best_steps_day).toBeNull()
  })
})
