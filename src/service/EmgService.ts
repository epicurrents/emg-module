/**
 * Epicurrents EMG service.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalService } from '@epicurrents/core'
import type { StudyContext, WorkerResponse } from '@epicurrents/core/types'
import type { EmgDataService, EmgResource, SetupEmgWorkerResponse } from '#types'
import { Log } from 'scoped-event-log'

const SCOPE = 'EmgService'

export default class EmgService extends GenericBiosignalService implements EmgDataService {

    get worker () {
        return this._worker
    }

    constructor (recording: EmgResource, worker: Worker) {
        super(recording, worker)
        // The listener slot is synchronous while the handler is not, so the rejection has to be
        // caught here; unhandled, a malformed worker message would be reported nowhere.
        this._worker?.addEventListener('message', (message: MessageEvent) => {
            this.handleMessage(message as WorkerResponse).catch((e: unknown) => {
                Log.error(`Handling a worker message failed.`, SCOPE, e instanceof Error ? e : new Error(String(e)))
            })
        })
    }

    async handleMessage (message: WorkerResponse) {
        const data = message.data
        if (!data) {
            return false
        }
        return super.handleMessage(message)
    }

    async prepareWorker (study: StudyContext) {
        // Find the data file. A study that reaches this point without one cannot be set up, and
        // destructuring the absent entry throws a message that names neither the study nor the role.
        const dataFile = study.files.find(f => f.role === 'data')
        if (!dataFile) {
            Log.error(`Study '${study.name}' has no data file to set the worker up with.`, SCOPE)
            return null
        }
        const { file, url } = dataFile
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
