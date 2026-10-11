// @vitest-environment node
// Documents (and guards) what the upload parser assumes about fflate's streaming Unzip.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Unzip, UnzipInflate } from 'fflate'
import { describe, expect, it } from 'vitest'

const ENTRY = 'apple_health_export/export.xml'
const PAYLOAD =
  '<HealthData locale="en_US"><Record type="HKQuantityTypeIdentifierStepCount" ' +
  'startDate="2026-01-12 08:00:00 -0500" value="1"/></HealthData>'

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))))
}

/** Feed `zip` to a streaming Unzip in `chunkSize` pieces, finishing either with the last real chunk or an empty one. */
function extract(zip: Uint8Array, chunkSize: number, emptyFinal: boolean) {
  const decoder = new TextDecoder()
  const names: string[] = []
  let text = ''
  let finished = false
  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.onfile = (entry) => {
    names.push(entry.name)
    entry.ondata = (err, data, final) => {
      if (err) throw err
      text += decoder.decode(data, { stream: !final })
      if (final) finished = true
    }
    entry.start()
  }
  for (let i = 0; i < zip.length; i += chunkSize) {
    const last = i + chunkSize >= zip.length
    unzip.push(zip.slice(i, i + chunkSize), last && !emptyFinal)
  }
  if (emptyFinal) unzip.push(new Uint8Array(0), true)
  return { names, text, finished }
}

const cases = ['zip64-seekable.zip', 'zip64-streamed.zip'].flatMap((name) =>
  [1, 7, 4096].flatMap((size) =>
    [false, true].map((emptyFinal) => [name, size, emptyFinal] as const),
  ),
)

describe('fflate streaming Unzip', () => {
  it.each(cases)('extracts %s in %i-byte chunks (emptyFinal=%s)', (name, size, emptyFinal) => {
    const result = extract(fixture(name), size, emptyFinal)
    expect(result.names).toEqual([ENTRY])
    expect(result.finished).toBe(true)
    expect(result.text).toBe(PAYLOAD)
  })
})
