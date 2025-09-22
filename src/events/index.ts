/**
 * EMG module events.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { BroadcastStateEvent, EventWithPayload } from '@epicurrents/core/dist/types/event'

/**
 * EMG module events.
 */
export enum EmgEvents {
    /** Audio playback ended due to reaching the end of the recording. */
    AUDIO_PLAYBACK_ENDED = 'emg-audio-playback-ended',
    /** Audio playback paused. */
    AUDIO_PLAYBACK_PAUSED = 'emg-audio-playback-paused',
    /** Audio playback started. */
    AUDIO_PLAYBACK_STARTED = 'emg-audio-playback-started',
    /** Audio playback stopped. */
    AUDIO_PLAYBACK_STOPPED = 'emg-audio-playback-stopped',
}

export type EmgEvent = {
    /** EMG audio playback has ended due to reaching the end of the recording. */
    [EmgEvents.AUDIO_PLAYBACK_ENDED]: BroadcastStateEvent
    /** EMG audio playback is paused at the given position. */
    [EmgEvents.AUDIO_PLAYBACK_PAUSED]: EventWithPayload<{ position: number }>
    /** EMG audio playback is started from the given position. */
    [EmgEvents.AUDIO_PLAYBACK_STARTED]: EventWithPayload<{ position: number }>
    /** EMG audio playback is stopped. */
    [EmgEvents.AUDIO_PLAYBACK_STOPPED]: BroadcastStateEvent
}
