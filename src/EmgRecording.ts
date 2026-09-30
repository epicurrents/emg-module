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
import EmgSourceChannel from '#components/EmgSourceChannel'
import { AssetEvents, BiosignalResourceEvents } from '@epicurrents/core/events'
import { EmgEvents } from '#events'
import { Log } from 'scoped-event-log'

const SCOPE = 'EmgRecording'

const asError = (reason: unknown) => {
    return reason instanceof Error ? reason : new Error(String(reason))
}

/**
 * Electromyography recording.
 */
export default class EmgRecording extends GenericBiosignalResource implements EmgResource {
    /** EMG recording events (not including property change events). */
    static readonly EVENTS = { ...GenericBiosignalResource.EVENTS, ...EmgEvents }

    static readonly fromSerialized = (template: Partial<EmgResource>) => {
        const resource = new EmgRecording(template.name || 'EMG Recording')
        if (template.id) {
            // Override the generated id with the template id.
            resource._id = template.id
        }
        resource.dataDuration = template.dataDuration || 0
        if (resource.dataDuration > 0) {
            // The setter refuses a zero and logs an error doing so, and a template that names no
            // duration is a degenerate recording rather than a malformed one.
            resource.totalDuration = resource.dataDuration
        }
        resource.samplingRate = template.samplingRate || 0
        // The template comes from outside, so a null entry among the channels is possible and is
        // dropped along with the signal-less ones. Fallback names and labels are positional over the
        // channels that survive, so every channel gets a distinct one whether or not its neighbours
        // carry names of their own.
        const signalChannels = template.channels?.filter(c => c?.signal) ?? []
        resource._channels = signalChannels.map((ch, chIdx) => {
            const channel = new EmgSourceChannel(
                ch.name || `channel_${chIdx}`,
                ch.label || `Ch ${chIdx + 1}`,
                ch.index ?? chIdx,
                ch.samplingRate || 0,
                ch.visible ?? true,
                ch
            )
            channel.setSignal(ch.signal as Float32Array)
            return channel
        })
        if (signalChannels.length) {
            // The signals arrive with the template rather than from a worker, so the cache already
            // holds the whole recording.
            if (!resource.signalCacheStatus[1]) {
                resource.signalCacheStatus[1] = resource.dataDuration
            }
            // Every channel in one call: `setSignals` replaces the buffer rather than appending to
            // it, so a call per channel leaves only the last channel audible.
            try {
                resource.setAudioSignals(
                    resource.dataDuration,
                    resource.samplingRate || 0,
                    ...signalChannels.map(ch => ch.signal as Float32Array)
                )
            } catch (e: unknown) {
                Log.error(`Setting the audio signals of a deserialized EMG recording failed.`, SCOPE, asError(e))
            }
        }
        resource.state = 'ready'
        return resource
    }

    protected _audio: BiosignalAudio
    protected _isAudioPlaying = false
    protected _samplingRate: number | null = null
    protected _service: EmgService | null = null
    #SETTINGS = (window.__EPICURRENTS__?.RUNTIME?.SETTINGS.modules.emg as EmgModuleSettings) || null
    /**
     * Create a new EMG recording.
     * @param name - Recording name; this will be displayed in the UI.
     * @param source - Recording source as a study context.
     * @param worker - Worker for the EMG service.
     */
    constructor (name: string, source?: EmgStudyContext, worker?: Worker) {
        super(name, 'emg', source)
        this._audio = new BiosignalAudio(name)
        // Unload on close if setting is enabled.
        this.addEventListener(AssetEvents.DEACTIVATE, () => {
            if (!this.#SETTINGS?.unloadOnClose || !this._service?.isReady) {
                return
            }
            // The listener slot is synchronous, so the unload's failure has to be caught here or it
            // surfaces as an unhandled rejection with the recording still holding its memory.
            this.unload().catch((e: unknown) => {
                Log.error(`Unloading the EMG recording on close failed.`, SCOPE, asError(e))
            })
        }, this.id)
        this.onPropertyChange('sensitivity', () => {
            // Update audio gain when sensitivity changes.
            this.setAudioGain(this._sensitivityGain)
        }, this.id)
        // Add audio event listeners.
        this._audio.addPlayEndedCallback(() => {
            this.isAudioPlaying = false
            this.dispatchEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_ENDED)
            this.dispatchEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_STOPPED)
        })
        if (!source) {
            return
        }
        for (let i = 0; i < source.meta.nChannels; i++) {
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
        if (!worker) {
            return
        }
        this._service = new EmgService(this, worker)
        this._state = 'loading'
        this._service.prepareWorker(source).then(response => {
            if (response) {
                this._state = 'ready'
            } else {
                this._errorReason = 'Preparing worker failed'
                this._state = 'error'
            }
        }).catch((e: unknown) => {
            // The rejection has no other handler, and an unreported one leaves the recording
            // in `loading` for the rest of the session.
            Log.error(`Preparing the EMG worker failed.`, SCOPE, asError(e))
            this._errorReason = 'Preparing worker failed'
            this._state = 'error'
        })
        this.addEventListener(AssetEvents.ACTIVATE, () => {
            // The listener slot is synchronous, so the setup's failure has to be caught here or it
            // surfaces as an unhandled rejection with the recording left half set up and nothing
            // said about it.
            this._completeSetup().catch((e: unknown) => {
                Log.error(`Completing setup of the EMG recording failed.`, SCOPE, asError(e))
                this.state = 'error'
                this.errorReason = 'Completing setup failed'
                // The same exit the setup's own refusals take: an errored recording that stays
                // active keeps a display asking a cache that was never commissioned.
                this.isActive = false
            })
        }, this.id)
    }

    get _sensitivityGain () {
        return 1e-6/(this.sensitivity || 1)
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

    /**
     * Commission the signal cache and fill it, once, on the recording's first activation.
     *
     * Runs only while the service has not yet reported ready, so a second activation is a no-op. The
     * three failure exits each set a state and deactivate the recording rather than throwing, so a
     * caller that cannot see this promise still learns the outcome from the resource.
     */
    protected async _completeSetup () {
        if (this._service?.isReady || this._state !== 'ready') {
            return
        }
        this.dispatchEvent(EmgRecording.EVENTS.INITIAL_SETUP, 'before')
        if (this._memoryManager) {
            // Floats the mutex needs for the whole recording: one cell for the master lock, five for
            // the mutex meta fields (allocated, start, end, data unit duration, window epoch), then
            // per channel its samples plus that channel's own meta header.
            let totalMem = 6
            const dataFieldsLen = BiosignalMutex.SIGNAL_DATA_POS
            for (const chan of this.channels) {
                totalMem += chan.samplingRate*this._dataDuration + dataFieldsLen
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
        this.dispatchEvent(EmgRecording.EVENTS.INITIAL_SETUP, 'after')
        await this.cacheSignals()
        this.dispatchEvent(BiosignalResourceEvents.SIGNAL_CACHING_COMPLETE)
        // Set the signals to use for audio playback.
        const signals = await this._service?.getSignals([0, this._dataDuration])
        if (signals) {
            this.setAudioSignals(
                this._dataDuration,
                this._samplingRate || 0,
                ...signals.signals.map(s => s.data)
            )
        }
    }

    destroy (): Promise<void> {
        this._audio.destroy()
        return super.destroy()
    }

    getMainProperties () {
        const props = super.getMainProperties()
        if (props.size) {
            return props
        } else if (this.state === 'ready') {
            props.set('duration', this._totalDuration)
            props.set('signals', this._channels.length)
        }
        return props
    }

    pauseAudio () {
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
        return false
    }

    async playAudio (position?: number) {
        try {
            this.dispatchPayloadEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_STARTED, { position }, 'before')
            await this._audio.play(position)
            this.isAudioPlaying = true
            this.dispatchPayloadEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_STARTED, { position })
            return true
        } catch (err) {
            Log.error(`Playing audio failed: ${(err as Error).message}`, SCOPE)
        }
        return false
    }

    rewindAudio () {
        try {
            this.dispatchEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_STOPPED, 'before')
            this._audio.stop()
            this.isAudioPlaying = false
            this.dispatchEvent(EmgRecording.EVENTS.AUDIO_PLAYBACK_STOPPED)
            return true
        } catch (err) {
            Log.error(`Rewinding audio failed: ${(err as Error).message}`, SCOPE)
        }
        return false
    }

    setAudioGain (gain: number) {
        this._audio.setGain(gain)
    }

    setAudioSignals (length: number, samplingRate: number, ...signals: Float32Array[]) {
        // We do not expect to see amplitudes over 50 mV in EMG signals.
        this._audio.sampleMaxAbsValue = 5*1e-2
        this._audio.setSignals(length, samplingRate, ...signals)
    }
}
