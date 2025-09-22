/**
 * Epicurrents EMG annotation.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalAnnotation } from '@epicurrents/core'
import type {
    AnnotationTemplate,
    BiosignalAnnotation,
    SettingsColor,
} from '@epicurrents/core/dist/types'

//const SCOPE = 'EmgAnnotation'

export default class EmgAnnotation extends GenericBiosignalAnnotation {

    public static fromTemplate (tpl: AnnotationTemplate) {
        return new EmgAnnotation(
            tpl.start, tpl.duration, tpl.label,
            tpl.class, tpl.channels, tpl.priority, tpl.text, tpl.visible, tpl.background, tpl.color, tpl.opacity
        )
    }

    constructor (
        // Required properties:
        start: number, duration: number, label: string,
        // Optional properties:
        annoClass?: BiosignalAnnotation['class'], channels?: (number | string)[], priority?: number, text?: string,
        visible?: boolean, background?: boolean, color?: SettingsColor, opacity?: number
    ) {
        super(
            'EmgAnnotation', start, duration, label,
            annoClass, channels, priority, text, visible, background, color, opacity
        )
    }
}
