/**
 * Tests for `EmgRecording`'s audio playback surface.
 *
 * EMG audio is the one thing this module has that the other biosignal modules do not, and it is
 * driven entirely from the UI, so what matters is the event pairs a control listens for and the
 * boolean each method answers. The methods are exercised through `EmgRecording.prototype` against a
 * stub audio asset: a real `BiosignalAudio` mints an `AudioContext`, which jsdom does not provide.
 *
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmgRecording from '../src/EmgRecording'
import { Log } from 'scoped-event-log'

vi.mock('scoped-event-log', async () => (await import('./logMock')).makeLogMock())

type Method = 'pauseAudio' | 'playAudio' | 'rewindAudio' | 'setAudioGain' | 'setAudioSignals'

const call = (method: Method, context: object, ...args: unknown[]) =>
    (EmgRecording.prototype as unknown as Record<string, (this: unknown, ...a: unknown[]) => unknown>)
        [method].call(context, ...args)

/**
 * A recording stub carrying the members the audio methods touch.
 *
 * `_audio` is merged after the rest of the override rather than inside it: a trailing spread of
 * `over` would replace the whole asset with whichever member a case names, so a case overriding
 * `pause` would silently lose `currentTime` and test a different code path than it reads as testing.
 */
const makeContext = (over: Record<string, unknown> = {}) => {
    const { _audio: audioOver, ...rest } = over
    return {
        isAudioPlaying: false,
        dispatchEvent: vi.fn(),
        dispatchPayloadEvent: vi.fn(),
        ...rest,
        _audio: {
            currentTime: 3,
            pause: vi.fn(),
            play: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn(),
            setGain: vi.fn(),
            setSignals: vi.fn(),
            sampleMaxAbsValue: 0,
            ...(audioOver as object ?? {}),
        },
    }
}

const phases = (context: ReturnType<typeof makeContext>, payload = false) =>
    (payload ? context.dispatchPayloadEvent : context.dispatchEvent).mock.calls
        .map(c => [c[0] as string, (payload ? c[2] : c[1]) as string | undefined])

beforeEach(() => { vi.clearAllMocks() })

describe('pauseAudio', () => {
    it('pauses the asset and reports success', () => {
        const context = makeContext({ isAudioPlaying: true })
        expect(call('pauseAudio', context)).toBe(true)
        expect(context._audio.pause).toHaveBeenCalled()
        expect(context.isAudioPlaying).toBe(false)
    })

    it('announces the pause before and after it happens, with the position both times', () => {
        const context = makeContext({ isAudioPlaying: true })
        call('pauseAudio', context)
        expect(phases(context, true)).toEqual([
            ['emg-audio-playback-paused', 'before'],
            ['emg-audio-playback-paused', undefined],
        ])
        expect(context.dispatchPayloadEvent.mock.calls[0][1]).toEqual({ position: 3 })
    })

    it('reports failure and logs when the asset throws', () => {
        const context = makeContext({ _audio: { pause: vi.fn(() => { throw new Error('no context') }) } })
        expect(call('pauseAudio', context)).toBe(false)
        expect((Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
    })

    it('leaves the playing flag set when the pause failed', () => {
        // A control reading the flag would otherwise show stopped while the audio plays on.
        const context = makeContext({
            isAudioPlaying: true,
            _audio: { pause: vi.fn(() => { throw new Error('no context') }) },
        })
        call('pauseAudio', context)
        expect(context.isAudioPlaying).toBe(true)
    })
})

describe('playAudio', () => {
    it('starts the asset and reports success', async () => {
        const context = makeContext()
        await expect(call('playAudio', context, 5)).resolves.toBe(true)
        expect(context._audio.play).toHaveBeenCalledWith(5)
        expect(context.isAudioPlaying).toBe(true)
    })

    it('continues from the current position when given none', async () => {
        const context = makeContext()
        await call('playAudio', context)
        expect(context._audio.play).toHaveBeenCalledWith(undefined)
    })

    it('announces the start before and after it happens', async () => {
        const context = makeContext()
        await call('playAudio', context, 5)
        expect(phases(context, true)).toEqual([
            ['emg-audio-playback-started', 'before'],
            ['emg-audio-playback-started', undefined],
        ])
    })

    it('reports failure and leaves the flag clear when the asset rejects', async () => {
        const context = makeContext({ _audio: { play: vi.fn().mockRejectedValue(new Error('blocked')) } })
        await expect(call('playAudio', context)).resolves.toBe(false)
        expect(context.isAudioPlaying).toBe(false)
        expect((Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
    })
})

describe('rewindAudio', () => {
    it('stops the asset and reports success', () => {
        const context = makeContext({ isAudioPlaying: true })
        expect(call('rewindAudio', context)).toBe(true)
        expect(context._audio.stop).toHaveBeenCalled()
        expect(context.isAudioPlaying).toBe(false)
    })

    it('announces the stop before and after it happens', () => {
        const context = makeContext({ isAudioPlaying: true })
        call('rewindAudio', context)
        expect(phases(context)).toEqual([
            ['emg-audio-playback-stopped', 'before'],
            ['emg-audio-playback-stopped', undefined],
        ])
    })

    it('reports failure when the asset throws', () => {
        const context = makeContext({ _audio: { stop: vi.fn(() => { throw new Error('no context') }) } })
        expect(call('rewindAudio', context)).toBe(false)
    })
})

describe('setAudioSignals', () => {
    it('caps the sample scale at the largest amplitude EMG produces', () => {
        // The asset normalises against this, so a cap left at zero silences the playback and one set
        // far too high makes every recording inaudibly quiet.
        const context = makeContext()
        call('setAudioSignals', context, 10, 1000, new Float32Array([0, 1]))
        expect(context._audio.sampleMaxAbsValue).toBe(0.05)
    })

    it('passes the duration, rate and every channel through to the asset', () => {
        const context = makeContext()
        const left = new Float32Array([0, 1])
        const right = new Float32Array([2, 3])
        call('setAudioSignals', context, 10, 1000, left, right)
        expect(context._audio.setSignals).toHaveBeenCalledWith(10, 1000, left, right)
    })
})

describe('setAudioGain', () => {
    it('passes the gain through to the asset', () => {
        const context = makeContext()
        call('setAudioGain', context, 0.5)
        expect(context._audio.setGain).toHaveBeenCalledWith(0.5)
    })
})
