import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReadingProgress } from './ReadingProgress'

describe('ReadingProgress', () => {
  it('shows a progressbar with the percentage, file name and record count', () => {
    render(
      <ReadingProgress
        fileName="export.zip"
        fraction={0.426}
        recordsSeen={1234567}
        startedAt={Date.now() - 5000}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '43')
    expect(screen.getByText(/export\.zip/)).toBeInTheDocument()
    expect(screen.getByText(/1,234,567 records/)).toBeInTheDocument()
    expect(screen.getByText(/5s elapsed/)).toBeInTheDocument()
  })

  it('cancels', async () => {
    const onCancel = vi.fn()
    render(
      <ReadingProgress fileName="a.zip" fraction={0} recordsSeen={0} startedAt={Date.now()} onCancel={onCancel} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
