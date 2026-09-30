/**
 * Tests for the template constructors of `EmgEvent` and `EmgLabel`.
 *
 * The properties under test are the ones whose meaningful value is falsy. Core applies its own
 * defaults to an absent option (`visible ?? true`, and an absent label renders the annotation's
 * value), so a template field arriving as `undefined` is indistinguishable from one that was never
 * set — which is how a deliberately hidden annotation becomes a visible one.
 *
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { describe, expect, it } from 'vitest'
import EmgEvent from '../src/components/EmgEvent'
import EmgLabel from '../src/components/EmgLabel'
import type { AnnotationEventTemplate, AnnotationLabelTemplate } from '@epicurrents/core/types'

const eventTemplate = (over: Partial<AnnotationEventTemplate> = {}) => ({
    start: 0,
    duration: 1,
    label: 'Burst',
    ...over,
}) as AnnotationEventTemplate

const labelTemplate = (over: Partial<AnnotationLabelTemplate> = {}) => ({
    value: 'artefact',
    label: 'Artefact',
    ...over,
}) as AnnotationLabelTemplate

describe('EmgEvent.fromTemplate', () => {
    it('preserves an explicitly hidden event', () => {
        // The headline case: `||` mapped `false` to undefined and core then read the absent option
        // as a request for its default, which is visible.
        expect(EmgEvent.fromTemplate(eventTemplate({ visible: false })).visible).toBe(false)
    })

    it('defaults to visible when the template does not say', () => {
        expect(EmgEvent.fromTemplate(eventTemplate()).visible).toBe(true)
    })

    it('preserves a fully transparent event', () => {
        // `GenericBiosignalEvent` assigns opacity unguarded, so an undefined here reaches the
        // renderer as undefined rather than as zero.
        expect(EmgEvent.fromTemplate(eventTemplate({ opacity: 0 })).opacity).toBe(0)
    })

    it('preserves an unlocked event', () => {
        expect(EmgEvent.fromTemplate(eventTemplate({ locked: false })).locked).toBe(false)
    })

    it('carries the values a template does set', () => {
        const event = EmgEvent.fromTemplate(eventTemplate({
            annotator: 'reader-1',
            channels: [2],
            start: 3,
            duration: 1.5,
            visible: true,
            opacity: 0.5,
        }))
        expect(event.annotator).toBe('reader-1')
        expect(event.channels).toEqual([2])
        expect(event.start).toBe(3)
        expect(event.duration).toBe(1.5)
        expect(event.opacity).toBe(0.5)
    })

    it('leaves an absent channel list as the all-channels default', () => {
        // Core normalises an absent list to an empty one, which means every channel.
        expect(EmgEvent.fromTemplate(eventTemplate()).channels).toEqual([])
    })
})

describe('EmgLabel.fromTemplate', () => {
    it('preserves an explicitly hidden label', () => {
        expect(EmgLabel.fromTemplate(labelTemplate({ visible: false })).visible).toBe(false)
    })

    it('defaults to visible when the template does not say', () => {
        expect(EmgLabel.fromTemplate(labelTemplate()).visible).toBe(true)
    })

    it('preserves an unlocked label', () => {
        expect(EmgLabel.fromTemplate(labelTemplate({ locked: false })).locked).toBe(false)
    })

    it('carries a falsy but meaningful value through untouched', () => {
        // The value is a constructor argument rather than an option, so it never went through the
        // coalescing; the case pins that it stays that way.
        expect(EmgLabel.fromTemplate(labelTemplate({ value: false })).value).toBe(false)
        expect(EmgLabel.fromTemplate(labelTemplate({ value: 0 })).value).toBe(0)
    })

    it('carries the values a template does set', () => {
        const label = EmgLabel.fromTemplate(labelTemplate({ annotator: 'reader-2', value: 'noise' }))
        expect(label.annotator).toBe('reader-2')
        expect(label.value).toBe('noise')
    })
})
