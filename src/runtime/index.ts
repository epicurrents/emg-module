/**
 * Epicurrents EMG module.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import { logInvalidMutation } from '@epicurrents/core/runtime'
import type {
    DataResource,
    RuntimeResourceModule,
    RuntimeResourceModuleConfig,
    SafeObject,
    StateManager,
} from '@epicurrents/core/types'
import type { EmgResource } from '#types'
import EmgRecording from '../EmgRecording'
import { safeObjectFrom } from '@epicurrents/core/util'

const SCOPE = 'emg-runtime-module'

const asError = (reason: unknown) => {
    return reason instanceof Error ? reason : new Error(String(reason))
}

const EMG = safeObjectFrom({
    moduleName: {
        code: 'emg',
        full: 'Electromyography',
        short: 'EMG',
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- the module contract returns a promise.
    async applyConfiguration (config: RuntimeResourceModuleConfig) {
        // The module name is the only configuration the contract carries; without this handling the
        // name stays at the English default whatever a deployment asks for.
        if (config.moduleName?.full) {
            EMG.moduleName.full = config.moduleName.full
        }
        if (config.moduleName?.short) {
            EMG.moduleName.short = config.moduleName.short
        }
    },
    getResourceFromSerialized (serialized: unknown) {
        return EmgRecording.fromSerialized(serialized as Partial<EmgResource>)
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
                logInvalidMutation(property, value, SCOPE, 'Value must be a positive number.')
                return
            }
            if (activeRes.filters?.highpass !== undefined) {
                activeRes.setHighpassFilter(value).catch((e: unknown) => {
                    Log.error(`Setting the highpass filter failed.`, SCOPE, asError(e))
                })
            }
        } else if (property === 'lowpass-filter') {
            if (typeof value !== 'number' || value < 0) {
                logInvalidMutation(property, value, SCOPE, 'Value must be a positive number.')
                return
            }
            if (activeRes.filters?.lowpass !== undefined) {
                activeRes.setLowpassFilter(value).catch((e: unknown) => {
                    Log.error(`Setting the lowpass filter failed.`, SCOPE, asError(e))
                })
            }
        } else if (property === 'notch-filter') {
            if (typeof value !== 'number' || value < 0) {
                logInvalidMutation(property, value, SCOPE, 'Value must be a positive number.')
                return
            }
            if (activeRes.filters?.notch !== undefined) {
                activeRes.setNotchFilter(value).catch((e: unknown) => {
                    Log.error(`Setting the notch filter failed.`, SCOPE, asError(e))
                })
            }
        } else if (property === 'sensitivity') {
            if (typeof value !== 'number' || value <= 0) {
                logInvalidMutation(property, value, SCOPE, 'Value must be a positive number.')
                return
            }
            if (activeRes.sensitivity !== undefined) {
                activeRes.sensitivity = value
            }
        } else if (property === 'timebase') {
            if (typeof value !== 'number' || value <= 0) {
                logInvalidMutation(property, value, SCOPE, 'Value must be a positive number.')
                return
            }
            if (activeRes.timebase !== undefined) {
                activeRes.timebase = value
            }
        } else if (property === 'timebase-unit') {
            if (typeof value !== 'string' || value === '') {
                logInvalidMutation(property, value, SCOPE, 'Value must be a non-empty string.')
                return
            }
            if (activeRes.timebaseUnit !== undefined) {
                activeRes.timebaseUnit = value
            }
        } else {
            logInvalidMutation(property, value, SCOPE, 'Unknown property.')
        }
    },
}) as SafeObject & RuntimeResourceModule
export default EMG
