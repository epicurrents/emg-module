/**
 * Public surface of the EMG module.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import EmgEvent from '#components/EmgEvent'
import { EmgEvents } from '#events'
import EmgLabel from '#components/EmgLabel'
import EmgRecording from './EmgRecording'
import EmgService from '#service/EmgService'
import EmgSourceChannel from '#components/EmgSourceChannel'
import EmgStudyLoader from '#loader/EmgStudyLoader'
import runtime from './runtime'
import settings from './config'

const modality = 'emg'

export {
    EmgEvent,
    EmgEvents,
    EmgLabel,
    EmgRecording,
    EmgService,
    EmgSourceChannel,
    EmgStudyLoader,
    modality,
    runtime,
    settings,
}
export type {
    EmgDataService,
    EmgModuleSettings,
    EmgResource,
    EmgStudyContext,
    SetupEmgWorkerResponse,
} from '#types'
export type { EmgModuleEvent } from '#events'
