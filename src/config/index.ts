/**
 * Epicurrents EMG settings.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { BiosignalAnnotation } from '@epicurrents/core/dist/types'
import type { EmgModuleSettings } from '#types'

const emgSettings: EmgModuleSettings = {
    annotations: {
        convertPatterns: [] as [string, BiosignalAnnotation][],
        ignorePatterns: [] as string[],
    },
    defaultMontages: {},
    defaultSetups: [],
    filterChannelTypes: {},
    filterPaddingSeconds: 10,
    filters: {
        highpass: {
            availableValues: [],
            default: 0,
        },
        lowpass: {
            availableValues: [],
            default: 0,
        },
        notch: {
            availableValues: [0, 50, 60],
            default: 0,
        },
    },
    montages: {
        cacheMax: 1,
        preCache: false,
    },
    notchDefaultFrequency: 0,
    scale: {
        availableValues: [-3, -2, -1, 0, 1, 2, 3],
        default: 0,
    },
    showHiddenChannels: false,
    showMissingChannels: false,
    unloadOnClose: false,
    useMemoryManager: true,
}
export default emgSettings
