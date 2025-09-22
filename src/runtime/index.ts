/**
 * Epicurrents EMG module.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { logInvalidMutation } from '@epicurrents/core/dist/runtime'
import type {
    DataResource,
    RuntimeResourceModule,
    SafeObject,
    StateManager,
} from '@epicurrents/core/dist/types'
import type { EmgResource } from '#types'

const SCOPE = 'emg-runtime-module'

const EMG: SafeObject & RuntimeResourceModule = {
    __proto__: null,
    moduleName: {
        code: 'emg',
        full: 'Electromyography',
        short: 'EMG',
    },
    async applyConfiguration (_config) {

    },
    setPropertyValue (property: string, value: unknown, resource?: DataResource, state?: StateManager) {
        // EMG specific property mutations.
        const activeRes = resource
                          ? resource as EmgResource
                          : state
                            ? state.APP.activeDataset?.activeResources[0] as EmgResource
                            : null
        if (!activeRes) {
            return
        }
        if (property === 'highpass-filter') {
            if (typeof value !== 'number' || value < 0) {
                logInvalidMutation(property, value, SCOPE, "Value must be a positive number.")
                return
            }
            if (activeRes.filters?.highpass !== undefined) {
                activeRes.setHighpassFilter(value)
            }
        } else if (property === 'lowpass-filter') {
            if (typeof value !== 'number' || value < 0) {
                logInvalidMutation(property, value, SCOPE, "Value must be a positive number.")
                return
            }
            if (activeRes.filters?.lowpass !== undefined) {
                activeRes.setLowpassFilter(value)
            }
        } else if (property === 'notch-filter') {
            if (typeof value !== 'number' || value < 0) {
                logInvalidMutation(property, value, SCOPE, "Value must be a positive number.")
                return
            }
            if (activeRes.filters?.notch !== undefined) {
                activeRes.setNotchFilter(value)
            }
        } else if (property === 'sensitivity') {
            if (typeof value !== 'number' || value <= 0) {
                logInvalidMutation(property, value, SCOPE, "Value must be a positive number.")
                return
            }
            if (activeRes.sensitivity !== undefined) {
                activeRes.sensitivity = value
            }
        } else if (property === 'timebase') {
            if (typeof value !== 'number' || value <= 0) {
                logInvalidMutation(property, value, SCOPE, "Value must be a positive number.")
                return
            }
            if (activeRes.timebase !== undefined) {
                activeRes.timebase = value
            }
        } else if (property === 'timebase-unit') {
            if (typeof value !== 'string' || value === '') {
                logInvalidMutation(property, value, SCOPE, "Value must be a non-empty string.")
                return
            }
            if (activeRes.timebaseUnit !== undefined) {
                activeRes.timebaseUnit = value
            }
        } else {
            logInvalidMutation(property, value, SCOPE, "Unknown property.")
        }
    },
}
export default EMG
