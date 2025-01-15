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
        if (property === '') {
            if (typeof value !== 'number') {
                logInvalidMutation(property, value, SCOPE)
                return
            }
        }
    },
}
export default EMG
