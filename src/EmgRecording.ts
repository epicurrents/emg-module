/**
 * Epicurrents EMG recording.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BiosignalAudio, BiosignalMutex, GenericBiosignalResource } from '@epicurrents/core'
import EmgService from '#service/EmgService'
import type {
    EmgModuleSettings,
    EmgResource,
    EmgStudyContext,
} from '#types'
import { secondsToTimeString, timePartsToShortString } from '@epicurrents/core/dist/util'
import EmgSourceChannel from '#components/EmgSourceChannel'
import { AssetEvents, BiosignalResourceEvents } from '@epicurrents/core/dist/events'
import { EmgEvents } from '#events'
import { Log } from 'scoped-event-log'
//import { Log } from 'scoped-event-log'

const SCOPE = "EmgRecording"
/**
 * Electromyography recording.
 */
export default class EmgRecording extends GenericBiosignalResource implements EmgResource {
    /** EMG recording events (not including property change events). */
    static readonly EVENTS = { ...GenericBiosignalResource.EVENTS, ...EmgEvents }
    protected _audio: BiosignalAudio
    protected _isAudioPlaying = false
    protected _samplingRate: number
    protected _service: EmgService
    protected _worker?: Worker
    #SETTINGS = (window.__EPICURRENTS__?.RUNTIME?.SETTINGS.modules.eeg as EmgModuleSettings) || null
    /**
     * Create a new EMG recording.
     * @param name - Recording name; this will be displayed in the UI.
     * @param source - Recording source as a study context.
     * @param worker - Worker for the EMG service.
     */
    constructor (name: string, source: EmgStudyContext, worker: Worker) {
        super(name, 'emg', source)
        this._audio = new BiosignalAudio(name)
        for (let i=0; i<source.meta.nChannels; i++) {
            this._channels.push(new EmgSourceChannel(
                `ch_${i}`,
                `EMG ${i+1}`,
                i,
                source.meta.samplingRate || 0,
                true,
            ))
        }
        this._dataDuration = source.meta.duration || 0
        this._totalDuration = this._dataDuration // EMG recordings are continuous.
        this._samplingRate = source.meta.samplingRate || 0
        this._service = new EmgService(this, worker)
        this._state = 'loading'
        this._service.prepareWorker(source).then((response) => {
            if (response) {
                this._state = 'ready'
            } else {
                this._errorReason = 'Preparing worker failed'
                this._state = 'error'
            }
        })
        // Listen to is-active changes.
        this.addEventListener(AssetEvents.ACTIVATE, async () => {
            // Complete loader setup if not already done.
            if (!this._service?.isReady && this._state === 'ready') {
                this.dispatchEvent(EmgRecording.EVENTS.INITIAL_SETUP, 'before')
                if (this._memoryManager) {
                    // Calculate needed memory to load the entire recording.
                    let totalMem = 4 // For lock field.
                    const dataFieldsLen = BiosignalMutex.SIGNAL_DATA_POS
                    for (const chan of this.channels) {
                        totalMem += chan.samplingRate*this._totalDuration + dataFieldsLen
                    }
                    const memorySuccess = await this._service?.requestMemory(totalMem)
                    if (!memorySuccess) {
                        Log.error(`Memory allocation failed.`, SCOPE)
                        this.state = 'error'
                        this.errorReason = 'Memory allocation failed'
                        this.isActive = false
                        return
                    }
                    Log.debug(`Memory allocation complete.`, SCOPE)
                    const mutex = await this.setupMutex()
                    if (!mutex) {
                        Log.error(`Mutex setup failed.`, SCOPE)
                        this.state = 'error'
                        this.errorReason = 'Mutex setup failed'
                        this.isActive = false
                        return
                    }
                    Log.debug(`Buffer setup complete.`, SCOPE)
                } else {
                    const dataCache = await this.setupCache()
                    if (!dataCache) {
                        Log.error(`Data cache setup failed.`, SCOPE)
                        this.state = 'error'
                        this.errorReason = 'Data cache setup failed'
                        this.isActive = false
                        return
                    }
                    Log.debug(`Data cache setup complete.`, SCOPE)
                }
                Log.debug(`EMG recording initial setup complete.`, SCOPE)
                // Initial setup complete.
                this.dispatchEvent(EmgRecording.EVENTS.INITIAL_SETUP, 'after')
                await this.cacheSignals()
                this.dispatchEvent(BiosignalResourceEvents.SIGNAL_CACHING_COMPLETE)
                // Set the signals to use for audio playback.
                const signals = await this._service.getSignals([0, this._dataDuration])
                if (signals) {
                    this.setAudioSignals(
                        this._dataDuration,
                        this._samplingRate,
                        ...signals.signals.map(s => s.data)
                    )
                }
            }
        }, this.id)
        this.addEventListener(AssetEvents.DEACTIVATE, async () => {
            if (this.#SETTINGS?.unloadOnClose && this._service?.isReady) {
                await this.unload()
            }
        }, this.id)
        // Add audio event listeners.
        this._audio.addPlayEndedCallback(() => {
            this.isAudioPlaying = false
            this.dispatchEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_ENDED)
            this.dispatchEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_STOPPED)
        })
    }

    get isAudioPlaying () {
        return this._isAudioPlaying
    }
    set isAudioPlaying (playing: boolean) {
        this._setPropertyValue('isAudioPlaying', playing)
    }

    get playbackPosition () {
        return this._audio.currentTime
    }

    get samplingRate () {
        return this._samplingRate
    }

    destroy(): Promise<void> {
        this._audio.destroy()
        return super.destroy()
    }

    getMainProperties () {
        const props = super.getMainProperties()
        if (this.state === 'added') {
            props.set('Waiting to load...', null)
        } else if (this.state === 'error') {
            props.set(this._errorReason, null)
        } else if (this.state === 'loading') {
            props.set('Loading metadata...', null)
        } else if (this.state === 'loaded') {
            props.set('Initializing...', null)
        } else if (this.state === 'ready') {
            // Dependencies may still be loading.
            if (this._dependenciesMissing.length > 0) {
                const totalDeps = this._dependenciesMissing.length + this._dependenciesReady.length
                props.set(
                    'Loading dependency {n}/{t}...',
                    {
                        n: totalDeps - this._dependenciesMissing.length + 1,
                        t: totalDeps,
                    }
                )
            } else {
                props.set(
                    this._channels.length.toString(),
                    {
                        icon: 'wave',
                        n: this._channels.length,
                        title: this._channels.length === 1 ? '1 signal' : '{n} signals'
                    }
                )
                const timeParts = secondsToTimeString(this._totalDuration, true) as number[]
                const timeShort = timePartsToShortString(timeParts)
                props.set(
                    timeShort,
                    {
                        icon: 'time',
                        t: Math.floor(this._totalDuration) + ' seconds',
                        title: 'Duration: {t}',
                    }
                )
            }
        }
        return props
    }

    pauseAudio () {
        if (this._audio) {
            try {
                this.dispatchPayloadEvent(
                    EmgRecording.EVENTS.AUDIO_PLAYBACK_PAUSED,
                    { position: this._audio.currentTime },
                    'before'
                )
                this._audio.pause()
                this.isAudioPlaying = false
                this.dispatchPayloadEvent(
                    EmgRecording.EVENTS.AUDIO_PLAYBACK_PAUSED,
                    { position: this._audio.currentTime }
                )
                return true
            } catch (err) {
                Log.error(`Pausing audio failed: ${(err as Error).message}`, SCOPE)
            }
        }
        return false
    }

    async playAudio (position?: number) {
        if (this._audio) {
            try {
                this.dispatchPayloadEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_STARTED, { position }, 'before')
                await this._audio.play(position)
                this.isAudioPlaying = true
                this.dispatchPayloadEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_STARTED, { position })
                return true
            } catch (err) {
                Log.error(`Playing audio failed: ${(err as Error).message}`, SCOPE)
            }
        }
        return false
    }

    rewindAudio () {
        if (this._audio) {
            try {
                this.dispatchEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_STOPPED, 'before')
                this._audio.stop()
                this.isAudioPlaying = false
                this.dispatchEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_STOPPED)
                return true
            } catch (err) {
                Log.error(`Rewinding audio failed: ${(err as Error).message}`, SCOPE)
            }
        }
        return false
    }

    setAudioGain (gain: number) {
        if (this._audio) {
            this._audio.setGain(gain)
        }
    }

    setAudioSignals (length: number, samplingRate: number, ...signals: Float32Array[]) {
        if (this._audio) {
            this._audio.setSignals(length, samplingRate, ...signals)
        }
    }
}
