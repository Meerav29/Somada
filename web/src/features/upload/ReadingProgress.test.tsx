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
    expect(screen.getByRole('heading', { name: /export\.zip/ })).toBeInTheDocument()
    expect(screen.getByText(/1,234,567 records/)).toBeInTheDocument()
    expect(screen.getByText(/5s elapsed/)).toBeInTheDocument()
  })

  it('has no aria-live on the section and a single coarse status region', () => {
    const { container, rerender } = render(
      <ReadingProgress fileName="export.zip" fraction={0.426} recordsSeen={1234567} startedAt={Date.now() - 5000} onCancel={() => {}} />,
    )
    expect(container.querySelector('section')).not.toHaveAttribute('aria-live')
    const live = container.querySelectorAll('[aria-live]')
    expect(live).toHaveLength(1)
    expect(live[0]).toHaveAttribute('aria-live', 'polite')
    const status = screen.getByRole('status')
    expect(status).toBe(live[0])
    expect(status).toHaveTextContent(/^Reading export\.zip… 25%$/)
    expect(status.textContent).not.toMatch(/records|elapsed|1,234,567/)
    rerender(
      <ReadingProgress fileName="export.zip" fraction={0.49} recordsSeen={2000000} startedAt={Date.now() - 9000} onCancel={() => {}} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/^Reading export\.zip… 25%$/)
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
