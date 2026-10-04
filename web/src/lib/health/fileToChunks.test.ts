// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Zip, ZipDeflate, strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chunkedFile } from './__fixtures__/files'
import { fileToChunks, isHealthXmlEntry, type ChunkableFile } from './fileToChunks'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function collect(iterable: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of iterable) text += decoder.decode(chunk, { stream: true })
  return text + decoder.decode()
}

const XML = '<HealthData locale="en_US"><Record type="x"/></HealthData>'
const noop = () => {}

describe('ChunkableFile', () => {
  it('is satisfied by a real File', () => {
    const real: ChunkableFile = new File(['x'], 'a.xml')
    expect(real.name).toBe('a.xml')
  })
})

describe('isHealthXmlEntry', () => {
  it.each([
    ['apple_health_export/export.xml', true],
    ['export.xml', true],
    ['Export.XML', true],
    ['导出.xml', true],
    ['apple_health_export/export_cda.xml', false],
    ['导出_cda.xml', false],
    ['__MACOSX/apple_health_export/._export.xml', false],
    ['apple_health_export/._export.xml', false],
    ['apple_health_export/workout-routes/route.gpx', false],
    ['apple_health_export/', false],
  ])('%s -> %s', (name, expected) => {
    expect(isHealthXmlEntry(name)).toBe(expected)
  })
})

describe('fileToChunks with .xml files', () => {
  it('yields the file contents and reports bytes read', async () => {
    const bytes = strToU8(XML)
    const seen: number[] = []
    const text = await collect(fileToChunks(chunkedFile('export.xml', bytes, 7), (n) => seen.push(n)))
    expect(text).toBe(XML)
    expect(seen.at(-1)).toBe(bytes.length)
  })

  it('rejects other file types', async () => {
    const file = chunkedFile('notes.txt', strToU8('hello'), 10)
    await expect(collect(fileToChunks(file, noop))).rejects.toMatchObject({ code: 'wrong-file-type' })
  })
})

describe('fileToChunks with .zip files', () => {
  it('extracts export.xml and ignores export_cda.xml', async () => {
    const zip = zipSync({
      'apple_health_export/export_cda.xml': strToU8('<ClinicalDocument/>'),
      'apple_health_export/export.xml': strToU8(XML),
      'apple_health_export/workout-routes/route.gpx': strToU8('<gpx/>'),
    })
    for (const size of [1, 13, 4096]) {
      const text = await collect(fileToChunks(chunkedFile('export.zip', zip, size), noop))
      expect(text).toBe(XML)
    }
  })

  it('finds a localized export file name', async () => {
    const zip = zipSync({ '导出.xml': strToU8(XML), '导出_cda.xml': strToU8('<c/>') })
    expect(await collect(fileToChunks(chunkedFile('export.zip', zip, 50), noop))).toBe(XML)
  })

  it('ignores macOS resource-fork entries', async () => {
    const zip = zipSync({
      '__MACOSX/apple_health_export/._export.xml': strToU8('binary junk'),
      'apple_health_export/export.xml': strToU8(XML),
    })
    expect(await collect(fileToChunks(chunkedFile('export.zip', zip, 50), noop))).toBe(XML)
  })

  it('reports progress as bytes of the ZIP consumed', async () => {
    const zip = zipSync({ 'export.xml': strToU8(XML) })
    const seen: number[] = []
    await collect(fileToChunks(chunkedFile('export.zip', zip, 10), (n) => seen.push(n)))
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.at(-1)).toBeLessThanOrEqual(zip.length)
  })

  it('rejects a ZIP with no export.xml', async () => {
    const zip = zipSync({ 'readme.txt': strToU8('hi'), 'a/route.gpx': strToU8('<gpx/>') })
    await expect(collect(fileToChunks(chunkedFile('export.zip', zip, 20), noop))).rejects.toMatchObject({
      code: 'zip-missing-export',
    })
  })

  it('rejects a truncated ZIP', async () => {
    const big = strToU8(XML + ' '.repeat(5000))
    const zip = zipSync({ 'export.xml': [big, { level: 0 }] })
    const truncated = zip.slice(0, Math.floor(zip.length / 2))
    await expect(collect(fileToChunks(chunkedFile('export.zip', truncated, 100), noop))).rejects.toMatchObject({
      code: 'corrupt-file',
    })
  })

  it('rejects bytes that are not a ZIP at all', async () => {
    const junk = strToU8('this is definitely not a zip file '.repeat(10))
    await expect(collect(fileToChunks(chunkedFile('export.zip', junk, 16), noop))).rejects.toMatchObject({
      code: expect.stringMatching(/zip-missing-export|corrupt-file/),
    })
  })

  it('handles a streamed ZIP whose sizes are in a data descriptor', async () => {
    const parts: Uint8Array[] = []
    const zip = new Zip((err, chunk) => {
      if (err) throw err
      parts.push(chunk)
    })
    const entry = new ZipDeflate('apple_health_export/export.xml')
    zip.add(entry)
    entry.push(strToU8(XML), true)
    zip.end()
    expect(parts.length).toBeGreaterThan(0)
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const p of parts) {
      bytes.set(p, offset)
      offset += p.length
    }
    expect(await collect(fileToChunks(chunkedFile('export.zip', bytes, 9), noop))).toBe(XML)
  })

  it.each(['zip64-seekable.zip', 'zip64-streamed.zip'])('handles the ZIP64 fixture %s', async (name) => {
    const bytes = new Uint8Array(
      readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))),
    )
    const text = await collect(fileToChunks(chunkedFile('export.zip', bytes, 7), noop))
    expect(text).toContain('<HealthData')
    expect(text).toContain('HKQuantityTypeIdentifierStepCount')
  })

  it('makes no network calls', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('network call while reading a file')
    })
    const zip = zipSync({ 'export.xml': strToU8(XML) })
    await expect(collect(fileToChunks(chunkedFile('export.zip', zip, 20), noop))).resolves.toBe(XML)
  })
})
