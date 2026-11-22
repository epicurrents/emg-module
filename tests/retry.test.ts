/**
 * Tests for what a failed or interrupted attempt leaves behind on an EMG recording, through the real application and
 * the real loader: a recording whose load fails is deactivated and loads again on a retry with nothing of the failed
 * attempt left alive, and a cache setup overtaken by an unload stops where it is.
 *
 * @package    epicurrents/emg-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Epicurrents } from '@epicurrents/core'
import type { MediaDataset, StudyContext } from '@epicurrents/core/types'
import EmgRecording from '../src/EmgRecording'
import EmgStudyLoader from '../src/loader/EmgStudyLoader'
import EmgService from '../src/service/EmgService'

vi.mock('scoped-event-log', async () => (await import('./logMock')).makeLogMock())

const workerStub = () => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    postMessage: vi.fn(),
    terminate: vi.fn(),
} as unknown as Worker)

/** An importer that declares no modalities and fills the study it reads. */
const importerDouble = () => {
    const importer = {
        name: 'EmgImporter',
        study: null as StudyContext | null,
        studyLoader: null as unknown,
        getFileTypeWorker: vi.fn(workerStub),
        importFile: vi.fn(async () => false),
        importUrl: vi.fn(async (url: string) => {
            importer.study!.meta = { duration: 5, nChannels: 2, samplingRate: 1000 }
            importer.study!.files = [{ role: 'data', url } as StudyContext['files'][number]]
            return true
        }),
        isSupportedModality: () => false,
        matchName: () => true,
        registerMemoryManager: vi.fn(),
        registerStudy: (study: StudyContext) => {
            importer.study = study
        },
    }
    return importer
}

/** A promise and the function that resolves it. */
const gate = <T>() => {
    let open = (_value: T) => {}
    const closed = new Promise<T>(resolve => {
        open = resolve
    })
    return { closed, open }
}

type Internals = {
    _completeSetup: () => Promise<void>
    _service: EmgService | null
    _setupRun: Promise<void> | null
}

describe('an EMG recording after a failed or interrupted attempt', () => {
    let app: Epicurrents
    let dataset: MediaDataset
    let importer: ReturnType<typeof importerDouble>

    const list = () => app.listStudy(
        { loader: 'emg/url', name: 'Listed', source: 'blob:emg' }, { dataset }
    ) as EmgRecording

    beforeEach(() => {
        ;(window as unknown as { __EPICURRENTS__: undefined }).__EPICURRENTS__ = undefined
        app = new Epicurrents()
        app.runtime.APP.datasets.length = 0
        app.runtime.APP.activeDataset = null
        app.registerModule('emg', { runtime: {}, settings: {} } as never)
        importer = importerDouble()
        app.registerStudyImporter('emg/url', 'EMG', 'url', new EmgStudyLoader('EmgLoader', importer as never))
        dataset = app.createDataset('dataset', true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('is deactivated when its load fails, and loads on a new service when it is selected again', async () => {
        const prepareWorker = vi.spyOn(EmgService.prototype, 'prepareWorker')
            .mockResolvedValueOnce(null as never)
            .mockResolvedValue({ length: 5, samplingRate: 1000 })
        const destroy = vi.spyOn(EmgService.prototype, 'destroy').mockResolvedValue(undefined)
        const listed = list()
        const internals = listed as unknown as Internals
        vi.spyOn(listed, 'releaseBuffers').mockResolvedValue(undefined)
        const completeSetup = vi.spyOn(internals, '_completeSetup').mockResolvedValue(undefined)
        app.runtime.setActiveResource(listed)
        await vi.waitFor(() => expect(listed.state).toBe('error'))
        expect(listed.errorReason).toBe('Preparing worker failed')
        expect(listed.isActive).toBe(false)
        expect(completeSetup).not.toHaveBeenCalled()
        // The failed load shut down the service it created.
        expect(internals._service).toBeNull()
        expect(destroy).toHaveBeenCalledTimes(1)
        expect(listed.canRetryLoad).toBe(true)
        app.selectActiveResource(listed)
        expect(listed.state).toBe('loading')
        expect(listed.isActive).toBe(true)
        await vi.waitFor(() => expect(listed.state).toBe('ready'))
        await vi.waitFor(() => expect(completeSetup).toHaveBeenCalledTimes(1))
        expect(listed.isActive).toBe(true)
        expect(listed.errorReason).toBe('')
        expect(prepareWorker).toHaveBeenCalledTimes(2)
        // The study was read once: the retry set up from the one the recording kept, without building its channels
        // a second time.
        expect(importer.importUrl).toHaveBeenCalledTimes(1)
        expect(listed.channels).toHaveLength(2)
        expect(importer.getFileTypeWorker).toHaveBeenCalledTimes(2)
        expect(internals._service).toBeInstanceOf(EmgService)
        expect(destroy).toHaveBeenCalledTimes(1)
        expect(internals._setupRun).toBeNull()
    })

    it('replaces the service of a setup that failed after the load', async () => {
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue({ length: 5, samplingRate: 1000 })
        const destroy = vi.spyOn(EmgService.prototype, 'destroy').mockResolvedValue(undefined)
        vi.spyOn(EmgService.prototype, 'setupCache').mockResolvedValue(null as never)
        const listed = list()
        const internals = listed as unknown as Internals
        vi.spyOn(listed, 'releaseBuffers').mockResolvedValue(undefined)
        app.runtime.setActiveResource(listed)
        await vi.waitFor(() => expect(listed.state).toBe('error'))
        expect(listed.errorReason).toBe('Data cache setup failed')
        expect(listed.isActive).toBe(false)
        const failed = internals._service
        expect(failed).toBeInstanceOf(EmgService)
        expect(await listed.retryLoad()).toBe(true)
        expect(destroy).toHaveBeenCalledTimes(1)
        expect(internals._service).toBeInstanceOf(EmgService)
        expect(internals._service).not.toBe(failed)
    })

    describe('whose cache setup is overtaken by an unload', () => {
        /** A loaded recording whose cache setup is held open at its first step. */
        const heldSetup = async () => {
            vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue({ length: 5, samplingRate: 1000 })
            vi.spyOn(EmgService.prototype, 'getSignals').mockResolvedValue(null)
            const cache = gate<unknown>()
            const setupCache = vi.spyOn(EmgService.prototype, 'setupCache')
                .mockReturnValueOnce(cache.closed as never)
                .mockResolvedValue({} as never)
            const listed = list()
            const internals = listed as unknown as Internals
            const releaseBuffers = vi.spyOn(listed, 'releaseBuffers').mockResolvedValue(undefined)
            const cacheSignals = vi.spyOn(listed, 'cacheSignals').mockResolvedValue(true)
            const announced = [] as string[]
            listed.addEventListener('initial-setup', () => announced.push('before'), 'test', 'before')
            listed.addEventListener('initial-setup', () => announced.push('after'), 'test', 'after')
            listed.addEventListener('signal-caching-complete', () => announced.push('cached'), 'test')
            expect(await listed.load()).toBe(true)
            return { announced, cache, cacheSignals, internals, listed, releaseBuffers, setupCache }
        }

        it('commissions and dispatches nothing more, and gives back what it had asked for', async () => {
            const { announced, cache, cacheSignals, internals, listed, releaseBuffers } = await heldSetup()
            const setup = internals._completeSetup()
            expect(announced).toEqual(['before'])
            await listed.unload()
            expect(releaseBuffers).toHaveBeenCalledTimes(1)
            // The cache lands after the unload released the buffers.
            cache.open({})
            await setup
            expect(cacheSignals).not.toHaveBeenCalled()
            expect(announced).toEqual(['before'])
            expect(listed.state).toBe('ready')
            expect(listed.errorReason).toBe('')
            // Released again, for the cache that landed late.
            expect(releaseBuffers).toHaveBeenCalledTimes(2)
        })

        it('does not read a step the unload made fail as a failure of the recording', async () => {
            const { cache, internals, listed } = await heldSetup()
            const setup = internals._completeSetup()
            await listed.unload()
            cache.open(null)
            await setup
            expect(listed.state).toBe('ready')
            expect(listed.errorReason).toBe('')
        })

        it('leaves the next activation a setup that runs to completion', async () => {
            const { announced, cache, cacheSignals, internals, listed, setupCache } = await heldSetup()
            const setup = internals._completeSetup()
            await listed.unload()
            cache.open({})
            await setup
            app.runtime.setActiveResource(listed)
            await vi.waitFor(() => expect(announced).toEqual(['before', 'before', 'after', 'cached']))
            expect(setupCache).toHaveBeenCalledTimes(2)
            expect(cacheSignals).toHaveBeenCalledTimes(1)
            expect(listed.state).toBe('ready')
        })

        it('leaves alone what a newer setup has commissioned', async () => {
            const { cache, cacheSignals, internals, listed, releaseBuffers } = await heldSetup()
            const overtaken = internals._completeSetup()
            await listed.unload()
            const newer = internals._completeSetup()
            expect(newer).not.toBe(overtaken)
            cache.open({})
            await Promise.all([overtaken, newer])
            // Only the unload released; the overtaken run found a newer one holding the cache.
            expect(releaseBuffers).toHaveBeenCalledTimes(1)
            expect(cacheSignals).toHaveBeenCalledTimes(1)
        })
    })
})
