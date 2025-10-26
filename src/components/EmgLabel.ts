/**
 * Epicurrents EMG label.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalLabel } from '@epicurrents/core'
import type {
    AnnotationLabelTemplate,
    BiosignalAnnotationLabel,
} from '@epicurrents/core/dist/types'

//const SCOPE = 'EmgLabel'

export default class EmgLabel extends GenericBiosignalLabel {

    public static fromTemplate (tpl: AnnotationLabelTemplate) {
        return new EmgLabel(
            tpl.label,
            tpl.class, tpl.codes, tpl.priority, tpl.text, tpl.visible
        )
    }

    constructor (
        // Required properties:
        label: string,
        // Optional properties:
        labelClass?: BiosignalAnnotationLabel['class'], codes?: (number | string)[], priority?: number, text?: string,
        visible?: boolean
    ) {
        super(
            'EmgLabel', label,
            labelClass, codes, priority, text, visible
        )
    }
}
