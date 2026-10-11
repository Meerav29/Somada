import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { parseResultFixture } from '../../test/fixtures'
import { PreviewPanel } from './PreviewPanel'

function props(overrides: Partial<Parameters<typeof PreviewPanel>[0]> = {}) {
  return {
    result: parseResultFixture(),
    existing: null,
    saving: false,
    saveDisabledReason: null,
    onSave: vi.fn(),
    onChooseAnother: vi.fn(),
    ...overrides,
  }
}

describe('PreviewPanel', () => {
  it('shows what was found', () => {
    render(<PreviewPanel {...props()} />)
    expect(screen.getByText(/120 days/)).toBeInTheDocument()
    expect(screen.getByText('2026-06-03 to 2026-09-30')).toBeInTheDocument()
    expect(screen.getByText('Average steps')).toBeInTheDocument()
    expect(screen.getByText('Nothing has been saved yet.')).toBeInTheDocument()
  })

  it('names missing metrics', () => {
    const p = props()
    p.result.summary.avg_sleep_hours = null
    render(<PreviewPanel {...p} />)
    expect(screen.getByText('No sleep data found in this export.')).toBeInTheDocument()
  })

  it('warns that saving replaces existing data and keeps events', () => {
    render(<PreviewPanel {...props({ existing: { days: 300, lastDate: '2026-09-01' } })} />)
    expect(
      screen.getByText(
        'This replaces your current data (300 days, through 2026-09-01). Your life events are kept.',
      ),
    ).toBeInTheDocument()
  })

  it('does not show the replace warning for new users', () => {
    render(<PreviewPanel {...props({ existing: null })} />)
    expect(screen.queryByText(/replaces your current data/)).not.toBeInTheDocument()
  })

  it('saves and lets the user choose another file', async () => {
    const p = props()
    render(<PreviewPanel {...p} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save to my account' }))
    expect(p.onSave).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Choose a different file' }))
    expect(p.onChooseAnother).toHaveBeenCalledTimes(1)
  })

  it('disables Save while saving', () => {
    render(<PreviewPanel {...props({ saving: true })} />)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })

  it('disables Save with an explanation when saving is unavailable', () => {
    render(<PreviewPanel {...props({ saveDisabledReason: "Saving isn't available in local mode." })} />)
    expect(screen.getByRole('button', { name: 'Save to my account' })).toBeDisabled()
    expect(screen.getByText("Saving isn't available in local mode.")).toBeInTheDocument()
  })

  it('draws the steps and sleep sparklines', () => {
    render(<PreviewPanel {...props()} />)
    // The fixture has a single day, so there is not enough data to draw either line.
    expect(screen.getByText('Steps trend: not enough data')).toBeInTheDocument()
    expect(screen.getByText('Sleep trend: not enough data')).toBeInTheDocument()
  })
})
