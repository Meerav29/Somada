import { describe, expect, it } from 'vitest'
import { parseResultFixture } from '../../test/fixtures'
import { buildPreview } from './preview'

function result() {
  const r = parseResultFixture()
  r.summary = {
    avg_steps: 3750,
    avg_sleep_hours: 8,
    avg_resting_hr: 58,
    avg_hrv: 45,
    best_sleep: 8,
    worst_sleep: 8,
    best_steps_day: '2026-01-11',
    total_days: 5,
  }
  r.stats.firstDate = '2026-01-10'
  r.stats.lastDate = '2026-01-14'
  return r
}

describe('buildPreview', () => {
  it('formats the cards, range and day count', () => {
    const p = buildPreview(result())
    expect(p.days).toBe(5)
    expect(p.range).toBe('2026-01-10 to 2026-01-14')
    expect(p.cards).toEqual([
      { label: 'Average steps', value: '3,750' },
      { label: 'Average sleep', value: '8 h' },
      { label: 'Average resting HR', value: '58 bpm' },
      { label: 'Average HRV', value: '45 ms' },
    ])
    expect(p.missing).toEqual([])
  })

  it('names the metrics that are missing and shows a dash', () => {
    const r = result()
    r.summary.avg_sleep_hours = null
    r.summary.avg_hrv = null
    const p = buildPreview(r)
    expect(p.missing).toEqual(['sleep', 'HRV'])
    expect(p.cards.find((c) => c.label === 'Average sleep')?.value).toBe('–')
    expect(p.cards.find((c) => c.label === 'Average HRV')?.value).toBe('–')
  })

  it('returns the daily series in date order, with nulls kept', () => {
    const r = result()
    r.daily = {
      '2026-01-12': { ...r.daily['2026-09-30'], date: '2026-01-12', steps: 30, sleep_hours: null },
      '2026-01-10': { ...r.daily['2026-09-30'], date: '2026-01-10', steps: 10, sleep_hours: 7 },
    }
    const p = buildPreview(r)
    expect(p.steps).toEqual([10, 30])
    expect(p.sleep).toEqual([7, null])
  })

  it('shows a dash for the range when dates are unknown', () => {
    const r = result()
    r.stats.firstDate = null
    expect(buildPreview(r).range).toBe('–')
  })
})
