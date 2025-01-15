import EmgLoader from '#loader/EmgLoader'
import EmgRecording from './EmgRecording'
import EmgService from '#service/EmgService'
import runtime from './runtime'
import settings from './config'

const modality = 'emg'

export {
    EmgLoader,
    EmgRecording,
    EmgService,
    modality,
    runtime,
    settings,
}