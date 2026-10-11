import type { ParseResult } from '../../lib/health/types'
import { buildPreview } from './preview'
import { Sparkline } from './Sparkline'

export function PreviewPanel({
  result,
  existing,
  saving,
  saveDisabledReason,
  onSave,
  onChooseAnother,
}: {
  result: ParseResult
  existing: { days: number; lastDate: string | null } | null
  saving: boolean
  saveDisabledReason: string | null
  onSave: () => void
  onChooseAnother: () => void
}) {
  const preview = buildPreview(result)
  return (
    <section>
      <h2>Here's what we found</h2>
      <p>
        {preview.days} days of data · <span>{preview.range}</span>
      </p>
      <ul className="cards">
        {preview.cards.map((card) => (
          <li key={card.label}>
            <span className="muted">{card.label}</span>
            <strong>{card.value}</strong>
          </li>
        ))}
      </ul>
      {preview.missing.map((name) => (
        <p key={name} className="muted">
          No {name} data found in this export.
        </p>
      ))}
      <div className="sparklines">
        <Sparkline values={preview.steps} label="Steps trend" />
        <Sparkline values={preview.sleep} label="Sleep trend" />
      </div>
      {existing && (
        <p role="note" className="demo-banner">
          This replaces your current data ({existing.days} days
          {existing.lastDate ? `, through ${existing.lastDate}` : ''}). Your life events are kept.
        </p>
      )}
      <p className="muted">Nothing has been saved yet.</p>
      {saveDisabledReason && <p className="muted">{saveDisabledReason}</p>}
      <div className="actions">
        <button type="button" onClick={onSave} disabled={saving || saveDisabledReason !== null}>
          {saving ? 'Saving…' : 'Save to my account'}
        </button>
        <button type="button" onClick={onChooseAnother} disabled={saving}>
          Choose a different file
        </button>
      </div>
    </section>
  )
}
