import EmgAnnotation from '#components/EmgAnnotation'
import EmgRecording from './EmgRecording'
import EmgService from '#service/EmgService'
import EmgSourceChannel from '#components/EmgSourceChannel'
import EmgStudyLoader from '#loader/EmgStudyLoader'
import runtime from './runtime'
import settings from './config'

const modality = 'emg'

export {
    EmgAnnotation,
    EmgRecording,
    EmgService,
    EmgSourceChannel,
    EmgStudyLoader,
    modality,
    runtime,
    settings,
}
