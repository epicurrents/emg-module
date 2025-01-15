/**
 * Epicurrents EMG loader.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericStudyLoader } from '@epicurrents/core'
import type {
    ConfigStudyLoader,
    FileFormatReader,
    FileSystemItem,
    StudyContext,
} from '@epicurrents/core/dist/types'
import { EmgRecording } from '..'
import type { EmgResource } from '#types'
import { Log } from 'scoped-event-log'

const SCOPE = 'EmgLoader'

export default class EmgLoader extends GenericStudyLoader {
    constructor (name: string, reader: FileFormatReader) {
        super(name, ['emg'], reader)
    }

    get resourceModality () {
        return 'emg'
    }

    async getResource (idx: number | string = -1): Promise<EmgResource | null> {
        const loaded = await super.getResource(idx)
        if (loaded) {
            return loaded as EmgResource
        } else if (!this._study) {
            return null
        }
        // Create a new resource from the loaded study.
        if (!this._study.name) {
            Log.error(
                `Cannot construct an EMG resource from given study context; it is missing required properties.`,
            SCOPE)
            return null
        }
        const worker = this._fileReader?.getFileTypeWorker()
        if (!worker) {
            Log.error(`Study loader does not have a file worker.`, SCOPE)
            return null
        }
        if (!worker) {
            Log.error(`Study loader doesn't have a file type loader.`, SCOPE)
            return null
        }
        const emg = new EmgRecording(
            this._study.name,
            this._study,
            worker,
        )
        emg.state = 'loaded'
        emg.source = this._study
        this._resources.push(emg)
        // Clear the loaded study.
        this._study = null
        return emg
    }

    public async loadFromDirectory (dir: FileSystemItem, config?: ConfigStudyLoader): Promise<StudyContext|null> {
        const context = await super.loadFromDirectory(dir, config)
        if (!context) {
            return null
        }
        context.modality = 'emg'
        return context
    }

    public async loadFromUrl (
        fileUrl: string,
        config?: ConfigStudyLoader,
        preStudy?: StudyContext | undefined
    ): Promise<StudyContext | null> {
        const context = await super.loadFromUrl(fileUrl, config, preStudy)
        if (!context) {
            return null
        }
        context.modality = 'emg'
        return context
    }
}
