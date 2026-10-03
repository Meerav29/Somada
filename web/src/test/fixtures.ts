import type { HealthData } from '../lib/health/types'

export function healthFixture(overrides: Partial<HealthData> = {}): HealthData {
  return {
    daily: {
      '2026-09-30': {
        date: '2026-09-30',
        steps: 8000,
        heart_rate_avg: 72,
        heart_rate_min: 52,
        heart_rate_max: 140,
        resting_hr: 61,
        hrv: 48,
        sleep_hours: 7.1,
        active_calories: 420,
        exercise_minutes: 35,
        spo2: 97.5,
      },
    },
    summary: {
      avg_steps: 8000,
      avg_sleep_hours: 7.1,
      avg_resting_hr: 61,
      avg_hrv: 48,
      best_sleep: 7.1,
      worst_sleep: 7.1,
      best_steps_day: '2026-09-30',
      total_days: 1,
    },
    events: [],
    generated_at: '2026-09-30T00:00:00',
    ...overrides,
  }
}
