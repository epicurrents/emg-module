import type { BaseModuleSettings, BiosignalDataService, BiosignalResource, CommonBiosignalSettings, StudyContext } from "@epicurrents/core/dist/types"

export interface EmgDataService extends BiosignalDataService {

}

export type EmgModuleSettings = BaseModuleSettings & CommonBiosignalSettings & {

}

export interface EmgResource extends BiosignalResource {
    /** Is audio playback currently active. */
    isAudioPlaying: boolean
    /** EMG signal playback position in seconds. */
    playbackPosition: number
    /** EMG signal sampling rate in Hz. */
    samplingRate: number // EMG recordings have a constant sampling rate.

    /**
     * Play the EMG signal audio from the given position (in seconds).
     * If no position is given, playback continues from the current position.
     * @param position - Position in seconds to start playback from.
     * @returns Promise that resolves to true if playback started successfully, false otherwise.
     */
    playAudio (position?: number): Promise<boolean>
    /**
     * Pause the EMG signal audio playback.
     * @returns True if playback was paused successfully, false otherwise.
     */
    pauseAudio (): boolean
    /**
     * Rewind (stop) the EMG signal audio playback and reset the position to the start.
     * @returns True if playback was rewound successfully, false otherwise.
     */
    rewindAudio (): boolean
    /**
     * Set the audio gain for playback.
     * @param gain - Gain value (1.0 = no change, 0.5 = half volume, 2.0 = double volume, etc.)
     */
    setAudioGain (gain: number): void
    /**
     * Set the audio signals for playback.
     * @param length - Length of the signals in samples.
     * @param samplingRate - Sampling rate of the signals in Hz.
     * @param signals - One or more Float32Array containing the audio signals for each channel.
     */
    setAudioSignals (length: number, samplingRate: number, ...signals: Float32Array[]): void
}

/**
 * EMG study context with the meta properties that every EMG recording should have.
 */
export type EmgStudyContext = StudyContext & {
    meta: StudyContext['meta'] & {
        duration: number
        nChannels: number
        samplingRate: number
    }
}

export type SetupEmgWorkerResponse = {
    length: number
    samplingRate: number
}
