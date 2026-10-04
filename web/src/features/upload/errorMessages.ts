import type { UploadErrorCode } from '../../lib/health/errors'

export interface ErrorText {
  title: string
  hint: string
  retry: boolean
}

const MESSAGES: Record<UploadErrorCode, ErrorText> = {
  'wrong-file-type': {
    title: "That isn't an Apple Health export",
    hint: "Choose Apple's export.zip (or the export.xml inside it).",
    retry: false,
  },
  'empty-file': {
    title: 'That file is empty',
    hint: 'Try exporting again from the Health app and make sure the transfer finished.',
    retry: false,
  },
  'zip-missing-export': {
    title: "We couldn't find export.xml in that ZIP",
    hint: 'Make sure it is the ZIP the Health app exported, not another archive.',
    retry: false,
  },
  'not-health-export': {
    title: "That doesn't look like an Apple Health export",
    hint: 'The file has no Health data in it. Choose the export.xml from your Health export.',
    retry: false,
  },
  'corrupt-file': {
    title: 'The file looks damaged or incomplete',
    hint: 'Export again from the Health app and make sure the transfer finished before uploading.',
    retry: false,
  },
  'no-usable-records': {
    title: 'No usable data found',
    hint: 'We found no steps, sleep, heart-rate or similar data from the last 18 months in this export.',
    retry: false,
  },
  'worker-failed': {
    title: 'Something went wrong while reading the file',
    hint: 'It may be too large for this browser. Try again, or use a desktop browser.',
    retry: false,
  },
  'save-failed': {
    title: "We couldn't save your data",
    hint: 'Check your connection and try again. Your file does not need to be read again.',
    retry: true,
  },
  'session-expired': {
    title: 'Your session expired',
    hint: 'Sign in again, then upload your export again.',
    retry: false,
  },
  'not-configured': {
    title: "Saving isn't available here",
    hint: 'This environment has no database configured.',
    retry: false,
  },
}

export function describeUploadError(code: UploadErrorCode): ErrorText {
  return MESSAGES[code]
}
