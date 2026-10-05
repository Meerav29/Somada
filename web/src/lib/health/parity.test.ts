// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FIXTURE_NOW, parityExtrasXml, standardFixtureXml, toChunks } from './__fixtures__/exportFixture'
import { parseExport } from './parseExport'

const html = readFileSync(fileURLToPath(new URL('../../../../index.html', import.meta.url)), 'utf8')

function between(startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker)
  const end = html.indexOf(endMarker, start)
  if (start < 0 || end < 0) throw new Error(`markers not found in index.html: ${startMarker}`)
  return html.slice(start, end)
}

// Pin "now" for the classic code's `new Date()` (retention cutoff) without touching index.html.
class FixedDate extends Date {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(FIXTURE_NOW.getTime())
    else super(...(args as [string]))
  }
}

const constants = between('const HEALTH_METRIC_MAP', 'const DEFAULT_LIFE_EVENTS')
const parser = between('function _getAttr', 'async function handleFileUpload')

type ClassicParse = (
  file: { text(): Promise<string> },
  onProgress: (pct: number, label: string) => void,
) => Promise<{ daily: unknown; summary: unknown }>

const classicParse = new Function(
  'Date',
  'getLifeEvents',
  'DATA_RETENTION_MONTHS',
  `${constants}\n${parser}\nreturn parseHealthXML;`,
)(FixedDate, () => [], 18) as ClassicParse

async function classic(xml: string) {
  return classicParse({ text: async () => xml }, () => {})
}

describe('parity with the classic parser (index.html)', () => {
  it('produces identical daily data and summary on the standard fixture', async () => {
    const xml = standardFixtureXml()
    const expected = await classic(xml)
    const actual = await parseExport(toChunks(xml, 64), { now: FIXTURE_NOW })
    expect(actual.daily).toEqual(expected.daily)
    expect(actual.summary).toEqual(expected.summary)
  })

  it('still agrees when the data is delivered one byte at a time', async () => {
    const xml = standardFixtureXml()
    const expected = await classic(xml)
    const actual = await parseExport(toChunks(xml, 1), { now: FIXTURE_NOW })
    expect(actual.daily).toEqual(expected.daily)
    expect(actual.summary).toEqual(expected.summary)
  })

  describe('extras fixture (rounding, sleep precision, midnight, retention cutoff)', () => {
    it.each([64, 1])('agrees with the classic parser at chunk size %i', async (size) => {
      const xml = parityExtrasXml()
      const expected = await classic(xml)
      const actual = await parseExport(toChunks(xml, size), { now: FIXTURE_NOW })
      expect(actual.daily).toEqual(expected.daily)
      expect(actual.summary).toEqual(expected.summary)
    })

    it('keeps the cutoff day and earlier in-range data, and drops the day before (not vacuous)', async () => {
      const actual = await parseExport(toChunks(parityExtrasXml(), 64), { now: FIXTURE_NOW })
      expect(actual.daily['2025-01-15']).toBeDefined()
      expect(actual.daily['2024-09-01']).toBeDefined()
      expect(actual.daily['2024-08-31']).toBeUndefined()
      expect(actual.daily['2026-01-20'].steps).toBe(3501)
      expect(actual.daily['2026-01-21'].sleep_hours).toBe(7.33)
      expect(actual.daily['2026-01-22'].sleep_hours).toBe(1.67)
    })
  })
})
