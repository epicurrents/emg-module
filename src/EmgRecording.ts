/**
 * Epicurrents EMG recording.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalResource } from '@epicurrents/core'
import type { StudyContext } from '@epicurrents/core/dist/types'
import EmgService from '#service/EmgService'
import type { EmgResource } from '#types'
//import { Log } from 'scoped-event-log'

//const SCOPE = "EmgRecording"
/**
 * Electromyography recording.
 */
export default class EmgRecording extends GenericBiosignalResource implements EmgResource {
    protected _service: EmgService
    protected _worker?: Worker
    /**
     * Create a new EMG recording.
     * @param name - Recording name; this will be displayed in the UI.
     * @param source - Recording source as a study context.
     * @param worker - Worker for the EMG service.
     */
    constructor (name: string, source: StudyContext, worker: Worker) {
        super(name, 'emg', source)
        this._service = new EmgService(this, worker)
        this._state = 'loading'
        this._service.prepareWorker(source).then((response) => {
            if (response.length) {
                this._state = 'ready'
            } else {
                this._errorReason = 'Preparing worker failed'
                this._state = 'error'
            }
        })
    }

    getMainProperties () {
        const props = super.getMainProperties()
        return props
    }
}
