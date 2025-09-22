/**
 * Epicurrents EMG service.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalService } from '@epicurrents/core'
import type { StudyContext, WorkerResponse } from '@epicurrents/core/dist/types'
import type { EmgDataService, EmgResource, SetupEmgWorkerResponse } from '#types'
//import { Log } from 'scoped-event-log'

//const SCOPE = "EmgService"

export default class EmgService extends GenericBiosignalService implements EmgDataService {

    get worker () {
        return this._worker
    }

    constructor (recording: EmgResource, worker: Worker) {
        super (recording, worker)
        this._worker?.addEventListener('message', this.handleMessage.bind(this))
    }

    async handleMessage (message: WorkerResponse) {
        const data = message.data
        if (!data) {
            return false
        }
        return super.handleMessage(message)
    }

    async prepareWorker (study: StudyContext) {
        // Find the data file.
        const { file, url } = study.files.filter(f => f.role === 'data')[0]
        const commission = this._commissionWorker(
            'setup-worker',
            new Map<string, unknown>([
                ['file', file],
                ['url', url],
            ])
        )
        return commission.promise as Promise<SetupEmgWorkerResponse>
    }
}
