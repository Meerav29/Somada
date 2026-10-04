// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIXTURE_NOW,
  TYPE,
  exportXml,
  record,
  standardFixtureXml,
  toChunks,
} from './__fixtures__/exportFixture'
import { parseExport, retentionCutoff } from './parseExport'

afterEach(() => {
  vi.unstubAllGlobals()
})

const parse = (xml: string, size = 1_000_000) => parseExport(toChunks(xml, size), { now: FIXTURE_NOW })

const NULLS = {
  steps: null,
  heart_rate_avg: null,
  heart_rate_min: null,
  heart_rate_max: null,
  resting_hr: null,
  hrv: null,
  sleep_hours: null,
  active_calories: null,
  exercise_minutes: null,
  spo2: null,
}

describe('retentionCutoff', () => {
  it('goes back the given number of months', () => {
    expect(retentionCutoff(FIXTURE_NOW, 18)).toBe('2024-09-01')
  })
})

describe('parseExport on the standard fixture', () => {
  it('aggregates every day', async () => {
    const { daily } = await parse(standardFixtureXml())
    expect(Object.keys(daily)).toEqual([
      '2026-01-10',
      '2026-01-11',
      '2026-01-12',
      '2026-01-13',
      '2026-01-14',
    ])
    expect(daily['2026-01-10']).toEqual({ date: '2026-01-10', ...NULLS })
    expect(daily['2026-01-11']).toEqual({ date: '2026-01-11', ...NULLS, steps: 4000, sleep_hours: 8 })
    expect(daily['2026-01-12']).toEqual({
      date: '2026-01-12',
      ...NULLS,
      steps: 3500,
      heart_rate_avg: 74.2,
      heart_rate_min: 60,
      heart_rate_max: 90,
      resting_hr: 58,
      hrv: 45,
    })
    expect(daily['2026-01-13']).toEqual({
      date: '2026-01-13',
      ...NULLS,
      active_calories: 301,
      exercise_minutes: 30,
      spo2: 97.5,
    })
    // A day that only has a walking-HR record still exists (as in the classic parser).
    expect(daily['2026-01-14']).toEqual({ date: '2026-01-14', ...NULLS })
  })

  it('computes the summary', async () => {
    const { summary } = await parse(standardFixtureXml())
    expect(summary).toEqual({
      avg_steps: 3750,
      avg_sleep_hours: 8,
      avg_resting_hr: 58,
      avg_hrv: 45,
      best_sleep: 8,
      worst_sleep: 8,
      best_steps_day: '2026-01-11',
      total_days: 5,
    })
  })

  it('drops records older than the retention window', async () => {
    const { daily } = await parse(standardFixtureXml())
    expect(daily['2023-01-01']).toBeUndefined()
  })

  it('reports stats', async () => {
    const xml = standardFixtureXml()
    const { stats } = await parse(xml)
    expect(stats.recordsSeen).toBe(25)
    expect(stats.recordsKept).toBe(23)
    expect(stats.firstDate).toBe('2026-01-10')
    expect(stats.lastDate).toBe('2026-01-14')
    expect(stats.bytesRead).toBe(new TextEncoder().encode(xml).length)
  })

  it.each([1, 7, 64])('gives the same result for %i-byte chunks as for one chunk', async (size) => {
    const xml = standardFixtureXml()
    const whole = await parse(xml)
    const chunked = await parse(xml, size)
    expect(chunked.daily).toEqual(whole.daily)
    expect(chunked.summary).toEqual(whole.summary)
    expect(chunked.stats.recordsSeen).toBe(whole.stats.recordsSeen)
    expect(chunked.stats.recordsKept).toBe(whole.stats.recordsKept)
    expect(chunked.stats.bytesRead).toBe(whole.stats.bytesRead)
  })

  it('reports increasing progress that ends at the total size', async () => {
    const xml = standardFixtureXml()
    const seen: { recordsSeen: number; xmlBytes: number }[] = []
    await parseExport(toChunks(xml, 100), { now: FIXTURE_NOW, onProgress: (p) => seen.push(p) })
    expect(seen.length).toBeGreaterThan(1)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].xmlBytes).toBeGreaterThan(seen[i - 1].xmlBytes)
      expect(seen[i].recordsSeen).toBeGreaterThanOrEqual(seen[i - 1].recordsSeen)
    }
    expect(seen.at(-1)).toEqual({ recordsSeen: 25, xmlBytes: new TextEncoder().encode(xml).length })
  })

  it('makes no network calls', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('network call during parse')
    })
    await expect(parse(standardFixtureXml(), 64)).resolves.toBeDefined()
  })
})

describe('tokenizer details', () => {
  it('handles a ">" inside a quoted attribute value', async () => {
    const xml = exportXml(
      record(TYPE.steps, '2026-01-12 08:00:00 -0500', 1234, { source: 'A > B <Watch>' }),
    )
    const { daily } = await parse(xml, 5)
    expect(daily['2026-01-12'].steps).toBe(1234)
  })

  it('ignores values of nested MetadataEntry children', async () => {
    const xml = exportXml(
      record(TYPE.steps, '2026-01-12 08:00:00 -0500', 10, {
        children: '<MetadataEntry key="k" value="999"/>',
      }),
    )
    const { daily } = await parse(xml)
    expect(daily['2026-01-12'].steps).toBe(10)
  })

  it('does not treat <RecordFoo> elements as records', async () => {
    const body = [
      '<RecordFoo type="HKQuantityTypeIdentifierStepCount" startDate="2026-01-12 08:00:00 -0500" value="5"/>',
      record(TYPE.steps, '2026-01-13 08:00:00 -0500', 7),
    ].join('\n')
    const { daily, stats } = await parse(exportXml(body))
    expect(Object.keys(daily)).toEqual(['2026-01-13'])
    expect(stats.recordsSeen).toBe(1)
  })

  it('keeps the partial-tag buffer small over a long stream', async () => {
    async function* many(): AsyncGenerator<Uint8Array> {
      const encoder = new TextEncoder()
      yield encoder.encode(exportXml('').replace('</HealthData>\n', ''))
      for (let i = 0; i < 20_000; i++) {
        const day = String((i % 28) + 1).padStart(2, '0')
        yield encoder.encode(record(TYPE.steps, `2026-01-${day} 08:00:00 -0500`, 1) + '\n')
      }
      yield encoder.encode('</HealthData>\n')
    }
    const { stats } = await parseExport(many(), { now: FIXTURE_NOW })
    expect(stats.recordsKept).toBe(20_000)
    expect(stats.maxCarryBytes).toBeLessThan(1000)
  })
})

describe('error cases', () => {
  it('rejects XML that is not an Apple Health export', async () => {
    await expect(parse('<?xml version="1.0"?><note><to>x</to></note>')).rejects.toMatchObject({
      code: 'not-health-export',
    })
  })

  it('rejects an empty stream', async () => {
    await expect(parse('')).rejects.toMatchObject({ code: 'not-health-export' })
  })

  it('rejects a truncated file (no closing </HealthData>)', async () => {
    const xml = standardFixtureXml()
    const truncated = xml.slice(0, xml.length - 200)
    await expect(parse(truncated, 64)).rejects.toMatchObject({ code: 'corrupt-file' })
  })

  it('rejects an export with no usable records', async () => {
    const xml = exportXml(record(TYPE.bodyMass, '2026-01-12 08:00:00 -0500', 70))
    await expect(parse(xml)).rejects.toMatchObject({ code: 'no-usable-records' })
  })

  it('rejects an export whose records are all outside the retention window', async () => {
    const xml = exportXml(record(TYPE.steps, '2020-01-12 08:00:00 -0500', 100))
    await expect(parse(xml)).rejects.toMatchObject({ code: 'no-usable-records' })
  })

  it('rejects an unterminated <Record> that grows without bound', async () => {
    const xml = exportXml('').replace('</HealthData>\n', '') + '<Record type="x" ' + 'a'.repeat(1_100_000)
    await expect(parse(xml, 100_000)).rejects.toMatchObject({ code: 'corrupt-file' })
  })
})
