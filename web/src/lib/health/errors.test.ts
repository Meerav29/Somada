import { describe, expect, it } from 'vitest'
import { toWorkerError, UploadError } from './errors'

describe('toWorkerError', () => {
  it('keeps the code and message of an UploadError', () => {
    expect(toWorkerError(new UploadError('zip-missing-export', 'x'))).toEqual({
      code: 'zip-missing-export',
      message: 'x',
    })
  })

  it('reports an unexpected Error (e.g. out of memory) as worker-failed', () => {
    expect(toWorkerError(new RangeError('Invalid string length'))).toEqual({
      code: 'worker-failed',
      message: 'Invalid string length',
    })
  })

  it('reports a thrown string as worker-failed', () => {
    expect(toWorkerError('kaboom')).toEqual({ code: 'worker-failed', message: 'kaboom' })
  })

  it('reports null as worker-failed', () => {
    expect(toWorkerError(null)).toEqual({ code: 'worker-failed', message: 'null' })
  })
})
