/**
 * Epicurrents EMG source channel.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericSourceChannel } from '@epicurrents/core'
import type { BiosignalChannel } from '@epicurrents/core/dist/types'

//const SCOPE = 'EmgSourceChannel'

export default class EmgSourceChannel extends GenericSourceChannel implements GenericSourceChannel {

    constructor (
        name: string, label: string, index: number, samplingRate: number, visible: boolean,
        extraProperties: Partial<BiosignalChannel> = {}
    ) {
        super(name, label, 'emg', index, false, samplingRate, 'uV', visible, extraProperties)
    }
}
