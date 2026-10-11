export const TYPE = {
  steps: 'HKQuantityTypeIdentifierStepCount',
  heartRate: 'HKQuantityTypeIdentifierHeartRate',
  resting: 'HKQuantityTypeIdentifierRestingHeartRate',
  hrv: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  sleep: 'HKCategoryTypeIdentifierSleepAnalysis',
  calories: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  exercise: 'HKQuantityTypeIdentifierAppleExerciseTime',
  spo2: 'HKQuantityTypeIdentifierOxygenSaturation',
  respiratory: 'HKQuantityTypeIdentifierRespiratoryRate',
  walkingHr: 'HKQuantityTypeIdentifierWalkingHeartRateAverage',
  bodyMass: 'HKQuantityTypeIdentifierBodyMass',
} as const

/** Retention cutoff for this "now" with 18 months is 2024-09-01. */
export const FIXTURE_NOW = new Date('2026-03-01T12:00:00Z')

export function record(
  type: string,
  start: string,
  value: string | number,
  opts: { end?: string; source?: string; children?: string } = {},
): string {
  const end = opts.end ?? start
  const source = opts.source ?? 'Watch'
  const open =
    `<Record type="${type}" sourceName="${source}" unit="u" creationDate="${start}" ` +
    `startDate="${start}" endDate="${end}" value="${value}"`
  return opts.children ? `${open}>${opts.children}</Record>` : `${open}/>`
}

export function exportXml(body: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE HealthData [\n' +
    '<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary)*)>\n' +
    ']>\n' +
    '<HealthData locale="en_US">\n' +
    ' <ExportDate value="2026-03-01 08:00:00 -0500"/>\n' +
    ' <Me HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexNotSet"/>\n' +
    `${body}\n` +
    '</HealthData>\n'
  )
}

const at = (date: string, time: string) => `${date} ${time} -0500`

/**
 * 25 <Record> tags over these days (all times local, January so no DST edge cases):
 *  01-10  only an InBed sleep record            -> day exists, everything null
 *  01-11  8.00 h asleep (450 + 30 min), 4000 steps
 *  01-12  steps 1000 + 2000.4 + 500 (one with a MetadataEntry child and a non-ASCII source),
 *         heart rate 60 / 72.5 / 90 plus one non-numeric, resting 58, hrv 40 / 50
 *  01-13  calories 100.4 + 200.4, exercise 10 + 20.4, spo2 97 / 98, respiratory 15
 *  01-14  only a walking-HR record               -> day exists, everything null
 * plus an unmapped BodyMass record (ignored) and a 2023 steps record (outside retention),
 * a <Workout> and an <ActivitySummary> element (ignored).
 */
export function standardFixtureXml(): string {
  const r: string[] = [
    record(TYPE.sleep, at('2026-01-10', '22:30:00'), 'HKCategoryValueSleepAnalysisInBed', {
      end: at('2026-01-11', '06:00:00'),
    }),
    record(TYPE.sleep, at('2026-01-11', '23:00:00'), 'HKCategoryValueSleepAnalysisAsleepCore', {
      end: at('2026-01-12', '06:30:00'),
    }),
    record(TYPE.sleep, at('2026-01-11', '23:30:00'), 'HKCategoryValueSleepAnalysisREM', {
      end: at('2026-01-12', '00:00:00'),
    }),
    record(TYPE.sleep, at('2026-01-11', '22:30:00'), 'HKCategoryValueSleepAnalysisInBed', {
      end: at('2026-01-12', '06:45:00'),
    }),
    record(TYPE.steps, at('2026-01-11', '09:00:00'), 4000),
    record(TYPE.steps, at('2026-01-12', '08:00:00'), 1000, { source: 'Müller’s 日本語 Watch' }),
    record(TYPE.steps, at('2026-01-12', '12:00:00'), 2000.4),
    record(TYPE.steps, at('2026-01-12', '18:00:00'), 500, {
      children: '<MetadataEntry key="HKMetadataKeySyncVersion" value="999"/>',
    }),
    record(TYPE.heartRate, at('2026-01-12', '08:05:00'), 60),
    record(TYPE.heartRate, at('2026-01-12', '12:05:00'), 72.5),
    record(TYPE.heartRate, at('2026-01-12', '18:05:00'), 90),
    record(TYPE.heartRate, at('2026-01-12', '19:05:00'), 'abc'),
    record(TYPE.resting, at('2026-01-12', '07:00:00'), 58),
    record(TYPE.hrv, at('2026-01-12', '03:00:00'), 40),
    record(TYPE.hrv, at('2026-01-12', '04:00:00'), 50),
    record(TYPE.calories, at('2026-01-13', '10:00:00'), 100.4),
    record(TYPE.calories, at('2026-01-13', '11:00:00'), 200.4),
    record(TYPE.exercise, at('2026-01-13', '10:00:00'), 10),
    record(TYPE.exercise, at('2026-01-13', '11:00:00'), 20.4),
    record(TYPE.spo2, at('2026-01-13', '12:00:00'), 97),
    record(TYPE.spo2, at('2026-01-13', '13:00:00'), 98),
    record(TYPE.respiratory, at('2026-01-13', '14:00:00'), 15),
    record(TYPE.walkingHr, at('2026-01-14', '09:00:00'), 100),
    record(TYPE.bodyMass, at('2026-01-12', '07:00:00'), 70),
    record(TYPE.steps, at('2023-01-01', '09:00:00'), 99999),
    '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" startDate="2026-01-12 06:00:00 -0500"/>',
    '<ActivitySummary dateComponents="2026-01-12" activeEnergyBurned="300"/>',
  ]
  return exportXml(r.join('\n'))
}

/**
 * Parity-only extras (kept apart so parseExport.test.ts expectations are unaffected). Pins:
 *  01-20  steps 1000 + 2000.6 + 500 = 3500.6 (round -> 3501, floor -> 3500)
 *  01-21  one asleep record of exactly 440 min (7.33 h at 2 decimals, 7.3 at 1)
 *  01-22  asleep 23:30 -> 01:10 next day, counted on the start day
 *  2025-01-15 steps: inside the pinned cutoff (2024-09-01) but outside the real clock's 18 months
 *  2024-08-31 steps (dropped) and 2024-09-01 steps (kept): `<` vs `<=` at the cutoff
 */
export function parityExtrasXml(): string {
  const r: string[] = [
    record(TYPE.steps, at('2026-01-20', '08:00:00'), 1000),
    record(TYPE.steps, at('2026-01-20', '12:00:00'), 2000.6),
    record(TYPE.steps, at('2026-01-20', '18:00:00'), 500),
    record(TYPE.sleep, at('2026-01-21', '00:00:00'), 'HKCategoryValueSleepAnalysisAsleepCore', {
      end: at('2026-01-21', '07:20:00'),
    }),
    record(TYPE.sleep, at('2026-01-22', '23:30:00'), 'HKCategoryValueSleepAnalysisAsleepDeep', {
      end: at('2026-01-23', '01:10:00'),
    }),
    record(TYPE.steps, at('2025-01-15', '09:00:00'), 4321),
    record(TYPE.steps, at('2024-08-31', '12:00:00'), 111),
    record(TYPE.steps, at('2024-09-01', '12:00:00'), 222),
  ]
  return exportXml(r.join('\n'))
}

/** Encode `text` as UTF-8 and yield it in `size`-byte chunks (which may split multi-byte characters). */
export async function* toChunks(text: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  for (let i = 0; i < bytes.length; i += size) {
    yield bytes.slice(i, i + size)
  }
}
