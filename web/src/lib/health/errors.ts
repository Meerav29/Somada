export const UPLOAD_ERROR_CODES = [
  'wrong-file-type',
  'empty-file',
  'zip-missing-export',
  'not-health-export',
  'corrupt-file',
  'no-usable-records',
  'worker-failed',
  'save-failed',
  'session-expired',
  'not-configured',
] as const

export type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[number]

export interface UploadErrorInfo {
  code: UploadErrorCode
  /** Technical detail for debugging; the UI shows its own wording per code. */
  message: string
}

export class UploadError extends Error {
  readonly code: UploadErrorCode

  constructor(code: UploadErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'UploadError'
    this.code = code
  }
}
