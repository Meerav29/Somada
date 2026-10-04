import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createParseWorker } from './createParseWorker'
import { UploadError, type UploadErrorInfo } from './errors'
import { saveForCurrentUser } from './repository'
import type { ParseResult } from './types'
import type { WorkerLike } from './worker-protocol'

export type UploadState =
  | { phase: 'idle' }
  | { phase: 'reading'; fileName: string; fraction: number; recordsSeen: number; startedAt: number }
  | { phase: 'parsed'; fileName: string; result: ParseResult }
  | { phase: 'saving'; fileName: string; result: ParseResult }
  | { phase: 'saved'; fileName: string; result: ParseResult }
  | { phase: 'error'; error: UploadErrorInfo; fileName?: string; result?: ParseResult }

export interface HealthUploadOptions {
  createWorker?: () => WorkerLike
  save?: (result: ParseResult) => Promise<void>
}

function validateFile(file: File): UploadErrorInfo | null {
  if (!/\.(zip|xml)$/i.test(file.name)) {
    return { code: 'wrong-file-type', message: `Unsupported file: ${file.name}` }
  }
  if (file.size === 0) return { code: 'empty-file', message: `${file.name} is empty` }
  return null
}

function toErrorInfo(e: unknown, fallback: UploadErrorInfo['code']): UploadErrorInfo {
  if (e instanceof UploadError) return { code: e.code, message: e.message }
  return { code: fallback, message: e instanceof Error ? e.message : String(e) }
}

export function useHealthUpload({
  createWorker = createParseWorker,
  save = saveForCurrentUser,
}: HealthUploadOptions = {}) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<UploadState>({ phase: 'idle' })
  const workerRef = useRef<WorkerLike | null>(null)
  const parsedRef = useRef<{ fileName: string; result: ParseResult } | null>(null)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopWorker()
    }
  }, [stopWorker])

  const start = useCallback(
    (file: File) => {
      if (workerRef.current) return // a parse is already running
      const invalid = validateFile(file)
      if (invalid) {
        setState({ phase: 'error', error: invalid })
        return
      }
      parsedRef.current = null
      const worker = createWorker()
      workerRef.current = worker
      const fail = (error: UploadErrorInfo) => {
        if (workerRef.current !== worker) return
        stopWorker()
        setState({ phase: 'error', error })
      }
      worker.onmessage = (event) => {
        if (workerRef.current !== worker) return // stale worker (cancelled or replaced)
        const message = event.data
        if (message.type === 'progress') {
          setState((s) =>
            s.phase === 'reading' ? { ...s, fraction: message.fraction, recordsSeen: message.recordsSeen } : s,
          )
        } else if (message.type === 'done') {
          stopWorker()
          parsedRef.current = { fileName: file.name, result: message.result }
          setState({ phase: 'parsed', fileName: file.name, result: message.result })
        } else {
          fail({ code: message.code, message: message.message })
        }
      }
      worker.onerror = () => fail({ code: 'worker-failed', message: 'The parser crashed' })
      worker.onmessageerror = () => fail({ code: 'worker-failed', message: 'The parser sent an unreadable message' })
      setState({ phase: 'reading', fileName: file.name, fraction: 0, recordsSeen: 0, startedAt: Date.now() })
      worker.postMessage({ type: 'parse', file })
    },
    [createWorker, stopWorker],
  )

  const reset = useCallback(() => {
    stopWorker()
    parsedRef.current = null
    setState({ phase: 'idle' })
  }, [stopWorker])

  const saveParsed = useCallback(async () => {
    const parsed = parsedRef.current
    if (!parsed || savingRef.current) return
    savingRef.current = true
    setState({ phase: 'saving', ...parsed })
    try {
      await save(parsed.result)
      void queryClient.invalidateQueries({ queryKey: ['health'] })
      if (mountedRef.current) setState({ phase: 'saved', ...parsed })
    } catch (e) {
      if (mountedRef.current) setState({ phase: 'error', error: toErrorInfo(e, 'save-failed'), ...parsed })
    } finally {
      savingRef.current = false
    }
  }, [queryClient, save])

  return { state, start, save: saveParsed, reset }
}
