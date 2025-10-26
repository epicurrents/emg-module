/**
 * Epicurrents EMG settings.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { BiosignalAnnotationEvent, BiosignalAnnotationLabel } from '@epicurrents/core/dist/types'
import type { EmgModuleSettings } from '#types'

const emgSettings: EmgModuleSettings = {
    events: {
        convertPatterns: [] as [string, BiosignalAnnotationEvent][],
        ignorePatterns: [] as string[],
    },
    filterPaddingSeconds: 0.1,
    labels: {
        convertPatterns: [] as [string, BiosignalAnnotationLabel][],
        ignorePatterns: [] as string[],
    },
    showHiddenChannels: false,
    showMissingChannels: false,
    unloadOnClose: false,
    useMemoryManager: true,
}
export default emgSettings
