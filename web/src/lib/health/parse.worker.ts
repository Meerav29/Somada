import { toWorkerError } from './errors'
import { fileToChunks } from './fileToChunks'
import { parseExport } from './parseExport'
import type { WorkerMessage, WorkerRequest } from './worker-protocol'

// Typed locally: the DOM lib (used by the rest of the app) and the WebWorker lib cannot be mixed.
interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerMessage): void
}
const scope = self as unknown as WorkerScope

const PROGRESS_INTERVAL_MS = 100

async function run(file: File): Promise<void> {
  let sourceBytes = 0
  let lastPost = 0
  const progress = (recordsSeen: number) => {
    const now = performance.now()
    if (now - lastPost < PROGRESS_INTERVAL_MS) return
    lastPost = now
    const fraction = file.size > 0 ? Math.min(1, sourceBytes / file.size) : 0
    scope.postMessage({ type: 'progress', fraction, recordsSeen })
  }
  try {
    const chunks = fileToChunks(file, (bytes) => {
      sourceBytes = bytes
    })
    const result = await parseExport(chunks, { onProgress: ({ recordsSeen }) => progress(recordsSeen) })
    scope.postMessage({ type: 'done', result })
  } catch (e) {
    const { code, message } = toWorkerError(e)
    scope.postMessage({ type: 'error', code, message })
  }
}

scope.onmessage = (event) => {
  void run(event.data.file)
}
