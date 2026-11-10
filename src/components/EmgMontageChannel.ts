/**
 * Epicurrents EMG montage channel. Keeps the modality at `'emg'` on every montage row, so display code that switches on
 * modality treats a cascade row as the EMG signal it is cut from.
 * @package    epicurrents/emg-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericMontageChannel } from '@epicurrents/core'
import type {
    BiosignalChannel,
    BiosignalMontage,
    DerivedChannelProperties,
    MontageChannel,
} from '@epicurrents/core/types'

export default class EmgMontageChannel extends GenericMontageChannel implements MontageChannel {

    constructor (
        montage: BiosignalMontage,
        name: string,
        label: string,
        modality: string,
        active: number | DerivedChannelProperties,
        reference: DerivedChannelProperties,
        averaged: boolean,
        samplingRate: number,
        unit: string,
        visible: boolean,
        extraProperties: Partial<BiosignalChannel> = {},
    ) {
        super(montage, name, label, modality, active, reference, averaged, samplingRate, unit, visible, extraProperties)
    }
}
