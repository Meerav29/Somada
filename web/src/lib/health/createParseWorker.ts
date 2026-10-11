import type { WorkerLike } from './worker-protocol'

export function createParseWorker(): WorkerLike {
  return new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })
}
