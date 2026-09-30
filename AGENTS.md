# @epicurrents/emg-module — architecture notes for AI coding assistants

This file is the entry point for AI coding assistants working in the `@epicurrents/emg-module` package: electromyography modality support for the Epicurrents viewer. It is tool-agnostic.

The package follows the study-module pattern that [eeg-module's AGENTS.md](../eeg-module/AGENTS.md) documents as the reference implementation — the same `src/` layout and the same resource / loader / service decomposition. Read that file for the shared pattern, the activation lifecycle and the SAB cache rules; this file covers only what EMG adds, and [README.md](README.md) carries the narrative description of the module's behaviour.

The module is the smallest of the study modules: no montage, no setup, no derivations. What it has instead is audio.

## Toolchain compliance — HIGH PRIORITY

This package depends on `@epicurrents/core` and shares a single toolchain with it. **Never pin package-specific versions that diverge from the canonical set** — a divergent TypeScript produces structurally incompatible `.d.ts` files that type-check locally but corrupt data at runtime, because worker-side and main-thread code can then disagree on data layouts while everything still compiles.

| Tool | Version |
|---|---|
| `@epicurrents/core` | `^2.0.0` |
| TypeScript | `^5.7.0` |
| Vite | `^7.3.1` |
| ESLint | `^9.18.0`, flat config in [eslint.config.mjs](eslint.config.mjs) |
| tsconfig base | extends `@epicurrents/core/tsconfig.base.json` |

`npm run build` produces one artifact, the ESM `dist/`: [vite.config.mjs](vite.config.mjs) emits the JavaScript and `epicurrents-build-types` from core emits the declarations, rewriting their `#` aliases into paths a consumer can resolve. The module has no worker of its own — it drives whichever reader the deployment pairs it with — so it needs no standalone bundle.

The core version appears in three places that must agree: `devDependencies`, `peerDependencies`, and the APIs the source actually calls. The workspace symlinks core rather than installing it, so a stale range type-checks and builds perfectly against whatever version is checked out; only an external consumer sees the mismatch, as a core that lacks the APIs this package calls. Bump the range in the same commit as any change that depends on a new core API.

## The audio asset is this module's own concern

`EmgRecording` owns a `BiosignalAudio` beside its signal cache, and nothing in core knows that a resource might make sound. Three consequences.

**`destroy` has to destroy it.** The base class does not know the asset exists, and the asset holds a buffer and an `AudioContext`.

**`setAudioSignals` takes seconds, not samples.** The parameter is named `length`, which invites the other reading, and it reaches core's `mintDirectBuffer` as `durationSeconds`. Passing a sample count produces a buffer longer than the recording by a factor of the sampling rate.

**Every channel goes in one call.** `setSignals` replaces the buffer rather than appending to it, so calling it per channel leaves only the last channel audible. Both call sites — the deserialiser and the end of `_completeSetup` — pass the whole set at once.

The sample scale (`sampleMaxAbsValue = 5e-2`) is the largest amplitude surface EMG produces and the asset normalises against it. It is a physical claim about the signal, not a volume knob: raising it makes every recording quieter, lowering it clips.

## Filters are declared and not applied

This is the trap most likely to cost someone an afternoon, because every layer of it reports success.

The runtime module in [src/runtime/index.ts](src/runtime/index.ts) handles `highpass-filter`, `lowpass-filter` and `notch-filter`, the interface module declares three matching actions, and core's setters accept the value and dispatch a property-change event. **No sample is filtered.** `MontageProcessor` is the only code in the workspace that calls `filterSignal`, and this module defines no montage.

[src/config/index.ts](src/config/index.ts) declares `filterChannelTypes: { emg: [...] }`, which closes the half of the gap that was a plain omission — without it core's `getChannelFilters` would not propagate a recording default to an EMG channel even once a filtering path exists. The other half needs a montage. Do not read the presence of the setting as evidence that filtering works; [ROADMAP.md](ROADMAP.md) carries the open item.

## Async boundaries that return void

Three slots in this package take a callback whose return value is discarded, and each one needs its own rejection handler. The scoped event bus calls listeners synchronously and ignores what they return, so an `async` listener's rejection has nowhere to go.

| Site | What is caught |
|---|---|
| `ACTIVATE` listener in `EmgRecording` | `_completeSetup`, which also sets an error state so the failure is visible on the resource. |
| `DEACTIVATE` listener in `EmgRecording` | `unload`, whose failure otherwise leaves the recording holding its memory silently. |
| `message` listener in `EmgService` | `handleMessage`, which is async while the listener slot is not. |

The `.then` on `prepareWorker` needs its `.catch` for the same reason: without it a rejection leaves the recording in `loading` for the rest of the session with nothing said about why.

When adding a branch to the runtime module, note that core's three filter setters are `async`. A branch that calls one without a catch is a floating promise; `@typescript-eslint/no-floating-promises` is on and will say so.

## Two paths build the channels, and they must agree

`EmgRecording`'s constructor builds channels from `source.meta.nChannels`; `EmgRecording.fromSerialized` builds them from the template's channel list, keeping every channel that carries a signal. **Neither path may truncate.** They disagreed once — the deserialiser kept one channel — which meant a recording's channel count depended on whether it had been through a serialisation round trip.

The fallback names and labels are positional: `channel_<i>` and `Ch <i+1>`, indexed over every mapped channel rather than over the unnamed ones, so a named channel still advances its neighbours' numbering.

## Internal path aliases

Two alias tables have to agree, and they are not written the same way. [tsconfig.json](tsconfig.json) maps `#*` to `src/*` — a wildcard, so any name resolves. `ALIASES` in [vite.shared.mjs](vite.shared.mjs) enumerates the directories explicitly, because the package declares no `imports` field and an unlisted alias has nothing to fall through to.

The asymmetry means **a new top-level directory under `src/` type-checks and fails to build**: `tsc` resolves `#newdir` through the wildcard while Vite and Vitest do not. Add the name to the regex in [vite.shared.mjs](vite.shared.mjs) in the same commit that creates the directory.

## Tests

`npm test` runs two steps: `test:types` type-checks the suite through [tsconfig.test.json](tsconfig.test.json), then `test:unit` runs Vitest. `vitest` and `@vitest/coverage-v8` come from the workspace root rather than this package's own `devDependencies`.

**There are no test doubles for core.** Every case either constructs a real core class or calls a prototype method against a stub carrying only the members that method reads. That is deliberate: a double drifts from the class it stands in for, and a test asserting on a double's property verifies nothing about what the package ships. The type-check step is what keeps it honest, which is why it runs before the unit step.

Three things about the test environment, each learned from core rather than from this package:

- **`window.__EPICURRENTS__` has to exist** before any core asset is constructed. `GenericBiosignalResource` reads `window.__EPICURRENTS__.RUNTIME` with the optional chain *after* the object, and `GenericAsset` wants `APP` and `EVENT_BUS` under it. [tests/runtimeGlobal.ts](tests/runtimeGlobal.ts) installs all three.
- **The event bus must be the real one.** `dispatchScopedEvent`'s return value is the before-phase cancellation result, so a stub answering `undefined` makes core's `_setPropertyValue` treat every assignment as prevented — a resource whose fields all silently stay at their defaults. Core re-exports `EventBus`, so using it costs nothing.
- **A `scoped-event-log` mock needs a default export and more than the four levels.** Core's compiled output imports the logger as a default while this package imports it by name, and core's service constructors call `Log.registerWorker`. [tests/logMock.ts](tests/logMock.ts) carries the surface core actually reaches for.

**Test the exported code, not a copy of it.** A test that re-implements the logic it is checking passes regardless of what the production code does, which is worse than no test: it reports coverage of a method it cannot fail on. The corollary for review: when a test file declares a local helper that mirrors a production function, check whether the assertions reach the real one.

## Code comment conventions

Comments and docstrings describe the code's **current contract** — what it does and the invariants it upholds, for a reader who has never seen an earlier version.

- **No change history, migration state or roadmap phases.** Don't narrate what the code used to do or which delivery stage a collaborator belongs to; a reader has no way to date the remark. That belongs in the commit message, where `git blame` surfaces it.
- **Describe the layer's own contract, not its consumers.** State the invariant the layer guarantees so it holds regardless of who calls it.
- **Keep the `@package` / `@copyright` / `@license` header** on every source file.
- **Wrap TypeScript source at a 120-column soft cap** — code, docstrings and comments alike. The one exception: `@param` docstrings stay on a single line regardless of length, because wrapping them renders poorly in the VS Code hover. Do not hard-wrap Markdown prose: one line per paragraph, since docs are read as rendered output at varying widths.
