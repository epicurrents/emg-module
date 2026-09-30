/**
 * Replacement for `scoped-event-log` in tests that assert on what was logged.
 *
 * Two shape requirements, both learned from core rather than from this package. Core's compiled
 * output imports the logger as a default while this package imports it by name, so the module has to
 * export it both ways or a core path that logs throws instead of logging. And core reaches for more
 * than the four level methods — `registerWorker` in particular, from every service constructor — so a
 * mock carrying only the levels fails at construction with a message about the mock rather than about
 * the code under test.
 * @package    epicurrents/emg-module
 * @copyright  2025 Sampsa Lohi
 * @license    Apache-2.0
 */

import { vi } from 'vitest'
/** The module shape `vi.mock('scoped-event-log', ...)` should return. */
export const makeLogMock = () => {
    const Log = {
        LEVELS: { DISABLE: 0, ERROR: 1, WARN: 2, INFO: 3, DEBUG: 4 },
        add: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        registerWorker: vi.fn(),
        setPrintThreshold: vi.fn(),
        warn: vi.fn(),
    }
    return { Log, default: Log }
}
