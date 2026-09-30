/**
 * Tests for the shipped EMG module settings.
 *
 * The one case worth having here is `filterChannelTypes`. Core's `getChannelFilters` propagates a
 * recording-level filter default to a channel only when the channel's modality is listed there, so
 * an omitted `'emg'` entry means every recording-level filter falls back to each channel's own zero.
 * The omission is invisible: the settings type has the field optional, the mutation succeeds, the
 * property-change event fires and no signal changes.
 *
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { describe, expect, it } from 'vitest'
import emgSettings from '../src/config'
import { getChannelFilters } from '@epicurrents/core/util'
import type { BiosignalChannel } from '@epicurrents/core/types'

const emgChannel = (over: Partial<BiosignalChannel> = {}) => ({
    name: 'ch_0',
    modality: 'emg',
    highpassFilter: null,
    lowpassFilter: null,
    notchFilter: null,
    ...over,
}) as unknown as BiosignalChannel

describe('filterChannelTypes', () => {
    it('lists the EMG modality', () => {
        expect(emgSettings.filterChannelTypes?.emg).toBeDefined()
    })

    it('propagates all three recording-level filters to an EMG channel', () => {
        // Without the entry each of these resolves to zero, whatever the recording default says.
        const filters = getChannelFilters(
            emgChannel(),
            { bandreject: [], highpass: 20, lowpass: 500, notch: 50 },
            emgSettings,
        )
        expect(filters.highpass).toBe(20)
        expect(filters.lowpass).toBe(500)
        expect(filters.notch).toBe(50)
    })

    it('lets a channel switch a filter off without the default coming back', () => {
        const filters = getChannelFilters(
            emgChannel({ highpassFilter: 0 }),
            { bandreject: [], highpass: 20, lowpass: 500, notch: 50 },
            emgSettings,
        )
        expect(filters.highpass).toBe(0)
        expect(filters.lowpass).toBe(500)
    })

    it('lets a channel override a filter with its own value', () => {
        const filters = getChannelFilters(
            emgChannel({ highpassFilter: 100 }),
            { bandreject: [], highpass: 20, lowpass: 500, notch: 50 },
            emgSettings,
        )
        expect(filters.highpass).toBe(100)
    })

    it('leaves a channel of another modality on its own values', () => {
        const filters = getChannelFilters(
            emgChannel({ modality: 'ekg' }),
            { bandreject: [], highpass: 20, lowpass: 500, notch: 50 },
            emgSettings,
        )
        expect(filters.highpass).toBe(0)
    })
})

describe('the shipped defaults', () => {
    it('declares every field the common biosignal settings require', () => {
        // A missing required field is a type error rather than a runtime one, so this case is about
        // the values a deployment inherits rather than about their presence.
        expect(emgSettings.events.convertPatterns).toEqual([])
        expect(emgSettings.events.ignorePatterns).toEqual([])
        expect(emgSettings.showHiddenChannels).toBe(false)
        expect(emgSettings.showMissingChannels).toBe(false)
    })

    it('keeps a closed recording in memory', () => {
        // EMG recordings are short and reopened often, and the audio buffer is rebuilt from the
        // cached signals, so dropping them on close costs a full reload.
        expect(emgSettings.unloadOnClose).toBe(false)
    })

    it('uses the central memory manager', () => {
        expect(emgSettings.useMemoryManager).toBe(true)
    })

    it('pads filtered signal edges', () => {
        expect(emgSettings.filterPaddingSeconds).toBeGreaterThan(0)
    })
})
