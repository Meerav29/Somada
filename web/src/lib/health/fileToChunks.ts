import { Unzip, UnzipInflate } from 'fflate'
import { UploadError } from './errors'

/** What the parser needs from a File; a real File satisfies it, tests pass small fakes. */
export interface ChunkableFile {
  name: string
  size: number
  stream(): ReadableStream<Uint8Array>
}

/**
 * True for the entry that holds the health records: the first `.xml` whose name has no "cda"
 * (so `export.xml` and its localized variants, but not `export_cda.xml`) and is not macOS
 * resource-fork junk. Entry sizes are unknown up front in a streamed ZIP, so this is name-only.
 */
export function isHealthXmlEntry(name: string): boolean {
  if (name.endsWith('/')) return false
  const lower = name.toLowerCase()
  if (lower.startsWith('__macosx/') || lower.includes('/__macosx/')) return false
  const base = lower.slice(lower.lastIndexOf('/') + 1)
  if (base.startsWith('.')) return false
  return base.endsWith('.xml') && !base.includes('cda')
}

async function* xmlChunks(
  file: ChunkableFile,
  onSourceBytes: (cumulativeBytes: number) => void,
): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader()
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      total += value.length
      onSourceBytes(total)
      yield value
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

async function* zipChunks(
  file: ChunkableFile,
  onSourceBytes: (cumulativeBytes: number) => void,
): AsyncGenerator<Uint8Array> {
  const queue: Uint8Array[] = []
  const state = { selected: false, finished: false, failure: null as unknown }

  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.onfile = (entry) => {
    if (state.selected || !isHealthXmlEntry(entry.name)) return // skipped entries are never started
    state.selected = true
    entry.ondata = (err, data, final) => {
      if (err) {
        state.failure = err
        return
      }
      if (data.length > 0) queue.push(data)
      if (final) state.finished = true
    }
    entry.start()
  }

  const reader = file.stream().getReader()
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      try {
        if (done) {
          unzip.push(new Uint8Array(0), true)
        } else {
          total += value.length
          unzip.push(value)
        }
      } catch (e) {
        throw new UploadError('corrupt-file', e instanceof Error ? e.message : String(e))
      }
      if (!done) onSourceBytes(total)
      if (state.failure) {
        throw new UploadError(
          'corrupt-file',
          state.failure instanceof Error ? state.failure.message : String(state.failure),
        )
      }
      while (queue.length > 0) {
        const next = queue.shift()
        if (next) yield next
      }
      if (state.finished || done) break
    }
    if (!state.selected) {
      throw new UploadError('zip-missing-export', 'No export.xml found in the ZIP')
    }
    if (!state.finished) {
      throw new UploadError('corrupt-file', 'The ZIP ends before export.xml is complete')
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/**
 * The XML bytes of an Apple Health export, from `export.xml` directly or from inside
 * `export.zip`. `onSourceBytes` receives the cumulative bytes consumed from the file itself.
 */
export async function* fileToChunks(
  file: ChunkableFile,
  onSourceBytes: (cumulativeBytes: number) => void,
): AsyncGenerator<Uint8Array> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xml')) yield* xmlChunks(file, onSourceBytes)
  else if (name.endsWith('.zip')) yield* zipChunks(file, onSourceBytes)
  else throw new UploadError('wrong-file-type', `Unsupported file: ${file.name}`)
}
