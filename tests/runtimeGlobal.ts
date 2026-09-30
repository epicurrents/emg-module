/**
 * Minimal `window.__EPICURRENTS__` for tests that construct a real core asset.
 *
 * Two separate requirements, both in core. `GenericBiosignalResource`'s constructor reads
 * `window.__EPICURRENTS__.RUNTIME` with the optional chain after the object rather than before it, so
 * the global has to exist even though everything under it may be absent. `GenericAsset`'s constructor
 * then wants `APP` and `EVENT_BUS`, and logs an error naming neither the asset nor the caller when
 * either is missing — which would sit in the log alongside whatever a test is actually asserting on.
 *
 * The bus is core's own `EventBus` rather than a stub. A stub is the wrong shape here twice over: its
 * `dispatchScopedEvent` return value is the before-phase cancellation result, so one answering
 * `undefined` silently blocks every property assignment in core, and one that records listeners
 * without calling them makes an event-driven path look inert. Using the real class removes both
 * hazards and costs nothing — core re-exports it.
 *
 * The module's own settings are installed under `RUNTIME` so a resource sees the same
 * `filterChannelTypes` and `unloadOnClose` the shipped configuration declares.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { EventBus } from '@epicurrents/core'
import emgSettings from '../src/config'

/**
 * Install the runtime global, returning a teardown that removes it again.
 * @param settings - Settings overriding the module's own, merged shallowly over them.
 */
export const installRuntimeGlobal = (settings: Record<string, unknown> = {}) => {
    const globalWithRuntime = window as unknown as Record<string, unknown>
    globalWithRuntime.__EPICURRENTS__ = {
        APP: {},
        EVENT_BUS: new EventBus(),
        RUNTIME: {
            SETTINGS: {
                modules: {
                    emg: { ...emgSettings, ...settings },
                },
            },
        },
    }
    return () => { delete globalWithRuntime.__EPICURRENTS__ }
}
