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

describe('the service', () => {
    it('stays unstarted without a worker, leaving the recording where it was', () => {
        const recording = new EmgRecording('rec', study())
        // No worker means no service to prepare, so the state never advances to loading.
        expect(recording.state).not.toBe('loading')
    })

    it('reports itself loading while the worker prepares', () => {
        const recording = new EmgRecording('rec', study(), workerStub())
        expect(recording.state).toBe('loading')
    })

    it('reports itself ready once the worker answers', async () => {
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue({ length: 6, samplingRate: 1000 })
        const recording = new EmgRecording('rec', study(), workerStub())
        await Promise.resolve()
        await Promise.resolve()
        expect(recording.state).toBe('ready')
    })

    it('reports an error when the worker answers with nothing', async () => {
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue(null)
        const recording = new EmgRecording('rec', study(), workerStub())
        await Promise.resolve()
        await Promise.resolve()
        expect(recording.state).toBe('error')
        expect(recording.errorReason).toBe('Preparing worker failed')
    })

    it('reports an error when preparing the worker rejects', async () => {
        // Before the catch was added this rejection had no handler at all: the recording stayed in
        // `loading` for the rest of the session and nothing said why.
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockRejectedValue(new Error('worker gone'))
        const recording = new EmgRecording('rec', study(), workerStub())
        await Promise.resolve()
        await Promise.resolve()
        expect(recording.state).toBe('error')
        expect(recording.errorReason).toBe('Preparing worker failed')
        const failure = (Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls
            .find(call => String(call[0]).includes('Preparing the EMG worker'))
        expect(failure?.[2]).toBeInstanceOf(Error)
    })
})

describe('the activation listener', () => {
    it('reports a failed setup rather than leaving the rejection unhandled', async () => {
        const recording = new EmgRecording('rec', study(), workerStub())
        const failing = vi.spyOn(
            recording as unknown as { _completeSetup: () => Promise<void> },
            '_completeSetup',
        ).mockRejectedValue(new Error('no memory'))
        // `isActive` is what dispatches ACTIVATE, which is what the listener is attached to.
        recording.state = 'ready'
        recording.isActive = true
        await Promise.resolve()
        await Promise.resolve()
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
        const recording = new EmgRecording('rec', study(), workerStub())
        vi.spyOn(
            recording as unknown as { _completeSetup: () => Promise<void> },
            '_completeSetup',
        ).mockRejectedValue(new Error('no memory'))
        recording.state = 'ready'
        recording.isActive = true
        return Promise.resolve().then(() => Promise.resolve()).then(() => {
            expect(recording.isActive).toBe(false)
        })
    })
})

describe('the deactivation listener', () => {
    it('unloads a closed recording when the settings ask for it', async () => {
        removeRuntimeGlobal()
        removeRuntimeGlobal = installRuntimeGlobal({ unloadOnClose: true })
        vi.spyOn(EmgService.prototype, 'prepareWorker').mockResolvedValue({ length: 6, samplingRate: 1000 })
        const recording = new EmgRecording('rec', study(), workerStub())
        const unload = vi.spyOn(recording, 'unload').mockResolvedValue(undefined)
        Object.defineProperty(recording, '_service', { value: { isReady: true }, configurable: true })
        recording.isActive = true
        recording.isActive = false
        expect(unload).toHaveBeenCalled()
    })

    it('keeps a closed recording loaded by default', () => {
        // The shipped setting is false, which is what makes reopening cheap.
        const recording = new EmgRecording('rec', study(), workerStub())
        const unload = vi.spyOn(recording, 'unload').mockResolvedValue(undefined)
        Object.defineProperty(recording, '_service', { value: { isReady: true }, configurable: true })
        recording.isActive = true
        recording.isActive = false
        expect(unload).not.toHaveBeenCalled()
    })

    it('does not unload a recording whose service never became ready', () => {
        removeRuntimeGlobal()
        removeRuntimeGlobal = installRuntimeGlobal({ unloadOnClose: true })
        const recording = new EmgRecording('rec', study(), workerStub())
        const unload = vi.spyOn(recording, 'unload').mockResolvedValue(undefined)
        recording.isActive = true
        recording.isActive = false
        expect(unload).not.toHaveBeenCalled()
    })

    it('reports a failed unload rather than leaving the rejection unhandled', async () => {
        removeRuntimeGlobal()
        removeRuntimeGlobal = installRuntimeGlobal({ unloadOnClose: true })
        const recording = new EmgRecording('rec', study(), workerStub())
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
        const recording = new EmgRecording('rec', study(), workerStub())
        const setGain = vi.spyOn(recording, 'setAudioGain').mockImplementation(() => undefined)
        recording.sensitivity = 50
        // The signals are in volts while the display is in microvolts, so the gain is the inverse of
        // the sensitivity scaled by that factor.
        expect(setGain).toHaveBeenCalledWith(1e-6/50)
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
        const recording = new EmgRecording('rec', study(), workerStub())
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
