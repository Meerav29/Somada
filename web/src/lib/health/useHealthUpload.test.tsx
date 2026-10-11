import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FakeWorker } from '../../test/fakeWorker'
import { parseResultFixture } from '../../test/fixtures'
import { UploadError } from './errors'
import { useHealthUpload, type HealthUploadOptions } from './useHealthUpload'

const zipFile = (name = 'export.zip', content = 'x') => new File([content], name)

function setup(options: Partial<HealthUploadOptions> = {}) {
  const workers: FakeWorker[] = []
  const createWorker = vi.fn(() => {
    const w = new FakeWorker()
    workers.push(w)
    return w
  })
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useHealthUpload({ createWorker, ...options }), { wrapper })
  return { ...hook, workers, createWorker, invalidate }
}

describe('reading', () => {
  it('posts the file to a worker and reports progress', () => {
    const { result, workers } = setup()
    const file = zipFile()
    act(() => result.current.start(file))
    expect(workers).toHaveLength(1)
    expect(workers[0].posted).toEqual([{ type: 'parse', file }])
    expect(result.current.state).toMatchObject({ phase: 'reading', fileName: 'export.zip', fraction: 0 })
    act(() => workers[0].emit({ type: 'progress', fraction: 0.4, recordsSeen: 1200 }))
    expect(result.current.state).toMatchObject({ phase: 'reading', fraction: 0.4, recordsSeen: 1200 })
  })

  it('moves to parsed with the result and stops the worker', () => {
    const { result, workers } = setup()
    act(() => result.current.start(zipFile()))
    const parsed = parseResultFixture()
    act(() => workers[0].emit({ type: 'done', result: parsed }))
    expect(result.current.state).toEqual({ phase: 'parsed', fileName: 'export.zip', result: parsed })
    expect(workers[0].terminated).toBe(true)
  })

  it('maps a worker error message to an error state', () => {
    const { result, workers } = setup()
    act(() => result.current.start(zipFile()))
    act(() => workers[0].emit({ type: 'error', code: 'corrupt-file', message: 'bad' }))
    expect(result.current.state).toEqual({ phase: 'error', error: { code: 'corrupt-file', message: 'bad' } })
    expect(workers[0].terminated).toBe(true)
  })

  it.each(['onerror', 'onmessageerror'] as const)('treats %s as worker-failed', (handler) => {
    const { result, workers } = setup()
    act(() => result.current.start(zipFile()))
    act(() => {
      workers[0][handler]?.({} as never)
    })
    expect(result.current.state).toMatchObject({ phase: 'error', error: { code: 'worker-failed' } })
  })

  it('rejects the wrong file type and empty files without creating a worker', () => {
    const { result, createWorker } = setup()
    act(() => result.current.start(zipFile('notes.txt')))
    expect(result.current.state).toMatchObject({ phase: 'error', error: { code: 'wrong-file-type' } })
    act(() => result.current.start(zipFile('export.zip', '')))
    expect(result.current.state).toMatchObject({ phase: 'error', error: { code: 'empty-file' } })
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('accepts .ZIP and .XML in any case', () => {
    const { result, createWorker } = setup()
    act(() => result.current.start(zipFile('EXPORT.ZIP')))
    expect(createWorker).toHaveBeenCalledTimes(1)
    expect(result.current.state.phase).toBe('reading')
  })

  it('ignores a second file while a parse is running', () => {
    const { result, createWorker, workers } = setup()
    act(() => result.current.start(zipFile('a.zip')))
    act(() => result.current.start(zipFile('b.zip')))
    expect(createWorker).toHaveBeenCalledTimes(1)
    expect(result.current.state).toMatchObject({ phase: 'reading', fileName: 'a.zip' })
    expect(workers[0].posted).toHaveLength(1)
  })
})

describe('cancel and leaving the page', () => {
  it('reset terminates the worker, returns to idle and ignores late messages', () => {
    const { result, workers } = setup()
    act(() => result.current.start(zipFile()))
    act(() => result.current.reset())
    expect(workers[0].terminated).toBe(true)
    expect(result.current.state).toEqual({ phase: 'idle' })
    act(() => workers[0].emit({ type: 'done', result: parseResultFixture() }))
    expect(result.current.state).toEqual({ phase: 'idle' })
  })

  it('allows a new file after a reset', () => {
    const { result, createWorker } = setup()
    act(() => result.current.start(zipFile('a.zip')))
    act(() => result.current.reset())
    act(() => result.current.start(zipFile('b.zip')))
    expect(createWorker).toHaveBeenCalledTimes(2)
    expect(result.current.state).toMatchObject({ phase: 'reading', fileName: 'b.zip' })
  })

  it('terminates the worker when the component unmounts mid-parse', () => {
    const { result, workers, unmount } = setup()
    act(() => result.current.start(zipFile()))
    unmount()
    expect(workers[0].terminated).toBe(true)
  })
})

describe('saving', () => {
  function parsedHook(save: HealthUploadOptions['save']) {
    const ctx = setup({ save })
    act(() => ctx.result.current.start(zipFile()))
    act(() => ctx.workers[0].emit({ type: 'done', result: parseResultFixture() }))
    return ctx
  }

  it('saves the parsed result, marks saved and refreshes the health query', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const { result, invalidate } = parsedHook(save)
    await act(async () => {
      await result.current.save()
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(parseResultFixture())
    expect(result.current.state.phase).toBe('saved')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['health'] })
  })

  it('ignores a second Save click while a save is in flight', async () => {
    let release: () => void = () => {}
    const save = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const { result } = parsedHook(save)
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.save()
    })
    expect(result.current.state.phase).toBe('saving')
    await act(async () => {
      await result.current.save()
    })
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => {
      release()
      await first
    })
    expect(result.current.state.phase).toBe('saved')
  })

  it('keeps the parsed result after a failed save so Retry does not re-parse', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new UploadError('save-failed', 'network'))
      .mockResolvedValueOnce(undefined)
    const { result, createWorker } = parsedHook(save)
    await act(async () => {
      await result.current.save()
    })
    expect(result.current.state).toMatchObject({
      phase: 'error',
      error: { code: 'save-failed' },
      result: parseResultFixture(),
    })
    await act(async () => {
      await result.current.save()
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.state.phase).toBe('saved')
    expect(createWorker).toHaveBeenCalledTimes(1)
  })

  it('preserves the error code of a session-expired save', async () => {
    const save = vi.fn().mockRejectedValue(new UploadError('session-expired', 'jwt'))
    const { result } = parsedHook(save)
    await act(async () => {
      await result.current.save()
    })
    expect(result.current.state).toMatchObject({ phase: 'error', error: { code: 'session-expired' } })
  })

  it('wraps unexpected save failures as save-failed', async () => {
    const save = vi.fn().mockRejectedValue(new Error('weird'))
    const { result } = parsedHook(save)
    await act(async () => {
      await result.current.save()
    })
    expect(result.current.state).toMatchObject({ phase: 'error', error: { code: 'save-failed', message: 'weird' } })
  })

  it('does nothing when there is no parsed result', async () => {
    const save = vi.fn()
    const { result } = setup({ save })
    await act(async () => {
      await result.current.save()
    })
    expect(save).not.toHaveBeenCalled()
    expect(result.current.state).toEqual({ phase: 'idle' })
  })
})
