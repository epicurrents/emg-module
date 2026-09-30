/**
 * Tests for `EmgRecording._completeSetup`, the one-time commissioning of the signal cache.
 *
 * The method is exercised through `EmgRecording.prototype` against a stub carrying only the members
 * it reads. What is being pinned is the memory budget, the ordering of the events it dispatches and
 * the three failure exits — booting a real resource (worker, memory manager, SAB) would add no
 * coverage to any of those.
 *
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmgRecording from '../src/EmgRecording'
import { BiosignalMutex } from '@epicurrents/core'

vi.mock('scoped-event-log', async () => (await import('./logMock')).makeLogMock())

const completeSetup = (context: object) =>
    (EmgRecording.prototype as unknown as Record<string, (this: unknown) => Promise<void>>)
        ._completeSetup.call(context)

type Ctx = ReturnType<typeof makeContext>

const makeContext = (over: Record<string, unknown> = {}) => ({
    _state: 'ready' as string,
    _dataDuration: 10,
    _samplingRate: 1000,
    _memoryManager: {} as object | null,
    _service: {
        isReady: false,
        requestMemory: vi.fn().mockResolvedValue(true),
        getSignals: vi.fn().mockResolvedValue(null),
    } as Record<string, unknown> | null,
    channels: [{ samplingRate: 1000 }, { samplingRate: 1000 }],
    state: '' as string,
    errorReason: '' as string,
    isActive: true,
    dispatchEvent: vi.fn(),
    setupMutex: vi.fn().mockResolvedValue({}),
    setupCache: vi.fn().mockResolvedValue({}),
    cacheSignals: vi.fn().mockResolvedValue(true),
    setAudioSignals: vi.fn(),
    ...over,
})

const requestedFloats = (context: Ctx) =>
    ((context._service as Record<string, ReturnType<typeof vi.fn>>).requestMemory.mock.calls[0][0]) as number

/**
 * The per-channel cases below restate the arithmetic they check, which detects a change to it but
 * cannot say it is right. The first case is the one that does not: it derives the fixed part from
 * core's own field positions.
 */
describe('the memory budget', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('reserves the mutex lock cell and every meta field core declares', async () => {
        // Derived from core's own field positions rather than written out, so a meta field added
        // there fails this case and names the budget instead of corrupting a buffer quietly.
        const metaFields = Math.max(
            BiosignalMutex.RANGE_ALLOCATED_POS,
            BiosignalMutex.RANGE_START_POS,
            BiosignalMutex.RANGE_END_POS,
            BiosignalMutex.DATA_UNIT_DURATION_POS,
            BiosignalMutex.WINDOW_EPOCH_POS,
        ) + 1
        const context = makeContext({ channels: [] })
        await completeSetup(context)
        expect(requestedFloats(context)).toBe(1 + metaFields)
        // Stated as a literal too: the derivation above and the constant in the source could drift
        // together if core renumbered its fields without adding one.
        expect(requestedFloats(context)).toBe(6)
    })

    it('adds each channel its samples and its own meta header', async () => {
        const context = makeContext()
        await completeSetup(context)
        // 6 for the mutex, then per channel 1000 Hz x 10 s plus the per-signal header.
        expect(requestedFloats(context)).toBe(6 + 2*(1000*10 + BiosignalMutex.SIGNAL_DATA_POS))
    })

    it('sizes the request from the cached duration, not the total span', async () => {
        const context = makeContext({ _dataDuration: 4, channels: [{ samplingRate: 500 }] })
        await completeSetup(context)
        expect(requestedFloats(context)).toBe(6 + 500*4 + BiosignalMutex.SIGNAL_DATA_POS)
    })

    it('scales with the sampling rate of each channel independently', async () => {
        const context = makeContext({ channels: [{ samplingRate: 1000 }, { samplingRate: 250 }] })
        await completeSetup(context)
        expect(requestedFloats(context)).toBe(6 + (1000*10 + 250*10) + 2*BiosignalMutex.SIGNAL_DATA_POS)
    })
})

describe('_completeSetup', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('runs the mutex path when a memory manager is present', async () => {
        const context = makeContext()
        await completeSetup(context)
        expect(context.setupMutex).toHaveBeenCalled()
        expect(context.setupCache).not.toHaveBeenCalled()
    })

    it('runs the plain cache path without a memory manager', async () => {
        const context = makeContext({ _memoryManager: null })
        await completeSetup(context)
        expect(context.setupCache).toHaveBeenCalled()
        expect(context._service?.requestMemory).not.toHaveBeenCalled()
    })

    it('does nothing once the service is ready', async () => {
        // The listener fires on every activation; only the first one may commission the cache.
        const context = makeContext({ _service: { isReady: true, requestMemory: vi.fn(), getSignals: vi.fn() } })
        await completeSetup(context)
        expect(context.setupMutex).not.toHaveBeenCalled()
        expect(context.dispatchEvent).not.toHaveBeenCalled()
    })

    it('does nothing while the recording is not yet ready', async () => {
        const context = makeContext({ _state: 'loading' })
        await completeSetup(context)
        expect(context.setupMutex).not.toHaveBeenCalled()
    })

    it('fills the cache and announces it after the setup completes', async () => {
        const context = makeContext()
        await completeSetup(context)
        expect(context.cacheSignals).toHaveBeenCalled()
        const dispatched = context.dispatchEvent.mock.calls.map(c => c[0] as string)
        expect(dispatched).toEqual(['initial-setup', 'initial-setup', 'signal-caching-complete'])
        expect(context.dispatchEvent.mock.calls[0][1]).toBe('before')
        expect(context.dispatchEvent.mock.calls[1][1]).toBe('after')
    })

    it('hands the cached signals to the audio buffer once caching completes', async () => {
        const left = new Float32Array([1, 2])
        const right = new Float32Array([3, 4])
        const context = makeContext({
            _service: {
                isReady: false,
                requestMemory: vi.fn().mockResolvedValue(true),
                getSignals: vi.fn().mockResolvedValue({ signals: [{ data: left }, { data: right }] }),
            },
        })
        await completeSetup(context)
        // Every channel in one call: a call per channel would leave only the last one audible.
        expect(context.setAudioSignals).toHaveBeenCalledTimes(1)
        expect(context.setAudioSignals).toHaveBeenCalledWith(10, 1000, left, right)
    })

    it('leaves the audio buffer alone when the service returns no signals', async () => {
        const context = makeContext()
        await completeSetup(context)
        expect(context.setAudioSignals).not.toHaveBeenCalled()
    })
})

describe('the failure exits', () => {
    beforeEach(() => { vi.clearAllMocks() })

    /** Each exit has to set a state, a reason and deactivate — a caller that cannot see the
     *  promise learns the outcome only from the resource. */
    const expectRefused = (context: Ctx, reason: string) => {
        expect(context.state).toBe('error')
        expect(context.errorReason).toBe(reason)
        expect(context.isActive).toBe(false)
        expect(context.cacheSignals).not.toHaveBeenCalled()
    }

    it('refuses when the memory request is declined', async () => {
        const context = makeContext({
            _service: {
                isReady: false,
                requestMemory: vi.fn().mockResolvedValue(false),
                getSignals: vi.fn(),
            },
        })
        await completeSetup(context)
        expectRefused(context, 'Memory allocation failed')
        expect(context.setupMutex).not.toHaveBeenCalled()
    })

    it('refuses when the mutex cannot be set up', async () => {
        const context = makeContext({ setupMutex: vi.fn().mockResolvedValue(null) })
        await completeSetup(context)
        expectRefused(context, 'Mutex setup failed')
    })

    it('refuses when the plain cache cannot be set up', async () => {
        const context = makeContext({ _memoryManager: null, setupCache: vi.fn().mockResolvedValue(null) })
        await completeSetup(context)
        expectRefused(context, 'Data cache setup failed')
    })

    it('announces the setup start before it can fail, and never its completion', async () => {
        const context = makeContext({ setupMutex: vi.fn().mockResolvedValue(null) })
        await completeSetup(context)
        const dispatched = context.dispatchEvent.mock.calls.map(c => c[0] as string)
        expect(dispatched).toEqual(['initial-setup'])
    })
})
