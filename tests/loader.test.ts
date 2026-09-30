/**
 * Tests for `EmgStudyLoader.getResource`.
 *
 * The method used to validate only the study name. The recording constructor reads the channel count,
 * duration and sampling rate straight off `meta`, so a study missing those produced a recording with
 * no channels and no duration — an empty viewer rather than a failed load, with nothing logged.
 *
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmgStudyLoader from '../src/loader/EmgStudyLoader'
import { Log } from 'scoped-event-log'
import { installRuntimeGlobal } from './runtimeGlobal'
import type { EmgStudyContext } from '../src/types'

vi.mock('scoped-event-log', async () => (await import('./logMock')).makeLogMock())

const getResource = (context: object) =>
    (EmgStudyLoader.prototype as unknown as Record<string, (this: unknown) => Promise<unknown>>)
        .getResource.call(context)

const studyWith = (meta: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    name: 'Study',
    meta,
    files: [{ role: 'data', file: null, url: 'blob:emg' }],
    ...over,
} as unknown as EmgStudyContext)

const completeMeta = { nChannels: 2, samplingRate: 1000, duration: 5 }

let removeRuntimeGlobal: () => void

/** A worker carrying the members the service constructor and core's service base reach for. */
const workerStub = () => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    postMessage: vi.fn(),
    terminate: vi.fn(),
} as unknown as Worker)

/**
 * `getResource` calls its super first, so the stub answers that call with null to reach the
 * construction path, and carries the members the method touches after it.
 */
const makeContext = (study: EmgStudyContext | null) => ({
    _study: study,
    _resources: [] as unknown[],
    _studyImporter: { getFileTypeWorker: vi.fn(() => workerStub()) },
    _memoryManager: null,
})

beforeEach(() => {
    vi.clearAllMocks()
    removeRuntimeGlobal = installRuntimeGlobal()
    // The super call is what a real loader resolves against its own resource list; answering null
    // sends the method down the construction path this test is about.
    const base = Object.getPrototypeOf(EmgStudyLoader.prototype) as
        { getResource: (idx?: number | string) => Promise<unknown> }
    vi.spyOn(base, 'getResource').mockResolvedValue(null)
})
afterEach(() => {
    removeRuntimeGlobal()
    vi.restoreAllMocks()
})

const refusalMessages = () =>
    (Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]))

describe('getResource', () => {
    it('constructs a recording from a complete study', async () => {
        const context = makeContext(studyWith(completeMeta))
        const resource = await getResource(context) as { name: string, state: string } | null
        expect(resource).not.toBe(null)
        expect(resource?.name).toBe('Study')
        expect(context._resources.length).toBe(1)
    })

    it('clears the loaded study once the recording is built', async () => {
        const context = makeContext(studyWith(completeMeta))
        await getResource(context)
        // Left in place, the next call would build a second recording from the same study.
        expect(context._study).toBe(null)
    })

    it('refuses a study with no channel count', async () => {
        const context = makeContext(studyWith({ samplingRate: 1000, duration: 5 }))
        expect(await getResource(context)).toBe(null)
        expect(context._resources.length).toBe(0)
        expect(refusalMessages().some(m => m.includes('nChannels'))).toBe(true)
    })

    it('refuses a study with no sampling rate', async () => {
        const context = makeContext(studyWith({ nChannels: 2, duration: 5 }))
        expect(await getResource(context)).toBe(null)
        expect(context._resources.length).toBe(0)
    })

    it('refuses a study with no name', async () => {
        const context = makeContext(studyWith(completeMeta, { name: '' }))
        expect(await getResource(context)).toBe(null)
        expect(context._resources.length).toBe(0)
    })

    it('accepts a zero channel count rather than reading it as absent', async () => {
        // `typeof x !== 'number'` rather than `!x`: a zero-channel study is a degenerate recording,
        // not a malformed context, and the two deserve different diagnostics.
        const context = makeContext(studyWith({ nChannels: 0, samplingRate: 1000, duration: 5 }))
        expect(await getResource(context)).not.toBe(null)
    })

    it('returns null when no study has been loaded', async () => {
        const context = makeContext(null)
        expect(await getResource(context)).toBe(null)
        expect(context._studyImporter.getFileTypeWorker).not.toHaveBeenCalled()
    })

    it('refuses when the importer offers no worker', async () => {
        const context = {
            ...makeContext(studyWith(completeMeta)),
            _studyImporter: { getFileTypeWorker: vi.fn(() => null as unknown as Worker) },
        }
        expect(await getResource(context)).toBe(null)
        expect(refusalMessages().some(m => m.includes('file worker'))).toBe(true)
    })

    it('asks the importer for an EMG worker specifically', async () => {
        const context = makeContext(studyWith(completeMeta))
        await getResource(context)
        expect(context._studyImporter.getFileTypeWorker).toHaveBeenCalledWith('emg')
    })
})

describe('modality stamping', () => {
    it('reports the EMG modality', () => {
        const loader = new EmgStudyLoader('EmgWavLoader', {
            getFileTypeWorker: vi.fn(),
        } as never)
        expect(loader.resourceModality).toBe('emg')
    })

    /**
     * The format importers are modality-agnostic, so a study arrives carrying whatever modality the
     * context template started with. Both loading paths have to narrow it, or anything that resolves
     * a study by modality finds nothing.
     */
    for (const method of ['loadFromDirectory', 'loadFromUrl'] as const) {
        it(`stamps the EMG modality onto a study loaded by ${method}`, async () => {
            const base = Object.getPrototypeOf(EmgStudyLoader.prototype) as
                Record<string, (...a: unknown[]) => Promise<unknown>>
            vi.spyOn(base, method).mockResolvedValue({ modality: 'unknown', files: [] })
            const loader = new EmgStudyLoader('EmgWavLoader', { getFileTypeWorker: vi.fn() } as never)
            const context = await (loader[method] as (a: unknown) => Promise<{ modality: string } | null>)('x')
            expect(context?.modality).toBe('emg')
        })

        it(`passes a failed ${method} through as null`, async () => {
            const base = Object.getPrototypeOf(EmgStudyLoader.prototype) as
                Record<string, (...a: unknown[]) => Promise<unknown>>
            vi.spyOn(base, method).mockResolvedValue(null)
            const loader = new EmgStudyLoader('EmgWavLoader', { getFileTypeWorker: vi.fn() } as never)
            expect(await (loader[method] as (a: unknown) => Promise<unknown>)('x')).toBe(null)
        })
    }
})
