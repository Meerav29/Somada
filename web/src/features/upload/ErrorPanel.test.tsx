import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorPanel } from './ErrorPanel'

describe('ErrorPanel', () => {
  it('announces the problem with a specific message and a way out', async () => {
    const onReset = vi.fn()
    render(<ErrorPanel error={{ code: 'zip-missing-export', message: 'x' }} onReset={onReset} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/export\.xml/)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Choose a different file' }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('offers Try again only for retryable errors', async () => {
    const onRetry = vi.fn()
    render(<ErrorPanel error={{ code: 'save-failed', message: 'x' }} onRetry={onRetry} onReset={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('does not offer Try again when no retry handler is given', () => {
    render(<ErrorPanel error={{ code: 'save-failed', message: 'x' }} onReset={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
