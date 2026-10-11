import type { UploadErrorCode } from './errors'
import type { ParseResult } from './types'

export type WorkerRequest = { type: 'parse'; file: File }

export type WorkerMessage =
  | { type: 'progress'; fraction: number; recordsSeen: number }
  | { type: 'done'; result: ParseResult }
  | { type: 'error'; code: UploadErrorCode; message: string }

/** The part of Worker the hook uses; tests substitute a fake. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void
  terminate(): void
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
}
