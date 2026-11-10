/**
 * Tests for the EMG cascade: `EmgRecording.addCascadeMontages` and `EmgCascadeMontage`.
 *
 * The recording is a deserialised one, so its signals are in memory and the cascade's raw-signal
 * read is served without a worker. What is pinned is the montage per channel, the row geometry, and
 * that the ms/div timebase stays the recording's while a cascade is active.
 *
 * @package    epicurrents/emg-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EmgRecording from '../src/EmgRecording'
import EmgCascadeMontage from '../src/components/EmgCascadeMontage'
import { installRuntimeGlobal } from './runtimeGlobal'
import type { EmgResource } from '../src/types'
import type { BiosignalCascadeMontage, SourceChannel } from '@epicurrents/core/types'

vi.mock('scoped-event-log', async () => (await import('./logMock')).makeLogMock())

/** A ramp, so each sample says which time it came from: sample i holds i. */
const ramp = (length: number) => Float32Array.from({ length }, (_, i) => i)

const channel = (name: string, label: string) => ({
    name,
    label,
    signal: ramp(1000),
    samplingRate: 100,
    visible: true,
}) as unknown as SourceChannel

const recording = (channels = [channel('ch_0', 'EMG 1')]) => {
    const resource = EmgRecording.fromSerialized({
        name: 'Cascade EMG',
        dataDuration: 10,
        samplingRate: 100,
        channels,
    } as unknown as Partial<EmgResource>)
    resource.timebaseUnit = 'msPerD'
    resource.timebase = 10
    return resource
}

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

describe('addCascadeMontages', () => {
    it('adds one cascade per source channel, labelled with the channel', async () => {
        const resource = recording([channel('ch_0', 'EMG 1'), channel('ch_1', 'EMG 2')])
        const added = await resource.addCascadeMontages(5, 0.1)
        expect(added).toEqual(['cascade:ch_0', 'cascade:ch_1'])
        expect(resource.montages.map(m => m.label)).toEqual(['EMG 1', 'EMG 2'])
        expect(resource.montages[0]).toBeInstanceOf(EmgCascadeMontage)
    })

    it('keeps an existing cascade rather than adding a second', async () => {
        const resource = recording()
        await resource.addCascadeMontages(5, 0.1)
        const added = await resource.addCascadeMontages(8, 0.2)
        expect(added).toEqual(['cascade:ch_0'])
        expect(resource.montages.length).toBe(1)
        expect((resource.montages[0] as BiosignalCascadeMontage).rowCount).toBe(5)
    })

    it('builds the setup from the source channels in source order', async () => {
        const resource = recording([channel('ch_0', 'EMG 1'), channel('ch_1', 'EMG 2')])
        await resource.addCascadeMontages(5, 0.1)
        expect(resource.setup?.channels.map(c => [c.name, c.index])).toEqual([['ch_0', 0], ['ch_1', 1]])
    })

    it('adds nothing to a recording without channels', async () => {
        const resource = recording([])
        expect(await resource.addCascadeMontages(5, 0.1)).toEqual([])
    })
})

describe('EmgCascadeMontage', () => {
    it('cuts consecutive rows of the page length from the view start', async () => {
        const resource = recording()
        await resource.addCascadeMontages(4, 0.5)
        await resource.setActiveMontage('cascade:ch_0')
        resource.viewStart = 2
        const response = await resource.getAllSignals([2, 2.5])
        expect(response?.signals.length).toBe(4)
        // 100 Hz, so a 0.5 s row is 50 samples and the ramp gives each row's first sample its time × 100.
        expect(response?.signals.map(s => s.data.length)).toEqual([50, 50, 50, 50])
        expect(response?.signals.map(s => s.data[0])).toEqual([200, 250, 300, 350])
    })

    it('follows a reassigned page length', async () => {
        const resource = recording()
        await resource.addCascadeMontages(2, 0.5)
        await resource.setActiveMontage('cascade:ch_0')
        resource.activeMontage!.pageLength = 1
        const response = await resource.getAllSignals([0, 1])
        expect(response?.signals.map(s => s.data[0])).toEqual([0, 100])
        expect((resource.activeMontage as BiosignalCascadeMontage).pageStep).toBe(2)
    })

    it('reshapes the stack when the row count is reassigned', async () => {
        const resource = recording()
        await resource.addCascadeMontages(4, 0.5)
        const montage = resource.montages[0] as EmgCascadeMontage
        montage.rowCount = 6
        expect(montage.channels.length).toBe(6)
        expect(montage.pageStep).toBe(3)
        // Rows are spaced evenly again, top row first.
        expect(montage.channels[0].offset.top).toBeGreaterThan(montage.channels[5].offset.top)
        montage.rowCount = 0
        expect(montage.channels.length).toBe(6)
    })

    it('announces reshaped rows with their offsets already set', async () => {
        // A display rebuilds its traces inside the announcement, so offsets set after it draw every row at one height.
        const resource = recording()
        await resource.addCascadeMontages(4, 0.5)
        const montage = resource.montages[0] as EmgCascadeMontage
        const seen = [] as number[]
        montage.onPropertyChange('channels', () => {
            seen.push(...montage.channels.map(c => c.offset.baseline))
        })
        montage.rowCount = 3
        expect(seen.length).toBe(3)
        expect(new Set(seen).size).toBe(3)
    })

    it('leaves the ms/div timebase with the recording', async () => {
        const resource = recording()
        await resource.addCascadeMontages(4, 0.5)
        await resource.setActiveMontage('cascade:ch_0')
        expect(resource.timebaseUnit).toBe('msPerD')
        resource.timebase = 20
        expect(resource.timebase).toBe(20)
        // The row length is the display's to set; a timebase change does not reach it.
        expect(resource.activeMontage!.pageLength).toBe(0.5)
    })
})
