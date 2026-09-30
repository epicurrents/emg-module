/**
 * Tests for `EmgService`.
 *
 * Two things are pinned. `prepareWorker` used to destructure the first data file of a study without
 * checking that one exists, so a study that arrived without one threw where the reason was no longer
 * visible. And the constructor handed an async `handleMessage` straight to `addEventListener`, whose
 * slot returns void, so a malformed worker message became an unhandled rejection reported nowhere.
 *
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmgService from '../src/service/EmgService'
import { Log } from 'scoped-event-log'
import type { EmgResource } from '../src/types'
import type { StudyContext, WorkerResponse } from '@epicurrents/core/types'

vi.mock('scoped-event-log', async () => (await import('./logMock')).makeLogMock())

const prepareWorker = (context: object, study: StudyContext) =>
    (EmgService.prototype as unknown as Record<string, (this: unknown, s: StudyContext) => Promise<unknown>>)
        .prepareWorker.call(context, study)

const study = (files: { role: string, file?: unknown, url?: string }[]) =>
    ({ name: 'study', files } as unknown as StudyContext)

const errorMessages = () =>
    (Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]))

describe('prepareWorker', () => {
    beforeEach(() => { vi.clearAllMocks() })

    const makeContext = () => ({
        _commissionWorker: vi.fn(() => ({ promise: Promise.resolve({ length: 4, samplingRate: 2 }) })),
    })

    it('commissions the worker with the study data file', async () => {
        const context = makeContext()
        const file = { name: 'emg.wav' }
        await prepareWorker(context, study([{ role: 'data', file, url: 'blob:emg' }]))
        expect(context._commissionWorker).toHaveBeenCalledTimes(1)
        const [action, params] = context._commissionWorker.mock.calls[0] as unknown as [string, Map<string, unknown>]
        expect(action).toBe('setup-worker')
        expect(params.get('file')).toBe(file)
        expect(params.get('url')).toBe('blob:emg')
    })

    it('picks the data file rather than the first file of the study', async () => {
        const context = makeContext()
        const data = { name: 'emg.wav' }
        await prepareWorker(context, study([
            { role: 'meta', file: { name: 'notes.json' }, url: 'blob:notes' },
            { role: 'data', file: data, url: 'blob:emg' },
        ]))
        const [, params] = context._commissionWorker.mock.calls[0] as unknown as [string, Map<string, unknown>]
        expect(params.get('file')).toBe(data)
    })

    it('refuses a study with no data file instead of throwing on it', async () => {
        const context = makeContext()
        await expect(prepareWorker(context, study([{ role: 'meta' }]))).resolves.toBe(null)
        expect(context._commissionWorker).not.toHaveBeenCalled()
        expect(errorMessages().some(m => m.includes('no data file'))).toBe(true)
    })

    it('refuses a study with no files at all', async () => {
        const context = makeContext()
        await expect(prepareWorker(context, study([]))).resolves.toBe(null)
        expect(context._commissionWorker).not.toHaveBeenCalled()
    })
})

describe('the worker message listener', () => {
    beforeEach(() => { vi.clearAllMocks() })

    /** A worker stub that hands the registered listener back so a message can be delivered to it. */
    const workerStub = () => {
        const listeners: ((message: MessageEvent) => unknown)[] = []
        return {
            worker: {
                addEventListener: (_type: string, listener: (message: MessageEvent) => unknown) => {
                    listeners.push(listener)
                },
                removeEventListener: vi.fn(),
                postMessage: vi.fn(),
                terminate: vi.fn(),
            } as unknown as Worker,
            deliver: (message: unknown) => listeners.forEach(l => l(message as MessageEvent)),
        }
    }

    const recordingStub = () => ({ id: 'emg-1' }) as unknown as EmgResource

    it('reports a rejected message instead of leaving it unhandled', async () => {
        const { worker, deliver } = workerStub()
        const service = new EmgService(recordingStub(), worker)
        vi.spyOn(service, 'handleMessage').mockRejectedValue(new Error('malformed'))
        deliver({ data: { action: 'nonsense' } } as unknown as WorkerResponse)
        // The rejection is caught in a microtask, so let the queue drain before asserting.
        await Promise.resolve()
        await Promise.resolve()
        const failure = (Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls
            .find(call => String(call[0]).includes('worker message'))
        expect(failure).toBeDefined()
        expect(failure?.[2]).toBeInstanceOf(Error)
    })

    it('leaves the log alone for a message the handler accepts', async () => {
        const { worker, deliver } = workerStub()
        const service = new EmgService(recordingStub(), worker)
        vi.spyOn(service, 'handleMessage').mockResolvedValue(true)
        deliver({ data: { action: 'fine' } } as unknown as WorkerResponse)
        await Promise.resolve()
        expect(errorMessages().some(m => m.includes('worker message'))).toBe(false)
    })

    it('ignores a message carrying no data', async () => {
        const { worker, deliver } = workerStub()
        const service = new EmgService(recordingStub(), worker)
        deliver({ data: null } as unknown as WorkerResponse)
        await Promise.resolve()
        expect(errorMessages().some(m => m.includes('worker message'))).toBe(false)
        await expect(service.handleMessage({ data: null } as unknown as WorkerResponse)).resolves.toBe(false)
    })
})
