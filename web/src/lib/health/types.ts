// Shape documented in CLAUDE.md ("Health Data Shape"). `daily` is a dictionary keyed by date, not an array.
export interface DailyEntry {
  date: string
  steps: number
  resting_hr: number
  hrv: number
  sleep_hours: number
  active_calories: number
  exercise_minutes: number
  spo2: number
}

export interface HealthSummary {
  avg_steps: number
  avg_sleep_hours: number
  avg_resting_hr: number
  avg_hrv: number
  best_sleep: number
  worst_sleep: number
  best_steps_day: string
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
