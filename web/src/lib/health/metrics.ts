// Copied from the classic parser (index.html: HEALTH_METRIC_MAP, SLEEP_ASLEEP).
export type Metric =
  | 'steps'
  | 'heart_rate'
  | 'resting_heart_rate'
  | 'hrv'
  | 'sleep'
  | 'active_calories'
  | 'exercise_minutes'
  | 'spo2'
  | 'respiratory_rate'
  | 'walking_hr'

export const METRIC_BY_TYPE: ReadonlyMap<string, Metric> = new Map<string, Metric>([
  ['HKQuantityTypeIdentifierStepCount', 'steps'],
  ['HKQuantityTypeIdentifierHeartRate', 'heart_rate'],
  ['HKQuantityTypeIdentifierRestingHeartRate', 'resting_heart_rate'],
  ['HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'hrv'],
  ['HKCategoryTypeIdentifierSleepAnalysis', 'sleep'],
  ['HKQuantityTypeIdentifierActiveEnergyBurned', 'active_calories'],
  ['HKQuantityTypeIdentifierAppleExerciseTime', 'exercise_minutes'],
  ['HKQuantityTypeIdentifierOxygenSaturation', 'spo2'],
  ['HKQuantityTypeIdentifierRespiratoryRate', 'respiratory_rate'],
  ['HKQuantityTypeIdentifierWalkingHeartRateAverage', 'walking_hr'],
])

export const SLEEP_ASLEEP: ReadonlySet<string> = new Set([
  'HKCategoryValueSleepAnalysisAsleep',
  'HKCategoryValueSleepAnalysisCore',
  'HKCategoryValueSleepAnalysisDeep',
  'HKCategoryValueSleepAnalysisREM',
  'HKCategoryValueSleepAnalysisAsleepCore',
  'HKCategoryValueSleepAnalysisAsleepDeep',
  'HKCategoryValueSleepAnalysisAsleepREM',
  'HKCategoryValueSleepAnalysisAsleepUnspecified',
])

/** Months of history kept, as in the classic app (DATA_RETENTION_MONTHS). */
export const RETENTION_MONTHS = 18
