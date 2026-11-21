/**
 * Epicurrents EMG loader.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericStudyLoader } from '@epicurrents/core'
import type {
    ConfigStudyLoader,
    FileFormatImporter,
    FileSystemItem,
    StudyContext,
    StudyListing,
} from '@epicurrents/core/types'
import { EmgRecording } from '..'
import type { EmgResource, EmgStudyContext } from '#types'
import { Log } from 'scoped-event-log'

const SCOPE = 'EmgStudyLoader'

export default class EmgStudyLoader extends GenericStudyLoader {

    protected _study: EmgStudyContext | null = null

    constructor (name: string, importer: FileFormatImporter) {
        super(name, ['emg'], importer)
    }

    get resourceModality () {
        return 'emg'
    }

    /**
     * The importer's EMG worker. A recording asks for it when it loads, not when it is created.
     */
    protected _getFileWorker () {
        return this._studyImporter?.getFileTypeWorker('emg') ?? null
    }

    createListedResource (listing: StudyListing) {
        const emg = new EmgRecording(
            listing.name,
            undefined,
            () => this._getFileWorker(),
            this._memoryManager || undefined,
        )
        // Kept out of `_resources`: that list is what a read study's resource is found in by index, and a listing
        // entered between a read and its `getResource` would take the read study's place.
        return emg
    }

    async getResource (idx: number | string = -1): Promise<EmgResource | null> {
        const loaded = await super.getResource(idx)
        if (loaded) {
            return loaded as EmgResource
        } else if (!this._study) {
            return null
        }
        // Create a new resource from the loaded study. The recording reads the channel count, duration and sampling
        // rate straight off `meta`, so a study missing them is refused here rather than presenting as an empty viewer.
        if (!EmgRecording.isCompleteStudy(this._study)) {
            Log.error(
                `Cannot construct an EMG resource from given study context; ` +
                `it is missing required properties (name / nChannels / samplingRate).`,
                SCOPE,
            )
            return null
        }
        // Built unloaded, as a listed recording is: the loader that opened the study loads it straight after.
        const emg = new EmgRecording(
            this._study.name,
            this._study,
            () => this._getFileWorker(),
            this._memoryManager || undefined,
        )
        emg.state = 'loaded'
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
        preStudy?: StudyContext
    ): Promise<StudyContext | null> {
        const context = await super.loadFromUrl(fileUrl, config, preStudy)
        if (!context) {
            return null
        }
        context.modality = 'emg'
        return context
    }
}
