/**
 * Epicurrents EMG recording.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BiosignalAudio, BiosignalMutex, GenericBiosignalResource, GenericBiosignalSetup } from '@epicurrents/core'
import EmgService from '#service/EmgService'
import type { BiosignalSetup, ConfigStudyLoader, MemoryManager, SetupChannel } from '@epicurrents/core/types'
import type {
    EmgModuleSettings,
    EmgResource,
    EmgStudyContext,
} from '#types'
import EmgCascadeMontage from '#components/EmgCascadeMontage'
import EmgSourceChannel from '#components/EmgSourceChannel'
import { AssetEvents, BiosignalResourceEvents } from '@epicurrents/core/events'
import { EmgEvents } from '#events'
import { Log } from 'scoped-event-log'

const SCOPE = 'EmgRecording'

/**
 * The sensitivity, in volts per division, at which audio plays at unit gain. Gain is inversely proportional to the
 * sensitivity, so 50 µV/div plays at half of unit gain, where the amplifier's background noise stays in the background.
 */
const UNIT_GAIN_SENSITIVITY = 25e-6

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

    /**
     * Whether *study* carries what a recording is built from: a name, a channel count and a sampling rate. A study
     * missing them yields a recording with no channels and no duration, which shows as an empty viewer rather than as
     * a failed load.
     * @param study - The study context to check.
     */
    static readonly isCompleteStudy = (study: EmgStudyContext) => {
        const meta = study.meta as Partial<EmgStudyContext['meta']> | undefined
        return !!study.name && typeof meta?.nChannels === 'number' && typeof meta.samplingRate === 'number'
    }

    protected _audio: BiosignalAudio
    /** Gives the worker the service runs on, asked for only when the recording loads. */
    protected _getWorker: (() => Worker | null) | null
    protected _isAudioPlaying = false
    protected _samplingRate: number | null = null
    protected _service: EmgService | null = null
    /**
     * Identifies the current setup run. {@link _supersedeSetup} moves it on, so a run that started under an earlier
     * value has been superseded; {@link _isSetupSuperseded} is the check.
     */
    protected _setupGeneration = 0
    /**
     * The generation the newest setup run started under. Equal to {@link _setupGeneration} while a run that has not
     * been superseded holds what a setup commissions, which a superseded run then leaves alone.
     */
    protected _setupOwnerGeneration = -1
    /** The cache setup in progress, shared by every call to {@link _completeSetup} made while it runs. */
    protected _setupRun: Promise<void> | null = null
    #SETTINGS = (window.__EPICURRENTS__?.RUNTIME?.SETTINGS.modules.emg as EmgModuleSettings) || null
    /**
     * Create a new EMG recording. It starts no worker: the service is created and set up when the recording loads,
     * and the signal cache when it is first activated after that.
     * @param name - Recording name; this will be displayed in the UI.
     * @param source - Recording source as a study context; absent for a listed recording until its study is read.
     * @param getWorker - Gives the worker for the EMG service when the recording loads; without one it has no service.
     * @param memoryManager - Shared-memory manager; kept only while `emg.useMemoryManager` is on, the same setting that gives the study a reader worker that can only serve a shared cache.
     */
    constructor (
        name: string,
        source?: EmgStudyContext,
        getWorker?: () => Worker | null,
        memoryManager?: MemoryManager
    ) {
        super(name, 'emg', source)
        this._getWorker = getWorker ?? null
        // A reader in its own thread cannot hand over a main-thread cache, so a study given such a worker reaches its
        // signals through shared memory or not at all.
        if (memoryManager && this.#SETTINGS?.useMemoryManager) {
            this.setMemoryManager(memoryManager)
        }
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
        this.addEventListener(AssetEvents.ACTIVATE, () => {
            // Activation loads a recording that has a study to load from and has not loaded yet, and the cache is
            // commissioned only once that load has succeeded. The listener slot is synchronous, so the setup's failure
            // has to be caught here or it surfaces as an unhandled rejection with the recording left half set up and
            // nothing said about it.
            // The event fires for both phases, and the setup belongs to the one in which the recording is active.
            if (!this._isActive) {
                return
            }
            // A load already reading the study of a listed recording is joined: its state is `loading`, which is
            // neither listed nor, until the read lands, holding a source.
            if (!this._source && !this.isListed && this._state !== 'loading') {
                return
            }
            const completeSetup = () => this._completeSetup().catch((e: unknown) => {
                Log.error(`Completing setup of the EMG recording failed.`, SCOPE, asError(e))
                // The same exit the setup's own refusals take: an errored recording that stays
                // active keeps a display asking a cache that was never commissioned.
                this._failSetup('Completing setup failed')
            })
            // A loaded recording commissions its cache within this dispatch. The plot asks for signals as soon as it
            // sees the recording active, and a setup deferred past the dispatch reaches the worker after that request.
            if (this._state === 'ready') {
                completeSetup()
                return
            }
            // A recording that has not loaded is loaded first, and its cache is commissioned only once that load has
            // succeeded, on a recording still active by then.
            this.load().then(async loaded => {
                if (loaded && this._isActive) {
                    await completeSetup()
                }
            }).catch((e: unknown) => {
                Log.error(`Loading the EMG recording on activation failed.`, SCOPE, asError(e))
            })
        }, this.id)
        if (source && EmgRecording.isCompleteStudy(source)) {
            this._readSource(source)
        }
    }

    get _sensitivityGain () {
        return this.sensitivity ? UNIT_GAIN_SENSITIVITY/this.sensitivity : 1
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
     * Commission the signal cache and fill it, once, on the recording's first activation. Calls made while a setup
     * runs share it: the service reports ready only once the setup's first steps have landed, so a second run started
     * before then would request the memory and commission the cache again.
     */
    protected _completeSetup (): Promise<void> {
        if (this._setupRun) {
            return this._setupRun
        }
        // Held before the run starts: its first step dispatches an event synchronously, and a listener that asks for
        // the setup from that dispatch has to find this run rather than start a second one.
        let settle = () => {}
        let fail = (_reason: unknown) => {}
        const run = new Promise<void>((resolve, reject) => {
            settle = resolve
            fail = reject
        })
        this._setupRun = run
        // Cleared whatever the outcome, so a recording unloaded and activated again is set up again.
        const clear = () => {
            if (this._setupRun === run) {
                this._setupRun = null
            }
        }
        run.then(clear, clear)
        this._runSetup().then(settle, fail)
        return run
    }

    /**
     * Leave the recording in `error` after a setup step failed. The reason goes first, so whatever reacts to the state
     * finds it in place. The runtime deactivates a dataset member that enters `error`; the recording deactivates
     * itself as well when it is still active after that, as one outside a dataset is.
     * @param reason - What failed, as shown to the user.
     */
    protected _failSetup (reason: string) {
        this.errorReason = reason
        this.state = 'error'
        if (this._isActive) {
            this.isActive = false
        }
    }

    /**
     * Has the setup run that started under `generation` been superseded: the recording was unloaded or destroyed
     * while the run was awaiting something. {@link _runSetup} checks after every await and stops without
     * commissioning or dispatching anything more.
     * @param generation - The value of `_setupGeneration` read when the run started.
     */
    protected _isSetupSuperseded (generation: number) {
        return generation !== this._setupGeneration || (this._state as string) === 'destroyed'
    }

    /**
     * Give back what a superseded setup run commissioned after the unload that superseded it had already released the
     * buffers: the memory request, the mutex or the cache. A newer run that has taken the recording up owns what is
     * commissioned now, and a destroyed recording has let go of its service, so both are left alone.
     */
    protected async _releaseSupersededSetup () {
        if ((this._state as string) === 'destroyed' || this._setupOwnerGeneration === this._setupGeneration) {
            return
        }
        try {
            await this.releaseBuffers()
        } catch (e: unknown) {
            Log.warn(`Releasing the buffers of a superseded setup failed: ${asError(e).message}`, SCOPE)
        }
    }

    /**
     * Run one cache setup; see {@link _completeSetup}.
     *
     * Runs only while the service has not yet reported ready, so a second activation is a no-op. The
     * three failure exits each set a state and deactivate the recording rather than throwing, so a
     * caller that cannot see this promise still learns the outcome from the resource. A run superseded by an unload
     * or a destroy stops at its next check.
     */
    protected async _runSetup () {
        if (!this._service || this._service.isReady || this._state !== 'ready') {
            return
        }
        // Read before the first await; every await below is followed by a check against it.
        const generation = this._setupGeneration
        this._setupOwnerGeneration = generation
        this.dispatchEvent(EmgRecording.EVENTS.INITIAL_SETUP, 'before')
        if (this._memoryManager) {
            // Floats the mutex needs for the whole recording: one cell for the master lock, five for
            // the mutex meta fields (allocated, start, end, data unit duration, window epoch), then
            // per channel its samples plus that channel's own meta header. The samples cover the whole data units
            // the mutex lays out, not just the recording's own length.
            let totalMem = 6
            const dataFieldsLen = BiosignalMutex.SIGNAL_DATA_POS
            const coveredLength = BiosignalMutex.coveredLength(this._dataDuration)
            for (const chan of this.channels) {
                totalMem += Math.ceil(chan.samplingRate*coveredLength) + dataFieldsLen
            }
            const memorySuccess = await this._service?.requestMemory(totalMem)
            // Checked before the outcome is read: an unload that interrupted the request owns the state, and a
            // request it made fail is no failure of the recording.
            if (this._isSetupSuperseded(generation)) {
                return this._releaseSupersededSetup()
            }
            if (!memorySuccess) {
                Log.error(`Memory allocation failed.`, SCOPE)
                this._failSetup('Memory allocation failed')
                return
            }
            Log.debug(`Memory allocation complete.`, SCOPE)
            const mutex = await this.setupMutex()
            if (this._isSetupSuperseded(generation)) {
                return this._releaseSupersededSetup()
            }
            if (!mutex) {
                Log.error(`Mutex setup failed.`, SCOPE)
                this._failSetup('Mutex setup failed')
                return
            }
            Log.debug(`Buffer setup complete.`, SCOPE)
        } else {
            const dataCache = await this.setupCache()
            if (this._isSetupSuperseded(generation)) {
                return this._releaseSupersededSetup()
            }
            if (!dataCache) {
                Log.error(`Data cache setup failed.`, SCOPE)
                this._failSetup('Data cache setup failed')
                return
            }
            Log.debug(`Data cache setup complete.`, SCOPE)
        }
        Log.debug(`EMG recording initial setup complete.`, SCOPE)
        this.dispatchEvent(EmgRecording.EVENTS.INITIAL_SETUP, 'after')
        await this.cacheSignals()
        if (this._isSetupSuperseded(generation)) {
            return this._releaseSupersededSetup()
        }
        this.dispatchEvent(BiosignalResourceEvents.SIGNAL_CACHING_COMPLETE)
        // Set the signals to use for audio playback.
        const signals = await this._service?.getSignals([0, this._dataDuration])
        // A run overtaken while the signals were read does not set them as the audio of an unloaded recording.
        if (this._isSetupSuperseded(generation)) {
            return this._releaseSupersededSetup()
        }
        if (signals) {
            this.setAudioSignals(
                this._dataDuration,
                this._samplingRate || 0,
                ...signals.signals.map(s => s.data)
            )
        }
    }

    /**
     * Create the service and set its worker up on the study in `_source`, which is what the recording loads with. A
     * listed recording also builds its channels here, from the study its listing read.
     */
    protected async _load (_options?: ConfigStudyLoader) {
        const source = this._source as EmgStudyContext | null
        if (!source || !EmgRecording.isCompleteStudy(source)) {
            Log.error(`Cannot load the EMG recording ${this.name}; its study is missing required properties.`, SCOPE)
            this._errorReason = 'Recording study is incomplete'
            return false
        }
        if (!this._channels.length) {
            this._readSource(source)
        }
        // Read before the await; the check after it is against this.
        const generation = this._loadGeneration
        let created: EmgService | null = null
        if (!this._service) {
            const worker = this._getWorker?.() ?? null
            if (!worker) {
                Log.error(`Cannot load the EMG recording ${this.name}; there is no file worker for it.`, SCOPE)
                this._errorReason = 'No file worker'
                return false
            }
            created = new EmgService(this, worker, this._memoryManager || undefined)
            this._service = created
        }
        let prepared = false
        try {
            prepared = !!await this._service.prepareWorker(source)
        } catch (e: unknown) {
            Log.error(`Preparing the EMG worker failed.`, SCOPE, asError(e))
        }
        // A recording unloaded or destroyed while its worker was being prepared has nothing left to set up, and its
        // state belongs to whatever superseded the load.
        if (this._isLoadSuperseded(generation)) {
            this._releaseSupersededService(created)
            return false
        }
        if (!this._service) {
            return false
        }
        if (prepared) {
            return true
        }
        this._errorReason = 'Preparing worker failed'
        // A recording that failed to load is not loaded again, so a service created for this load would keep its
        // worker running for nothing. The shutdown is not awaited: it waits on an answer from a worker that has just
        // failed to give one, and the load's outcome does not depend on it.
        if (created && this._service === created) {
            this._service = null
            created.destroy().catch((e: unknown) => {
                Log.warn(`Shutting down the EMG worker after a failed load failed: ${asError(e).message}`, SCOPE)
            })
        }
        return false
    }

    /**
     * Build the channels and the durations from *source*'s metadata.
     */
    protected _readSource (source: EmgStudyContext) {
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
    }

    /**
     * Shut down the service a superseded load created, so its worker does not outlive a load that set nothing up. A
     * service the recording no longer holds has been released by whatever superseded the load, and one a later load
     * has taken up is that load's to keep.
     * @param created - The service the superseded load created; null when it used one the recording already had.
     */
    protected _releaseSupersededService (created: EmgService | null) {
        if (!created || this._service !== created || this._loadRun || this._state === 'ready') {
            return
        }
        this._service = null
        created.destroy().catch((e: unknown) => {
            Log.warn(`Shutting down the EMG worker of a superseded load failed: ${asError(e).message}`, SCOPE)
        })
    }

    /**
     * Supersede the setup in progress, if there is one: its run stops at its next check, and the next call to
     * {@link _completeSetup} starts a run of its own. `unload` and `destroy` call this before anything they await,
     * beside core's `_supersedeLoad`.
     */
    protected _supersedeSetup () {
        this._setupGeneration++
        this._setupRun = null
    }

    protected override _constructCascadeMontage (
        name: string,
        setup: BiosignalSetup,
        sourceLabel: string,
        rowCount: number,
        pageLength: number,
        config?: { label: string },
    ) {
        return new EmgCascadeMontage(
            name, this, setup, sourceLabel, rowCount, pageLength,
            this._memoryManager || undefined, config,
        )
    }

    /**
     * The setup the recording's montages resolve their channels against: one setup channel per source channel, in
     * source order, so a setup channel's index is the source signal's index in the cache. Built on first use and kept,
     * since the source channels do not change after the recording is constructed.
     */
    protected _sourceSetup (): BiosignalSetup {
        if (this._setup) {
            return this._setup
        }
        const setup = new GenericBiosignalSetup('emg')
        setup.channels = this._channels.map((ch, idx): SetupChannel => ({
            active: idx,
            averaged: false,
            displayPolarity: 0,
            index: idx,
            label: ch.label,
            laterality: ch.laterality,
            modality: ch.modality,
            name: ch.name,
            reference: [],
            samplingRate: ch.samplingRate,
            scale: 0,
            unit: ch.unit,
        }))
        this.setup = setup
        return setup
    }

    async addCascadeMontages (rowCount: number, pageLength: number): Promise<string[]> {
        if (!this._channels.length) {
            return []
        }
        const setup = this._sourceSetup()
        const added: string[] = []
        for (const chan of setup.channels) {
            const name = `cascade:${chan.name}`
            if (this.montages.some(m => m.name === name)) {
                added.push(name)
                continue
            }
            const created = await this.addCascadeMontage(name, chan.label, setup, chan.name, rowCount, pageLength)
            if (created) {
                added.push(name)
            }
        }
        return added
    }

    destroy (): Promise<void> {
        this._audio.destroy()
        this._getWorker = null
        // A cache setup still running stops at its next check, and is not one a later call may join.
        this._supersedeSetup()
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

    /**
     * Load the recording; see {@link load}.
     */
    prepare (options?: ConfigStudyLoader) {
        return this.load(options)
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
        // The sensitivity may have been set before there was anything to play, so playback starts at its gain.
        this._audio.setGain(this._sensitivityGain)
    }

    unload () {
        // A cache setup still running was commissioning what the unload releases: it stops at its next check, and the
        // next activation starts its own rather than joining it.
        this._supersedeSetup()
        return super.unload()
    }
}
