/**
 * Tests for listing an EMG study and loading it in place, through the real application and the real loader.
 *
 * The loader and core's listing path are driven together because the contract lives between them: what the listing
 * passes to the read, what an importer declaring no modalities of its own accepts, and which object the setup runs
 * on. Only the importer is a double, and it is shaped like the real ones, refusing any modality it is asked to read
 * for.
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

/** An importer that, like the EDF and WAV importers, declares no modalities and fills the study it reads. */
const importerDouble = () => {
    const importer = {
        name: 'EmgImporter',
        study: null as StudyContext | null,
        studyLoader: null as unknown,
        getFileTypeWorker: vi.fn(workerStub),
        importFile: vi.fn(async (file: File) => {
            // As the format importers leave it: they are modality-agnostic, and the loader claims what they read.
            importer.study!.modality = 'signal'
            importer.study!.meta = { duration: 5, nChannels: 2, samplingRate: 1000 }
            importer.study!.files = [{ file, role: 'data', url: 'blob:file' } as StudyContext['files'][number]]
            return true
        }),
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

describe('a listed EMG study', () => {
    let app: Epicurrents
    let dataset: MediaDataset
    let importer: ReturnType<typeof importerDouble>

    beforeEach(() => {
        ;(window as unknown as { __EPICURRENTS__: undefined }).__EPICURRENTS__ = undefined
        app = new Epicurrents()
        app.runtime.APP.datasets.length = 0
        app.runtime.APP.activeDataset = null
        app.registerModule('emg', { runtime: {}, settings: {} } as never)
        importer = importerDouble()
        app.registerStudyImporter('emg/url', 'EMG', 'url', new EmgStudyLoader('EmgLoader', importer as never))
        dataset = app.createDataset('dataset', true)
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue({ length: 5, samplingRate: 1000 })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('is listed as an EMG recording that has read nothing and started no worker', () => {
        const listed = app.listStudy({ loader: 'emg/url', name: 'Listed', source: 'blob:emg' }, { dataset })
        expect(listed).toBeInstanceOf(EmgRecording)
        expect(listed?.isListed).toBe(true)
        expect(importer.importUrl).not.toHaveBeenCalled()
        expect(importer.getFileTypeWorker).not.toHaveBeenCalled()
    })

    it('leaves a study opened from a file its own resource when a study is listed while it is read', async () => {
        const loader = app.runtime.APP.studyImporters.get('emg/url')!.loader as EmgStudyLoader
        const useStudy = loader.useStudy.bind(loader)
        let listed = null as ReturnType<typeof app.listStudy>
        // Listed in the gap between the read handing back the next index and the loader building the resource.
        vi.spyOn(loader, 'useStudy').mockImplementation(async study => {
            const next = await useStudy(study)
            listed = app.listStudy({ loader: 'emg/url', name: 'Listed', source: 'blob:listed' }, { dataset })
            return next
        })
        const opened = await app.loadStudy('emg/url', 'blob:opened', { dataset })
        expect(listed).toBeInstanceOf(EmgRecording)
        expect(opened).not.toBe(listed)
        expect(opened?.source?.files[0].url).toBe('blob:opened')
    })

    it('loads in place on activation, from the study it reads', async () => {
        const listed = app.listStudy({ loader: 'emg/url', name: 'Listed', source: 'blob:emg' }, { dataset })!
        app.runtime.setActiveResource(listed)
        await vi.waitFor(() => expect(listed.state).toBe('ready'))
        expect(dataset.resources.map(ctx => ctx.resource)).toEqual([listed])
        expect((listed as EmgRecording).channels).toHaveLength(2)
        expect(importer.getFileTypeWorker).toHaveBeenCalledTimes(1)
        expect(importer.getFileTypeWorker).toHaveBeenCalledWith('emg')
    })

    it('loads a study listed from a file, which the read hands back claimed as EMG', async () => {
        const file = new File(['emg'], 'listed.wav')
        const listed = app.listStudy({ loader: 'emg/url', name: 'Listed', source: file }, { dataset })!
        expect(await listed.load()).toBe(true)
        expect(importer.importFile).toHaveBeenCalledTimes(1)
        expect(listed.source?.modality).toBe('emg')
        expect((listed as EmgRecording).channels).toHaveLength(2)
    })

    it('is left listed, with the service of the load shut down, when it is unloaded while it loads', async () => {
        let answer = (_response: { length: number, samplingRate: number }) => {}
        const prepareWorker = vi.spyOn(EmgService.prototype, 'prepareWorker').mockReturnValue(new Promise(resolve => {
            answer = resolve
        }))
        const destroy = vi.spyOn(EmgService.prototype, 'destroy').mockResolvedValue(undefined)
        const listed = app.listStudy({ loader: 'emg/url', name: 'Listed', source: 'blob:emg' }, { dataset })!
        // The buffer release is core's own and not what is being pinned.
        vi.spyOn(listed as EmgRecording, 'releaseBuffers').mockResolvedValue(undefined)
        const loaded = listed.load()
        await vi.waitFor(() => expect(prepareWorker).toHaveBeenCalledTimes(1))
        await listed.unload()
        expect(listed.state).toBe('added')
        answer({ length: 5, samplingRate: 1000 })
        expect(await loaded).toBe(false)
        expect(listed.state).toBe('added')
        expect(listed.errorReason).toBe('')
        expect(destroy).toHaveBeenCalledTimes(1)
        expect((listed as unknown as { _service: unknown })._service).toBe(null)
    })

    it('starts a setup of its own once an unload has interrupted the one in flight', async () => {
        type Internals = { _completeSetup: () => Promise<void>, _runSetup: () => Promise<void> }
        const listed = app.listStudy({ loader: 'emg/url', name: 'Listed', source: 'blob:emg' }, { dataset })!
        vi.spyOn(listed as EmgRecording, 'releaseBuffers').mockResolvedValue(undefined)
        const internals = listed as unknown as Internals
        const run = vi.spyOn(internals, '_runSetup').mockImplementation(() => new Promise<void>(() => {}))
        const first = internals._completeSetup()
        await listed.unload()
        expect(internals._completeSetup()).not.toBe(first)
        expect(run).toHaveBeenCalledTimes(2)
    })
})
