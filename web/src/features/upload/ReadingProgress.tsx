import { useEffect, useState } from 'react'

export function ReadingProgress({
  fileName,
  fraction,
  recordsSeen,
  startedAt,
  onCancel,
}: {
  fileName: string
  fraction: number
  recordsSeen: number
  startedAt: number
  onCancel: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))

  return (
    <section aria-live="polite">
      <h2>Reading {fileName}</h2>
      <div
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="progress"
      >
        <div className="progress-bar" style={{ width: `${percent}%` }} />
      </div>
      <p className="muted">
        {percent}% · {recordsSeen.toLocaleString('en-US')} records · {seconds}s elapsed
      </p>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </section>
  )
}
