// Shape documented in CLAUDE.md ("Health Data Shape"). `daily` is a dictionary keyed by date, not an array.
// Metrics are null on days with no data (see parse_health.py and the in-browser parser in index.html).
export interface DailyEntry {
  date: string
  steps: number | null
  heart_rate_avg: number | null
  heart_rate_min: number | null
  heart_rate_max: number | null
  resting_hr: number | null
  hrv: number | null
  sleep_hours: number | null
  active_calories: number | null
  exercise_minutes: number | null
  spo2: number | null
}

export interface HealthSummary {
  avg_steps: number | null
  avg_sleep_hours: number | null
  avg_resting_hr: number | null
  avg_hrv: number | null
  best_sleep: number | null
  worst_sleep: number | null
  best_steps_day: string | null
  total_days: number
}

export interface LifeEvent {
  label: string
  start: string
  end: string
  color: string
  icon: string
}

export interface HealthData {
  daily: Record<string, DailyEntry>
  summary: HealthSummary
  events: LifeEvent[]
  generated_at: string
  /** Set by the server when this is the shared synthetic demo dataset rather than the user's own data. */
  is_demo?: boolean
}
