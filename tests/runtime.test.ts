/**
 * Tests for the EMG runtime resource module.
 *
 * The module is the only route from a UI action to a resource mutation, and every branch of it used
 * to drop the promise the core setter returns — so a failed filter change was reported nowhere while
 * the control that triggered it showed the new value. `applyConfiguration` ignored its argument
 * entirely, which left a deployment's module-name override with no effect.
 *
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import runtime from '../src/runtime'
import { Log } from 'scoped-event-log'
import type { DataResource } from '@epicurrents/core/types'

vi.mock('scoped-event-log', async () => (await import('./logMock')).makeLogMock())

/** A resource carrying the members the module's mutations read and write. */
const makeResource = (over: Record<string, unknown> = {}) => ({
    filters: { highpass: 0, lowpass: 0, notch: 0 },
    sensitivity: 1,
    timebase: 10,
    timebaseUnit: 'sec',
    setHighpassFilter: vi.fn().mockResolvedValue(undefined),
    setLowpassFilter: vi.fn().mockResolvedValue(undefined),
    setNotchFilter: vi.fn().mockResolvedValue(undefined),
    ...over,
})

const set = (property: string, value: unknown, resource: object) =>
    runtime.setPropertyValue(property, value, resource as unknown as DataResource)

const warnings = () => (Log.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]))
const errors = () => (Log.error as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]))

beforeEach(() => { vi.clearAllMocks() })

describe('the filter mutations', () => {
    for (const [property, method] of [
        ['highpass-filter', 'setHighpassFilter'],
        ['lowpass-filter', 'setLowpassFilter'],
        ['notch-filter', 'setNotchFilter'],
    ] as [string, 'setHighpassFilter' | 'setLowpassFilter' | 'setNotchFilter'][]) {
        it(`passes a valid ${property} through to the resource`, () => {
            const resource = makeResource()
            set(property, 30, resource)
            expect(resource[method]).toHaveBeenCalledWith(30)
        })

        it(`accepts zero for ${property}, which switches the filter off`, () => {
            const resource = makeResource()
            set(property, 0, resource)
            expect(resource[method]).toHaveBeenCalledWith(0)
        })

        it(`refuses a negative ${property}`, () => {
            const resource = makeResource()
            set(property, -1, resource)
            expect(resource[method]).not.toHaveBeenCalled()
            expect(warnings().length).toBe(1)
        })

        it(`refuses a non-numeric ${property}`, () => {
            const resource = makeResource()
            set(property, '30', resource)
            expect(resource[method]).not.toHaveBeenCalled()
            expect(warnings().length).toBe(1)
        })

        it(`reports a rejected ${property} instead of leaving it unhandled`, async () => {
            const resource = makeResource({
                [method]: vi.fn().mockRejectedValue(new Error('worker gone')),
            })
            set(property, 30, resource)
            await Promise.resolve()
            await Promise.resolve()
            expect(errors().some(m => m.includes('filter failed'))).toBe(true)
        })
    }
})

describe('the display mutations', () => {
    it('sets a positive sensitivity', () => {
        const resource = makeResource()
        set('sensitivity', 50, resource)
        expect(resource.sensitivity).toBe(50)
    })

    it('refuses a zero sensitivity', () => {
        // Zero is rejected here where the filters accept it: a sensitivity of zero is not a
        // switched-off scale, it is a division by zero in the gain derivation.
        const resource = makeResource()
        set('sensitivity', 0, resource)
        expect(resource.sensitivity).toBe(1)
        expect(warnings().length).toBe(1)
    })

    it('sets a positive timebase', () => {
        const resource = makeResource()
        set('timebase', 25, resource)
        expect(resource.timebase).toBe(25)
    })

    it('refuses a zero timebase', () => {
        const resource = makeResource()
        set('timebase', 0, resource)
        expect(resource.timebase).toBe(10)
    })

    it('sets a non-empty timebase unit', () => {
        const resource = makeResource()
        set('timebase-unit', 'msec', resource)
        expect(resource.timebaseUnit).toBe('msec')
    })

    it('refuses an empty timebase unit', () => {
        const resource = makeResource()
        set('timebase-unit', '', resource)
        expect(resource.timebaseUnit).toBe('sec')
        expect(warnings().length).toBe(1)
    })

    it('refuses a non-string timebase unit', () => {
        const resource = makeResource()
        set('timebase-unit', 10, resource)
        expect(resource.timebaseUnit).toBe('sec')
    })
})

describe('setPropertyValue', () => {
    it('reports a property the module does not own', () => {
        set('montage-colour', 'red', makeResource())
        expect(warnings().some(m => m.includes('montage-colour'))).toBe(true)
    })

    it('does nothing without a resource and without a state to find one in', () => {
        expect(() => runtime.setPropertyValue('sensitivity', 50)).not.toThrow()
        expect(warnings().length).toBe(0)
    })

    it('falls back to the active resource of the given state', () => {
        const resource = makeResource()
        const state = { APP: { activeDataset: { activeResources: [resource] } } }
        runtime.setPropertyValue('sensitivity', 42, undefined, state as never)
        expect(resource.sensitivity).toBe(42)
    })
})

describe('applyConfiguration', () => {
    afterEach(async () => {
        // The module object is a singleton, so a name set by one case would leak into the next.
        await runtime.applyConfiguration({ moduleName: { full: 'Electromyography', short: 'EMG' } })
    })

    it('ships the English module name', () => {
        expect(runtime.moduleName.code).toBe('emg')
        expect(runtime.moduleName.full).toBe('Electromyography')
        expect(runtime.moduleName.short).toBe('EMG')
    })

    it('applies a full-name override', async () => {
        await runtime.applyConfiguration({ moduleName: { full: 'Elektromyografi' } })
        expect(runtime.moduleName.full).toBe('Elektromyografi')
        // An override naming one field leaves the other standing.
        expect(runtime.moduleName.short).toBe('EMG')
    })

    it('applies a short-name override', async () => {
        await runtime.applyConfiguration({ moduleName: { short: 'EMYO' } })
        expect(runtime.moduleName.short).toBe('EMYO')
    })

    it('leaves the name alone for a configuration that names nothing', async () => {
        await runtime.applyConfiguration({})
        expect(runtime.moduleName.full).toBe('Electromyography')
    })

    it('never overrides the module code, which keys the registry', async () => {
        await runtime.applyConfiguration({ moduleName: { full: 'Other', short: 'OTH' } })
        expect(runtime.moduleName.code).toBe('emg')
    })
})
