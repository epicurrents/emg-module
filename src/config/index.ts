/**
 * Epicurrents EMG settings.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { BiosignalAnnotationEvent } from '@epicurrents/core/types'
import type { EmgModuleSettings } from '#types'

const emgSettings: EmgModuleSettings = {
    events: {
        convertPatterns: [] as [string, BiosignalAnnotationEvent][],
        ignorePatterns: [] as string[],
    },
    // Modality to the list of filter types whose recording-level default propagates to channels of
    // that modality. Without an entry for `'emg'`, `getChannelFilters` falls back to each channel's
    // own (zero) value and the recording-level filters set through the runtime module reach no
    // channel at all.
    //
    // Declaring it does not by itself make an EMG recording filterable: `MontageProcessor` is the
    // only place signals are filtered, and this module defines no montage. See ROADMAP.md.
    filterChannelTypes: {
        emg: ['highpass', 'lowpass', 'notch'],
    },
    filterPaddingSeconds: 0.1,
    showHiddenChannels: false,
    showMissingChannels: false,
    unloadOnClose: false,
    useMemoryManager: true,
}
export default emgSettings
