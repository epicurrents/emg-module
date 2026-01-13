/**
 * Epicurrents EMG label.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { ResourceLabel } from '@epicurrents/core'
import type { AnnotationLabelTemplate, AnnotationOptions } from '@epicurrents/core/dist/types'

const SCOPE = 'EmgLabel'

export default class EmgLabel extends ResourceLabel {

    public static fromTemplate (tpl: AnnotationLabelTemplate) {
        return new EmgLabel(tpl.value, {
            annotator: tpl.annotator || undefined,
            class: tpl.class || undefined,
            codes: tpl.codes || undefined,
            label: tpl.label || undefined,
            priority: tpl.priority || undefined,
            text: tpl.text || undefined,
            visible: tpl.visible || undefined,
        })
    }

    constructor (
        // Required properties:
        value: boolean | number | number[] | string | string[] | null,
        // Optional properties:
        options?: AnnotationOptions
    ) {
        super(SCOPE, value, options)
    }
}
