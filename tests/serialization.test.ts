/**
 * Tests for `EmgRecording.fromSerialized`.
 *
 * The deserialised path used to disagree with the constructor about how many channels an EMG
 * recording has: it mapped every channel that carried a signal and then truncated the result to one.
 * It also called `setAudioSignals` once per channel inside that map, so each call replaced the buffer
 * the previous one had built, and reported a failure to the console rather than the log.
 *
 * `setAudioSignals` reaches a real `AudioContext`, which jsdom does not provide, so the audio call is
 * observed through a spy on the prototype rather than by inspecting a buffer.
 *
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmgRecording from '../src/EmgRecording'
import { Log } from 'scoped-event-log'
import { installRuntimeGlobal } from './runtimeGlobal'
import type { EmgResource } from '../src/types'
import type { SourceChannel } from '@epicurrents/core/types'

vi.mock('scoped-event-log', async () => (await import('./logMock')).makeLogMock())

/**
 * A serialized channel carrying only the members `fromSerialized` reads. The cast is what makes it a
 * stub rather than a fixture: a real `SourceChannel` has twenty more members, none of which this path
 * touches.
 */
const channel = (over: Record<string, unknown> = {}) => ({
    signal: new Float32Array([0, 1, 2, 3]),
    samplingRate: 2,
    visible: true,
    ...over,
}) as unknown as SourceChannel

const template = (over: Partial<EmgResource> = {}) => ({
    name: 'Serialized EMG',
    dataDuration: 2,
    samplingRate: 2,
    channels: [channel(), channel()],
    ...over,
} as unknown as Partial<EmgResource>)

let audioSpy: ReturnType<typeof vi.spyOn>
let removeRuntimeGlobal: () => void

beforeEach(() => {
    vi.clearAllMocks()
    removeRuntimeGlobal = installRuntimeGlobal()
    audioSpy = vi.spyOn(EmgRecording.prototype, 'setAudioSignals').mockImplementation(() => undefined)
})
afterEach(() => {
    audioSpy.mockRestore()
    removeRuntimeGlobal()
})

describe('fromSerialized', () => {
    it('keeps every channel that carries a signal', () => {
        // The truncation to a single channel made a deserialised recording disagree with the one the
        // constructor builds from the same study.
        expect(EmgRecording.fromSerialized(template()).channels.length).toBe(2)
    })

    it('drops a channel with no signal', () => {
        const resource = EmgRecording.fromSerialized(template({
            channels: [channel(), channel({ signal: undefined })],
        }))
        expect(resource.channels.length).toBe(1)
    })

    it('numbers the fallback labels by position, not by how many channels were unnamed', () => {
        // The counter used to advance only on an unnamed channel, so with names present every
        // fallback label read `Ch 0`.
        const resource = EmgRecording.fromSerialized(template({
            channels: [channel({ name: 'named' }), channel(), channel()],
        }))
        expect(resource.channels.map(c => c.label)).toEqual(['Ch 1', 'Ch 2', 'Ch 3'])
    })

    it('keeps the names and labels a template does carry', () => {
        const resource = EmgRecording.fromSerialized(template({
            channels: [channel({ name: 'biceps', label: 'Biceps' })],
        }))
        expect(resource.channels[0].name).toBe('biceps')
        expect(resource.channels[0].label).toBe('Biceps')
    })

    it('gives an unnamed channel a distinct name per position', () => {
        const resource = EmgRecording.fromSerialized(template({
            channels: [channel(), channel()],
        }))
        expect(resource.channels.map(c => c.name)).toEqual(['channel_0', 'channel_1'])
    })

    it('falls back to the position when the template declares no index', () => {
        const resource = EmgRecording.fromSerialized(template({
            channels: [channel(), channel()],
        }))
        expect(resource.channels.map(c => c.index)).toEqual([0, 1])
    })

    it('hands every channel to the audio buffer in one call', () => {
        EmgRecording.fromSerialized(template())
        expect(audioSpy).toHaveBeenCalledTimes(1)
        expect(audioSpy.mock.calls[0].length).toBe(4)
    })

    it('makes no audio call for a template with no signals', () => {
        EmgRecording.fromSerialized(template({ channels: [] }))
        expect(audioSpy).not.toHaveBeenCalled()
    })

    it('reports a failed audio buffer through the log and still returns the resource', () => {
        // jsdom has no AudioContext, so this is the live behaviour of the real call — the failure
        // used to reach `console.log` and nothing else.
        audioSpy.mockImplementation(() => { throw new Error('no AudioContext') })
        const resource = EmgRecording.fromSerialized(template())
        expect(resource.state).toBe('ready')
        expect(resource.channels.length).toBe(2)
        const audioFailure = (Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls
            .find(call => String(call[0]).includes('audio signals'))
        expect(audioFailure).toBeDefined()
        // The error object reaches the log's error slot, which is what a `console.log` of it did not.
        expect(audioFailure?.[2]).toBeInstanceOf(Error)
    })

    it('carries the durations and the sampling rate across', () => {
        const resource = EmgRecording.fromSerialized(template({ dataDuration: 7, samplingRate: 500 }))
        expect(resource.dataDuration).toBe(7)
        // EMG recordings are continuous, so the total span is the cached span.
        expect(resource.totalDuration).toBe(7)
        expect(resource.samplingRate).toBe(500)
    })

    it('marks the cache as holding the whole recording', () => {
        const resource = EmgRecording.fromSerialized(template({ dataDuration: 3 }))
        expect(resource.signalCacheStatus[1]).toBe(3)
    })

    it('adopts the id the template carries', () => {
        expect(EmgRecording.fromSerialized(template({ id: 'emg-7' })).id).toBe('emg-7')
    })

    it('names an unnamed template rather than leaving it blank', () => {
        expect(EmgRecording.fromSerialized(template({ name: undefined })).name).toBe('EMG Recording')
    })

    it('reports itself ready', () => {
        expect(EmgRecording.fromSerialized(template()).state).toBe('ready')
    })

    it('skips a null entry among the channels instead of throwing on it', () => {
        // The template arrives from outside through `getResourceFromSerialized(serialized: unknown)`,
        // so a hole in the array is possible and must not take the whole deserialisation with it.
        const resource = EmgRecording.fromSerialized(template({
            channels: [channel(), null, channel()] as unknown as SourceChannel[],
        }))
        expect(resource.channels.length).toBe(2)
        expect(resource.state).toBe('ready')
    })

    it('accepts a template that names no duration without logging a core error', () => {
        const resource = EmgRecording.fromSerialized(template({ dataDuration: undefined }))
        expect(resource.dataDuration).toBe(0)
        // Core's `totalDuration` setter refuses a zero and logs an error doing so; a degenerate
        // template should not produce one.
        const refusal = (Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls
            .find(call => String(call[0]).includes('total duration'))
        expect(refusal).toBeUndefined()
    })

    it('claims no cached signal for a template carrying none', () => {
        // Claiming the full duration with no channels tells the display the cache holds data that
        // was never there, and nothing later corrects it.
        const resource = EmgRecording.fromSerialized(template({ channels: [], dataDuration: 5 }))
        expect(resource.signalCacheStatus[1]).toBeFalsy()
    })
})
