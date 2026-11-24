/**
 * Tests for `EmgRecording`'s constructor.
 *
 * The constructor is where the two ordering rules of this class live: the channels come from the
 * study's `meta`, and the one-time setup is driven by an ACTIVATE listener whose slot returns void —
 * so the setup's rejection has to be caught inside the listener or it is reported nowhere.
 *
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmgRecording from '../src/EmgRecording'
import EmgService from '../src/service/EmgService'
import { Log } from 'scoped-event-log'
import { installRuntimeGlobal } from './runtimeGlobal'
import type { EmgStudyContext } from '../src/types'

vi.mock('scoped-event-log', async () => (await import('./logMock')).makeLogMock())

const study = (meta: Record<string, unknown> = {}) => ({
    name: 'Study',
    meta: { nChannels: 3, samplingRate: 1000, duration: 6, ...meta },
    files: [{ role: 'data', file: null, url: 'blob:emg' }],
} as unknown as EmgStudyContext)

const workerStub = () => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    postMessage: vi.fn(),
    terminate: vi.fn(),
} as unknown as Worker)

/** Let the promise chains a load runs through settle. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

let removeRuntimeGlobal: () => void

beforeEach(() => {
    vi.clearAllMocks()
    removeRuntimeGlobal = installRuntimeGlobal()
})
afterEach(() => {
    removeRuntimeGlobal()
    vi.restoreAllMocks()
})

describe('the channels built from a study', () => {
    it('creates one channel per channel the study declares', () => {
        expect(new EmgRecording('rec', study()).channels.length).toBe(3)
    })

    it('numbers the labels from one and the names from zero', () => {
        const recording = new EmgRecording('rec', study({ nChannels: 2 }))
        expect(recording.channels.map(c => c.name)).toEqual(['ch_0', 'ch_1'])
        expect(recording.channels.map(c => c.label)).toEqual(['EMG 1', 'EMG 2'])
    })

    it('gives every channel the study sampling rate', () => {
        const recording = new EmgRecording('rec', study({ samplingRate: 4000 }))
        expect(recording.channels.every(c => c.samplingRate === 4000)).toBe(true)
    })

    it('treats the recording as continuous', () => {
        // EMG recordings carry no gaps, so the cached span is the whole span.
        const recording = new EmgRecording('rec', study({ duration: 6 }))
        expect(recording.dataDuration).toBe(6)
        expect(recording.totalDuration).toBe(6)
    })

    it('builds no channels without a study', () => {
        const recording = new EmgRecording('rec')
        expect(recording.channels.length).toBe(0)
        expect(recording.totalDuration).toBe(0)
    })
})

describe('loading', () => {
    it('starts no worker when the recording is created', () => {
        const getWorker = vi.fn(workerStub)
        const recording = new EmgRecording('rec', study(), getWorker)
        expect(getWorker).not.toHaveBeenCalled()
        expect(recording.state).toBe('added')
    })

    it('reports itself loading while the worker prepares, and ready only once it answers', async () => {
        let answer = (_value: unknown) => {}
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockReturnValue(new Promise(resolve => {
            answer = resolve
        }) as never)
        const getWorker = vi.fn(workerStub)
        const recording = new EmgRecording('rec', study(), getWorker)
        const loaded = recording.load()
        await flush()
        expect(getWorker).toHaveBeenCalledTimes(1)
        expect(recording.state).toBe('loading')
        answer({ length: 6, samplingRate: 1000 })
        expect(await loaded).toBe(true)
        expect(recording.state).toBe('ready')
    })

    it('builds the channels of a recording created without its study once the study is in place', async () => {
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue({ length: 6, samplingRate: 1000 })
        const recording = new EmgRecording('rec', undefined, workerStub)
        recording.source = study({ nChannels: 2 })
        expect(await recording.load()).toBe(true)
        expect(recording.channels.map(c => c.name)).toEqual(['ch_0', 'ch_1'])
        expect(recording.totalDuration).toBe(6)
    })

    it('reports an error when the worker answers with nothing', async () => {
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue(null)
        const recording = new EmgRecording('rec', study(), workerStub)
        expect(await recording.load()).toBe(false)
        expect(recording.state).toBe('error')
        expect(recording.errorReason).toBe('Preparing worker failed')
    })

    it('reports an error when preparing the worker rejects', async () => {
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockRejectedValue(new Error('worker gone'))
        const recording = new EmgRecording('rec', study(), workerStub)
        expect(await recording.load()).toBe(false)
        expect(recording.state).toBe('error')
        expect(recording.errorReason).toBe('Preparing worker failed')
        const failure = (Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls
            .find(call => String(call[0]).includes('Preparing the EMG worker'))
        expect(failure?.[2]).toBeInstanceOf(Error)
    })

    it('reports an error when there is no worker to load with', async () => {
        const recording = new EmgRecording('rec', study(), () => null)
        expect(await recording.load()).toBe(false)
        expect(recording.state).toBe('error')
        expect(recording.errorReason).toBe('No file worker')
    })

    it('refuses a study missing its channel count or sampling rate', async () => {
        const getWorker = vi.fn(workerStub)
        const recording = new EmgRecording('rec', undefined, getWorker)
        recording.source = study({ nChannels: undefined })
        expect(await recording.load()).toBe(false)
        expect(recording.errorReason).toBe('Recording study is incomplete')
        expect(getWorker).not.toHaveBeenCalled()
    })
})

describe('the activation listener', () => {
    it('loads a recording activated before it has loaded, then completes its setup', async () => {
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue({ length: 6, samplingRate: 1000 })
        const recording = new EmgRecording('rec', study(), workerStub)
        const complete = vi.spyOn(
            recording as unknown as { _completeSetup: () => Promise<void> },
            '_completeSetup',
        ).mockResolvedValue(undefined)
        recording.isActive = true
        await flush()
        expect(recording.state).toBe('ready')
        expect(complete).toHaveBeenCalledTimes(1)
    })

    it('loads nothing when a recording with no study is activated', async () => {
        const getWorker = vi.fn(workerStub)
        const recording = new EmgRecording('rec', undefined, getWorker)
        recording.isActive = true
        await flush()
        expect(getWorker).not.toHaveBeenCalled()
        expect(recording.state).toBe('added')
    })

    it('reports a failed setup rather than leaving the rejection unhandled', async () => {
        const recording = new EmgRecording('rec', study(), workerStub)
        const failing = vi.spyOn(
            recording as unknown as { _completeSetup: () => Promise<void> },
            '_completeSetup',
        ).mockRejectedValue(new Error('no memory'))
        // `isActive` is what dispatches ACTIVATE, which is what the listener is attached to.
        recording.state = 'ready'
        recording.isActive = true
        await flush()
        expect(failing).toHaveBeenCalled()
        const failure = (Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls
            .find(call => String(call[0]).includes('Completing setup'))
        expect(failure).toBeDefined()
        expect(failure?.[2]).toBeInstanceOf(Error)
        expect(recording.state).toBe('error')
    })

    it('deactivates a recording whose setup rejected, as its refusals do', () => {
        // The three refusals inside the setup each deactivate; a rejection has to land in the same
        // state, or an errored recording stays active with a display asking an uncommissioned cache.
        const recording = new EmgRecording('rec', study(), workerStub)
        vi.spyOn(
            recording as unknown as { _completeSetup: () => Promise<void> },
            '_completeSetup',
        ).mockRejectedValue(new Error('no memory'))
        recording.state = 'ready'
        recording.isActive = true
        return flush().then(() => {
            expect(recording.isActive).toBe(false)
        })
    })
})

describe('the activation of a loaded or loading recording', () => {
    type Internals = {
        _completeSetup: () => Promise<void>
        _getWorker: unknown
        _runSetup: () => Promise<void>
        _service: unknown
    }

    it('commissions the cache of a loaded recording within the activation itself', async () => {
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue({ length: 6, samplingRate: 1000 })
        const recording = new EmgRecording('rec', study(), workerStub)
        const complete = vi.spyOn(recording as unknown as Internals, '_completeSetup').mockResolvedValue(undefined)
        expect(await recording.load()).toBe(true)
        // No await: the plot requests signals as soon as the recording is active, and the setup has to reach the
        // worker before that request does.
        recording.isActive = true
        expect(complete).toHaveBeenCalledTimes(1)
    })

    it('completes the setup of a listed recording activated while its study is being read', async () => {
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue({ length: 6, samplingRate: 1000 })
        let finishRead = (_study: EmgStudyContext) => {}
        const recording = new EmgRecording('rec', undefined, workerStub)
        recording.setListing({
            readStudy: () => new Promise<EmgStudyContext>(resolve => {
                finishRead = resolve
            }),
        } as never)
        const complete = vi.spyOn(recording as unknown as Internals, '_completeSetup').mockResolvedValue(undefined)
        // Somebody else's load: the recording is neither listed nor holding a source while it reads.
        const loaded = recording.load()
        expect(recording.state).toBe('loading')
        recording.isActive = true
        finishRead(study())
        expect(await loaded).toBe(true)
        await flush()
        expect(complete).toHaveBeenCalledTimes(1)
    })

    it('runs one setup for calls made while it is in flight, and another once it has settled', async () => {
        const recording = new EmgRecording('rec', study(), workerStub)
        let finish = () => {}
        const run = vi.spyOn(recording as unknown as Internals, '_runSetup').mockImplementation(
            () => new Promise<void>(resolve => {
                finish = resolve
            })
        )
        const internals = recording as unknown as Internals
        const first = internals._completeSetup()
        const second = internals._completeSetup()
        expect(second).toBe(first)
        expect(run).toHaveBeenCalledTimes(1)
        finish()
        await first
        expect(internals._completeSetup()).not.toBe(first)
        expect(run).toHaveBeenCalledTimes(2)
    })

    it('shares a failing setup with every caller and lets a later one run', async () => {
        const recording = new EmgRecording('rec', study(), workerStub)
        const run = vi.spyOn(recording as unknown as Internals, '_runSetup')
            .mockRejectedValueOnce(new Error('no memory'))
            .mockResolvedValue(undefined)
        const internals = recording as unknown as Internals
        const first = internals._completeSetup()
        const second = internals._completeSetup()
        await expect(first).rejects.toThrow('no memory')
        await expect(second).rejects.toThrow('no memory')
        await expect(internals._completeSetup()).resolves.toBeUndefined()
        expect(run).toHaveBeenCalledTimes(2)
    })
})

describe('a load that fails or is overtaken', () => {
    type Internals = { _getWorker: unknown, _service: unknown }

    it('shuts down the service it created when the worker cannot be prepared', async () => {
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue(null)
        const destroy = vi.spyOn(EmgService.prototype, 'destroy').mockResolvedValue(undefined)
        const recording = new EmgRecording('rec', study(), workerStub)
        expect(await recording.load()).toBe(false)
        expect(destroy).toHaveBeenCalledTimes(1)
        expect((recording as unknown as Internals)._service).toBe(null)
    })

    it('stops without a failure reason of its own when the recording is destroyed mid-load', async () => {
        let answer = (_value: unknown) => {}
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockReturnValue(new Promise(resolve => {
            answer = resolve
        }) as never)
        vi.spyOn(EmgService.prototype, 'destroy').mockResolvedValue(undefined)
        const recording = new EmgRecording('rec', study(), workerStub)
        // The buffer release waits on the worker, which is a stub here and not what is being pinned.
        vi.spyOn(recording, 'releaseBuffers').mockResolvedValue(undefined)
        const loaded = recording.load()
        await flush()
        await recording.destroy()
        answer(null)
        expect(await loaded).toBe(false)
        expect(recording.state).toBe('destroyed')
        expect(recording.errorReason).toBe('')
    })

    it('lets go of the worker source when it is destroyed', async () => {
        const recording = new EmgRecording('rec', study(), workerStub)
        await recording.destroy()
        expect((recording as unknown as Internals)._getWorker).toBe(null)
    })

    it('loads through prepare rather than being marked ready with no service', async () => {
        const prepare = vi.spyOn(EmgService.prototype, 'prepareWorker')
            .mockResolvedValue({ length: 6, samplingRate: 1000 })
        const recording = new EmgRecording('rec', study(), workerStub)
        expect(await recording.prepare()).toBe(true)
        expect(prepare).toHaveBeenCalledTimes(1)
        expect((recording as unknown as Internals)._service).toBeInstanceOf(EmgService)
    })

    it('builds no channels from a study that names no channel count', () => {
        const recording = new EmgRecording('rec', study({ nChannels: undefined }))
        expect(recording.channels.length).toBe(0)
        const meta = undefined as unknown as EmgStudyContext['meta']
        expect(() => new EmgRecording('rec', { name: 'Study', meta, files: [] } as never)).not.toThrow()
    })
})

describe('the deactivation listener', () => {
    it('unloads a closed recording when the settings ask for it', async () => {
        removeRuntimeGlobal()
        removeRuntimeGlobal = installRuntimeGlobal({ unloadOnClose: true })
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue({ length: 6, samplingRate: 1000 })
        const recording = new EmgRecording('rec', study(), workerStub)
        const unload = vi.spyOn(recording, 'unload').mockResolvedValue(undefined)
        Object.defineProperty(recording, '_service', { value: { isReady: true }, configurable: true })
        recording.isActive = true
        recording.isActive = false
        expect(unload).toHaveBeenCalled()
    })

    it('keeps a closed recording loaded by default', () => {
        // The shipped setting is false, which is what makes reopening cheap.
        const recording = new EmgRecording('rec', study(), workerStub)
        const unload = vi.spyOn(recording, 'unload').mockResolvedValue(undefined)
        Object.defineProperty(recording, '_service', { value: { isReady: true }, configurable: true })
        recording.isActive = true
        recording.isActive = false
        expect(unload).not.toHaveBeenCalled()
    })

    it('does not unload a recording whose service never became ready', () => {
        removeRuntimeGlobal()
        removeRuntimeGlobal = installRuntimeGlobal({ unloadOnClose: true })
        const recording = new EmgRecording('rec', study(), workerStub)
        const unload = vi.spyOn(recording, 'unload').mockResolvedValue(undefined)
        recording.isActive = true
        recording.isActive = false
        expect(unload).not.toHaveBeenCalled()
    })

    it('reports a failed unload rather than leaving the rejection unhandled', async () => {
        removeRuntimeGlobal()
        removeRuntimeGlobal = installRuntimeGlobal({ unloadOnClose: true })
        const recording = new EmgRecording('rec', study(), workerStub)
        vi.spyOn(recording, 'unload').mockRejectedValue(new Error('buffer pinned'))
        Object.defineProperty(recording, '_service', { value: { isReady: true }, configurable: true })
        recording.isActive = true
        recording.isActive = false
        await Promise.resolve()
        await Promise.resolve()
        const failure = (Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls
            .find(call => String(call[0]).includes('Unloading the EMG recording'))
        expect(failure).toBeDefined()
        expect(failure?.[2]).toBeInstanceOf(Error)
    })
})

describe('the sensitivity to gain link', () => {
    it('rescales the audio gain when the sensitivity changes', () => {
        const recording = new EmgRecording('rec', study(), workerStub)
        const setGain = vi.spyOn(recording, 'setAudioGain').mockImplementation(() => undefined)
        recording.sensitivity = 50e-6
        // Gain is inversely proportional to the sensitivity, unity at 25 µV/div.
        expect(setGain).toHaveBeenCalledWith(25e-6/50e-6)
    })

    it('treats a zero sensitivity as unity rather than dividing by it', () => {
        const recording = new EmgRecording('rec', study())
        expect(Number.isFinite(recording._sensitivityGain)).toBe(true)
    })
})

describe('getMainProperties', () => {
    it('reports the duration and the channel count of a ready recording', () => {
        const recording = new EmgRecording('rec', study({ nChannels: 2, duration: 6 }))
        recording.state = 'ready'
        const props = recording.getMainProperties()
        expect(props.get('duration')).toBe(6)
        expect(props.get('signals')).toBe(2)
    })

    it('leaves the base status line standing while the recording is not ready', () => {
        // The base reports a status message for every state short of ready, and this override adds
        // its own properties only when there is no status to show — so a loading recording shows
        // progress rather than a duration it does not have yet.
        const recording = new EmgRecording('rec', study(), workerStub)
        const props = recording.getMainProperties()
        expect(props.has('duration')).toBe(false)
        expect(props.has('signals')).toBe(false)
        expect(props.size).toBe(1)
    })

    it('reports the failure reason of an errored recording, not its channel count', () => {
        const recording = new EmgRecording('rec', study())
        recording.errorReason = 'Memory allocation failed'
        recording.state = 'error'
        const props = recording.getMainProperties()
        expect(props.has('Memory allocation failed')).toBe(true)
        expect(props.has('signals')).toBe(false)
    })
})

describe('destroy', () => {
    it('destroys the audio asset along with the recording', async () => {
        const recording = new EmgRecording('rec', study())
        const audio = (recording as unknown as { _audio: { destroy: () => void } })._audio
        const destroyAudio = vi.spyOn(audio, 'destroy')
        await recording.destroy()
        // The audio asset holds its own buffer and an AudioContext, neither of which the base class
        // knows about.
        expect(destroyAudio).toHaveBeenCalled()
    })
})

describe('the playback state surface', () => {
    it('starts not playing, at the start of the recording', () => {
        const recording = new EmgRecording('rec', study())
        expect(recording.isAudioPlaying).toBe(false)
        expect(recording.playbackPosition).toBe(0)
    })

    it('announces a playing flag change so a control can follow it', () => {
        const recording = new EmgRecording('rec', study())
        const seen: boolean[] = []
        recording.onPropertyChange('isAudioPlaying', value => seen.push(value as boolean), 'test')
        recording.isAudioPlaying = true
        expect(recording.isAudioPlaying).toBe(true)
        expect(seen).toEqual([true])
    })

    it('reports the asset position as the playback position', () => {
        const recording = new EmgRecording('rec', study())
        const audio = (recording as unknown as { _audio: object })._audio
        // `currentTime` is getter-only on the asset, so the position is faked at the getter.
        vi.spyOn(audio as { currentTime: number }, 'currentTime', 'get').mockReturnValue(4.5)
        expect(recording.playbackPosition).toBe(4.5)
    })

    it('clears the playing flag and announces both stop events when playback runs out', () => {
        // Reaching the end is not a pause: a control that listens only for the paused event would
        // never learn that playback finished, so the ended event is followed by the stopped one.
        const recording = new EmgRecording('rec', study())
        recording.isAudioPlaying = true
        const dispatched: string[] = []
        for (const event of ['emg-audio-playback-ended', 'emg-audio-playback-stopped']) {
            recording.addEventListener(event, () => dispatched.push(event), 'test')
        }
        const audio = recording as unknown as { _audio: { _playEndedCallbacks: (() => unknown)[] } }
        audio._audio._playEndedCallbacks.forEach(callback => callback())
        expect(recording.isAudioPlaying).toBe(false)
        expect(dispatched).toEqual(['emg-audio-playback-ended', 'emg-audio-playback-stopped'])
    })
})

describe('the memory manager', () => {
    // A host gives the study a reader in its own thread when `emg.useMemoryManager` is on, and that
    // reader can serve only a shared cache. Without the manager the recording commissioned a plain
    // cache it could never read, and every draw asked for an empty range.
    const manager = {} as never

    it('keeps the manager it is given while the module uses shared memory', () => {
        const recording = new EmgRecording('rec', study(), workerStub, manager)
        expect((recording as unknown as { _memoryManager: unknown })._memoryManager).toBe(manager)
    })

    it('hands the manager to the service it loads with', async () => {
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue({ length: 6, samplingRate: 1000 })
        const recording = new EmgRecording('rec', study(), workerStub, manager)
        await recording.load()
        const service = (recording as unknown as { _service: { _manager: unknown } })._service
        expect(service._manager).toBe(manager)
    })

    it('leaves the manager unused when the module does not use shared memory', () => {
        removeRuntimeGlobal()
        removeRuntimeGlobal = installRuntimeGlobal({ useMemoryManager: false })
        const recording = new EmgRecording('rec', study(), workerStub, manager)
        expect((recording as unknown as { _memoryManager: unknown })._memoryManager).toBeNull()
    })
})
