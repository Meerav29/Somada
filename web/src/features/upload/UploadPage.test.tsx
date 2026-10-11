import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeWorker } from '../../test/fakeWorker'
import { stubFetch } from '../../test/fetch'
import { healthFixture, parseResultFixture } from '../../test/fixtures'
import { authValue, renderAt } from '../../test/utils'
import { UploadPage, ownDataSummary } from './UploadPage'

afterEach(() => {
  vi.unstubAllGlobals()
})

function setup(opts: { save?: () => Promise<void>; auth?: ReturnType<typeof authValue> } = {}) {
  const workers: FakeWorker[] = []
  const createWorker = () => {
    const w = new FakeWorker()
    workers.push(w)
    return w
  }
  const save = vi.fn(opts.save ?? (() => Promise.resolve()))
  renderAt(<UploadPage createWorker={createWorker} save={save} />, { route: '/upload', auth: opts.auth })
  return { workers, save }
}

const zip = () => new File(['x'], 'export.zip', { type: 'application/zip' })

async function chooseFile(file = zip()) {
  await userEvent.upload(screen.getByLabelText(/choose your export/i), file)
}

describe('ownDataSummary', () => {
  it('is null for no data and for the demo dataset', () => {
    expect(ownDataSummary(null)).toBeNull()
    expect(ownDataSummary(undefined)).toBeNull()
    expect(ownDataSummary(healthFixture({ is_demo: true }))).toBeNull()
  })

  it('summarizes the user own data', () => {
    expect(ownDataSummary(healthFixture())).toEqual({ days: 1, lastDate: '2026-09-30' })
  })
})

describe('UploadPage', () => {
  it('starts with the guide and the drop zone', () => {
    stubFetch(200, { error: 'No health data found.' })
    setup()
    expect(screen.getByRole('heading', { name: 'Upload your Apple Health export' })).toBeInTheDocument()
    expect(screen.getByText(/How to export your Apple Health data/)).toBeInTheDocument()
    expect(screen.getByLabelText(/choose your export/i)).toBeInTheDocument()
  })

  it('walks from a file to a preview to a saved account', async () => {
    stubFetch(200, { error: 'No health data found.' })
    const { workers, save } = setup()
    await chooseFile()
    expect(workers).toHaveLength(1)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()

    act(() => workers[0].emit({ type: 'progress', fraction: 0.5, recordsSeen: 10 }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')

    const result = parseResultFixture()
    act(() => workers[0].emit({ type: 'done', result }))
    expect(screen.getByText("Here's what we found")).toBeInTheDocument()
    expect(screen.getByText('Nothing has been saved yet.')).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Save to my account' }))
    expect(save).toHaveBeenCalledWith(result)
    expect(await screen.findByRole('heading', { name: 'Your data is saved' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/')
  })

  it('warns when saving will replace existing data', async () => {
    stubFetch(200, healthFixture())
    const { workers } = setup()
    await chooseFile()
    act(() => workers[0].emit({ type: 'done', result: parseResultFixture() }))
    expect(
      await screen.findByText(
        'This replaces your current data (1 days, through 2026-09-30). Your life events are kept.',
      ),
    ).toBeInTheDocument()
  })

  it('does not show the replace warning when the user only has the sample data', async () => {
    stubFetch(200, healthFixture({ is_demo: true }))
    const { workers } = setup()
    await chooseFile()
    act(() => workers[0].emit({ type: 'done', result: parseResultFixture() }))
    expect(await screen.findByText("Here's what we found")).toBeInTheDocument()
    expect(screen.queryByText(/replaces your current data/)).not.toBeInTheDocument()
  })

  it('shows a specific error for a parse failure and recovers with a new file', async () => {
    stubFetch(200, { error: 'No health data found.' })
    const { workers } = setup()
    await chooseFile()
    act(() => workers[0].emit({ type: 'error', code: 'corrupt-file', message: 'x' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/damaged or incomplete/)
    await userEvent.click(screen.getByRole('button', { name: 'Choose a different file' }))
    expect(screen.getByLabelText(/choose your export/i)).toBeInTheDocument()
  })

  it('rejects the wrong file type with a message', async () => {
    stubFetch(200, { error: 'No health data found.' })
    setup()
    const user = userEvent.setup({ applyAccept: false })
    await user.upload(screen.getByLabelText(/choose your export/i), new File(['x'], 'notes.txt'))
    expect(screen.getByRole('alert')).toHaveTextContent(/isn't an Apple Health export/)
  })

  it('cancels a running parse', async () => {
    stubFetch(200, { error: 'No health data found.' })
    const { workers } = setup()
    await chooseFile()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(workers[0].terminated).toBe(true)
    expect(screen.getByLabelText(/choose your export/i)).toBeInTheDocument()
  })

  it('keeps the parsed result when saving fails and Try again succeeds', async () => {
    stubFetch(200, { error: 'No health data found.' })
    let attempts = 0
    const { workers, save } = setup({
      save: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('network')
      },
    })
    await chooseFile()
    act(() => workers[0].emit({ type: 'done', result: parseResultFixture() }))
    await userEvent.click(screen.getByRole('button', { name: 'Save to my account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't save your data/i)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Your data is saved' })).toBeInTheDocument()
    expect(save).toHaveBeenCalledTimes(2)
    expect(workers).toHaveLength(1)
  })

  it('disables Save with an explanation in local (unconfigured) mode', async () => {
    stubFetch(200, { error: 'No health data found.' })
    const { workers } = setup({ auth: authValue({ status: 'unconfigured', email: null }) })
    await chooseFile()
    act(() => workers[0].emit({ type: 'done', result: parseResultFixture() }))
    expect(screen.getByRole('button', { name: 'Save to my account' })).toBeDisabled()
    expect(screen.getByText(/Saving isn't available in local mode/)).toBeInTheDocument()
  })
})
