import type { UploadErrorInfo } from '../../lib/health/errors'
import { describeUploadError } from './errorMessages'

export function ErrorPanel({
  error,
  onRetry,
  onReset,
}: {
  error: UploadErrorInfo
  onRetry?: () => void
  onReset: () => void
}) {
  const text = describeUploadError(error.code)
  return (
    <div role="alert" className="upload-error">
      <h2>{text.title}</h2>
      <p>{text.hint}</p>
      <div className="actions">
        {text.retry && onRetry && (
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" onClick={onReset}>
          Choose a different file
        </button>
      </div>
    </div>
  )
}
