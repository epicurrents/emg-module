import EmgEvent from '#components/EmgEvent'
import EmgLabel from './components/EmgLabel'
import EmgRecording from './EmgRecording'
import EmgService from '#service/EmgService'
import EmgSourceChannel from '#components/EmgSourceChannel'
import EmgStudyLoader from '#loader/EmgStudyLoader'
import runtime from './runtime'
import settings from './config'

const modality = 'emg'

export {
    EmgEvent,
    EmgLabel,
    EmgRecording,
    EmgService,
    EmgSourceChannel,
    EmgStudyLoader,
    modality,
    runtime,
    settings,
}
