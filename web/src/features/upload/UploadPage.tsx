import { Link } from 'react-router-dom'
import type { HealthData } from '../../lib/health/types'
import { useHealthQuery } from '../../lib/health/useHealthQuery'
import { useHealthUpload, type HealthUploadOptions } from '../../lib/health/useHealthUpload'
import { useAuth } from '../../lib/supabase/auth'
import { DropZone } from './DropZone'
import { ErrorPanel } from './ErrorPanel'
import { ExportGuide } from './ExportGuide'
import { PreviewPanel } from './PreviewPanel'
import { ReadingProgress } from './ReadingProgress'

/** What a re-upload would replace: null when the user has no data of their own (none, or the demo). */
export function ownDataSummary(
  data: HealthData | null | undefined,
): { days: number; lastDate: string | null } | null {
  if (!data || data.is_demo) return null
  const dates = Object.keys(data.daily).sort()
  return { days: data.summary.total_days, lastDate: dates.at(-1) ?? null }
}

export function UploadPage(options: HealthUploadOptions = {}) {
  const { status } = useAuth()
  const health = useHealthQuery()
  const upload = useHealthUpload(options)
  const { state } = upload
  const saveDisabledReason =
    status === 'unconfigured' ? "Saving isn't available in local mode (Supabase isn't configured)." : null

  return (
    <section className="upload-page">
      <h1>Upload your Apple Health export</h1>

      {state.phase === 'idle' && (
        <>
          <ExportGuide />
          <DropZone onFile={upload.start} />
        </>
      )}

      {state.phase === 'reading' && (
        <ReadingProgress
          fileName={state.fileName}
          fraction={state.fraction}
          recordsSeen={state.recordsSeen}
          startedAt={state.startedAt}
          onCancel={upload.reset}
        />
      )}

      {(state.phase === 'parsed' || state.phase === 'saving') && (
        <PreviewPanel
          result={state.result}
          existing={ownDataSummary(health.data)}
          saving={state.phase === 'saving'}
          saveDisabledReason={saveDisabledReason}
          onSave={() => void upload.save()}
          onChooseAnother={upload.reset}
        />
      )}

      {state.phase === 'saved' && (
        <div role="status">
          <h2>Your data is saved</h2>
          <p>{state.result.summary.total_days} days of data are now in your account.</p>
          <p>
            <Link to="/">Go to dashboard</Link>
          </p>
        </div>
      )}

      {state.phase === 'error' && (
        <ErrorPanel
          error={state.error}
          onRetry={state.result ? () => void upload.save() : undefined}
          onReset={upload.reset}
        />
      )}
    </section>
  )
}
