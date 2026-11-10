/**
 * EMG cascade montage. Stacks consecutive rows of one EMG channel, each row as long as one page of the EMG timebase.
 *
 * The core cascade locks the timebase to sec/page and keeps its row length as its own `pageLength`. An EMG page is set
 * in ms/div, and what one page spans in seconds depends on how many divisions the viewport is wide, which only the
 * display knows. This montage therefore leaves the timebase unit unset, so the recording's ms/div timebase stays in
 * force and keeps its own control, and the display assigns `pageLength` from the page it draws. Until it does, a row
 * keeps the length the montage was created with.
 * @package    epicurrents/emg-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalCascadeMontage } from '@epicurrents/core'
import type {
    BiosignalResource,
    BiosignalSetup,
    ConfigBiosignalMontage,
    MemoryManager,
    MontageChannel,
    SetupChannel,
} from '@epicurrents/core/types'
import EmgMontageChannel from './EmgMontageChannel'

export default class EmgCascadeMontage extends GenericBiosignalCascadeMontage {

    constructor (
        name: string,
        recording: BiosignalResource,
        setup: BiosignalSetup,
        sourceLabel: string,
        rowCount: number,
        pageLength: number,
        manager?: MemoryManager,
        config?: ConfigBiosignalMontage,
    ) {
        super(name, recording, setup, sourceLabel, rowCount, pageLength, manager, config)
        // With no unit of its own the recording's unit is the effective one, and the recording routes `timebase` to
        // this montage only under sec/page; under ms/div the timebase is the recording's and stays there.
        this.timebaseUnit = null
    }

    override get rowCount () {
        return this._rowCount
    }
    /**
     * Rows are rebuilt from the source channel on assignment, so the stack reshapes in place without a new montage.
     * A count below one is refused.
     */
    set rowCount (value: number) {
        if (!Number.isInteger(value) || value < 1 || value === this._rowCount) {
            return
        }
        this._rowCount = value
        this.mapChannels()
    }

    protected _createChannel (src: SetupChannel, rowIndex: number): MontageChannel {
        return new EmgMontageChannel(
            this,
            `${src.name}_row${rowIndex + 1}`,
            `${src.label} ${rowIndex + 1}`,
            src.modality,
            src.index,
            [],
            false,
            src.samplingRate ?? 0,
            src.unit,
            true,
        )
    }
}
