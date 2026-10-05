import { describe, expect, it } from 'vitest'
import { UPLOAD_ERROR_CODES } from '../../lib/health/errors'
import { describeUploadError } from './errorMessages'

describe('describeUploadError', () => {
  it.each(UPLOAD_ERROR_CODES)('has a title and hint for %s', (code) => {
    const text = describeUploadError(code)
    expect(text.title.length).toBeGreaterThan(0)
    expect(text.hint.length).toBeGreaterThan(0)
  })

  it('offers retry only for save-failed', () => {
    const retryable = UPLOAD_ERROR_CODES.filter((code) => describeUploadError(code).retry)
    expect(retryable).toEqual(['save-failed'])
  })

  it('never promises a Try again button for a code that has none', () => {
    for (const code of UPLOAD_ERROR_CODES) {
      const text = describeUploadError(code)
      if (!text.retry) expect(text.hint).not.toMatch(/try again/i)
    }
  })
})
