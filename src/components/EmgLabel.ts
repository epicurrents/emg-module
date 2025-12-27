/**
 * Epicurrents EMG label.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { ResourceLabel } from '@epicurrents/core'
import type {
    AnnotationLabelTemplate,
    AnnotationLabel,
} from '@epicurrents/core/dist/types'

//const SCOPE = 'EmgLabel'

export default class EmgLabel extends ResourceLabel {

    public static fromTemplate (tpl: AnnotationLabelTemplate) {
        return new EmgLabel(
            tpl.value,
            tpl.label, tpl.class, tpl.codes, tpl.priority, tpl.text, tpl.visible
        )
    }

    constructor (
        // Required properties:
        value: boolean | number | number[] | string | string[],
        // Optional properties:
        label?: string, labelClass?: AnnotationLabel['class'], codes?: (number | string)[], priority?: number, text?: string,
        visible?: boolean
    ) {
        super(
            'EmgLabel', value,
            label, labelClass, codes, priority, text, visible
        )
    }
}
