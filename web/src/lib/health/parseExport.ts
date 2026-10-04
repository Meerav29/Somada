import { UploadError } from './errors'
import { METRIC_BY_TYPE, RETENTION_MONTHS, SLEEP_ASLEEP } from './metrics'
import { computeSummaryStats } from './summary'
import type { DailyEntry, ParseResult } from './types'

export interface ParseProgress {
  recordsSeen: number
  xmlBytes: number
}

export interface ParseOptions {
  onProgress?: (progress: ParseProgress) => void
  /** Injectable clock for the retention cutoff (tests). */
  now?: Date
  retentionMonths?: number
}

// Quote-aware: a ">" inside a quoted attribute value does not end the tag.
const RECORD_RE = /<Record\b((?:[^>"]|"[^"]*")*)>/g
const ATTR_TYPE = /\stype="([^"]*)"/
const ATTR_START = /\sstartDate="([^"]*)"/
const ATTR_END = /\sendDate="([^"]*)"/
const ATTR_VALUE = /\svalue="([^"]*)"/
const RECORD_OPEN = '<Record'
const CLOSING_TAG = '</HealthData>'
const MAX_CARRY_CHARS = 1_000_000
const HEADER_CHARS = 65_536

interface DayAcc {
  steps: number
  stepsN: number
  hrSum: number
  hrN: number
  hrMin: number
  hrMax: number
  restSum: number
  restN: number
  hrvSum: number
  hrvN: number
  sleepMinutes: number
  calSum: number
  calN: number
  exSum: number
  exN: number
  o2Sum: number
  o2N: number
}

function newDay(): DayAcc {
  return {
    steps: 0,
    stepsN: 0,
    hrSum: 0,
    hrN: 0,
    hrMin: Infinity,
    hrMax: -Infinity,
    restSum: 0,
    restN: 0,
    hrvSum: 0,
    hrvN: 0,
    sleepMinutes: 0,
    calSum: 0,
    calN: 0,
    exSum: 0,
    exN: 0,
    o2Sum: 0,
    o2N: 0,
  }
}

function toEntry(date: string, d: DayAcc): DailyEntry {
  const avg = (sum: number, n: number, digits: number) => (n ? +(sum / n).toFixed(digits) : null)
  return {
    date,
    steps: d.stepsN ? Math.round(d.steps) : null,
    heart_rate_avg: avg(d.hrSum, d.hrN, 1),
    heart_rate_min: d.hrN ? +d.hrMin.toFixed(1) : null,
    heart_rate_max: d.hrN ? +d.hrMax.toFixed(1) : null,
    resting_hr: avg(d.restSum, d.restN, 1),
    hrv: avg(d.hrvSum, d.hrvN, 1),
    sleep_hours: d.sleepMinutes > 0 ? +(d.sleepMinutes / 60).toFixed(2) : null,
    active_calories: d.calN ? Math.round(d.calSum) : null,
    exercise_minutes: d.exN ? Math.round(d.exSum) : null,
    spo2: avg(d.o2Sum, d.o2N, 1),
  }
}

/** First capture group of `re` in `attrs`, or null. */
function attr(re: RegExp, attrs: string): string | null {
  const m = re.exec(attrs)
  return m ? m[1] : null
}

// "2026-01-12 08:00:00 -0500" -> local time of the first 19 characters. The "T" makes this
// parse the same way in every browser (Safari rejects the space-separated form).
const localMs = (stamp: string) => new Date(stamp.slice(0, 19).replace(' ', 'T')).getTime()

export function retentionCutoff(now: Date, months: number): string {
  const cutoff = new Date(now.getTime())
  cutoff.setMonth(cutoff.getMonth() - months)
  return cutoff.toISOString().slice(0, 10)
}

/** Returns true when the record belongs to a known metric inside the retention window. */
function addRecord(days: Map<string, DayAcc>, attrs: string, cutoff: string): boolean {
  const type = attr(ATTR_TYPE, attrs)
  const metric = type === null ? undefined : METRIC_BY_TYPE.get(type)
  if (!metric) return false
  const startDate = attr(ATTR_START, attrs)
  if (!startDate) return false
  const dateKey = startDate.slice(0, 10)
  if (dateKey < cutoff) return false

  // The classic parser creates the day before reading the value, so a day exists even when
  // only a respiratory-rate, walking-HR or non-asleep sleep record is present.
  let day = days.get(dateKey)
  if (!day) {
    day = newDay()
    days.set(dateKey, day)
  }

  if (metric === 'sleep') {
    const value = attr(ATTR_VALUE, attrs)
    const endDate = attr(ATTR_END, attrs)
    if (value !== null && SLEEP_ASLEEP.has(value) && endDate) {
      const minutes = (localMs(endDate) - localMs(startDate)) / 60000
      if (minutes > 0 && minutes < 720) day.sleepMinutes += minutes
    }
    return true
  }

  const value = parseFloat(attr(ATTR_VALUE, attrs) ?? '')
  if (Number.isNaN(value)) return true
  switch (metric) {
    case 'steps':
      day.steps += value
      day.stepsN++
      break
    case 'heart_rate':
      day.hrSum += value
      day.hrN++
      day.hrMin = Math.min(day.hrMin, value)
      day.hrMax = Math.max(day.hrMax, value)
      break
    case 'resting_heart_rate':
      day.restSum += value
      day.restN++
      break
    case 'hrv':
      day.hrvSum += value
      day.hrvN++
      break
    case 'active_calories':
      day.calSum += value
      day.calN++
      break
    case 'exercise_minutes':
      day.exSum += value
      day.exN++
      break
    case 'spo2':
      day.o2Sum += value
      day.o2N++
      break
    default:
      // respiratory_rate and walking_hr are never saved (classic parser parity).
      break
  }
  return true
}

export async function parseExport(
  chunks: AsyncIterable<Uint8Array>,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const cutoff = retentionCutoff(options.now ?? new Date(), options.retentionMonths ?? RETENTION_MONTHS)
  const decoder = new TextDecoder('utf-8')
  const days = new Map<string, DayAcc>()
  let carry = ''
  let head = ''
  let headerChecked = false
  let tail = ''
  let recordsSeen = 0
  let recordsKept = 0
  let xmlBytes = 0
  let maxCarry = 0

  const checkHeader = () => {
    headerChecked = true
    if (!head.includes('<HealthData')) {
      throw new UploadError('not-health-export', 'The file has no <HealthData> root element')
    }
  }

  /** Process every complete <Record> in `text`; return the unfinished tail to carry forward. */
  const scan = (text: string): string => {
    RECORD_RE.lastIndex = 0
    let lastEnd = 0
    for (let m = RECORD_RE.exec(text); m !== null; m = RECORD_RE.exec(text)) {
      lastEnd = RECORD_RE.lastIndex
      recordsSeen++
      if (addRecord(days, m[1], cutoff)) recordsKept++
    }
    const rest = text.slice(lastEnd)
    const open = rest.indexOf(RECORD_OPEN)
    // Keep from an unfinished "<Record", or the last few characters in case "<Record" is split.
    const keep = open >= 0 ? rest.slice(open) : rest.slice(Math.max(0, rest.length - RECORD_OPEN.length))
    if (keep.length > MAX_CARRY_CHARS) {
      throw new UploadError('corrupt-file', 'A <Record> tag never ends')
    }
    maxCarry = Math.max(maxCarry, keep.length)
    return keep
  }

  const ingest = (text: string) => {
    if (!headerChecked) {
      head += text
      if (head.length >= HEADER_CHARS) checkHeader()
    }
    tail = (tail + text).slice(-32)
    carry = scan(carry + text)
  }

  for await (const chunk of chunks) {
    xmlBytes += chunk.length
    ingest(decoder.decode(chunk, { stream: true }))
    options.onProgress?.({ recordsSeen, xmlBytes })
  }
  const flushed = decoder.decode()
  if (flushed) ingest(flushed)

  if (!headerChecked) checkHeader()
  if (!tail.includes(CLOSING_TAG)) {
    throw new UploadError('corrupt-file', 'The file ends before </HealthData>')
  }
  if (days.size === 0) {
    throw new UploadError('no-usable-records', 'No known health records inside the retention window')
  }

  const daily: Record<string, DailyEntry> = {}
  const sorted = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  for (const [date, acc] of sorted) daily[date] = toEntry(date, acc)
  const dates = sorted.map(([date]) => date)

  return {
    daily,
    summary: computeSummaryStats(Object.values(daily)),
    stats: {
      recordsSeen,
      recordsKept,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      bytesRead: xmlBytes,
      maxCarryBytes: maxCarry,
    },
  }
}
