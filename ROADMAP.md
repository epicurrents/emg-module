# @epicurrents/emg-module — roadmap

What the package audit left open. The four findings this file carried in from the sibling audits — the misnamed eslint config, the `fromTemplate` coalescing, the absent tests and the stale core range — are all closed.

## An EMG recording is never filtered

The runtime module handles `highpass-filter`, `lowpass-filter` and `notch-filter`; the interface EMG module declares three matching actions; core's setters accept the value, store it and dispatch a property-change event. No sample is filtered at any point.

`MontageProcessor` is the only code in the workspace that calls `filterSignal`, and this module defines no montage — so there is no code path between a stored filter value and an EMG signal. Nothing reports this: every layer succeeds at what it is individually responsible for.

Half of the gap is closed. [src/config/index.ts](src/config/index.ts) now declares `filterChannelTypes: { emg: ['highpass', 'lowpass', 'notch'] }`, without which core's `getChannelFilters` would not propagate a recording-level default to an EMG channel even once a filtering path existed; that omission was the same one acc-module found and fixed for itself. The remaining half needs somewhere for the filtering to happen.

Two shapes it could take, and they are not equivalent. A montage, following acc-module, gives EMG the whole montage machinery — filtering, derivations, cascade views — for a modality that has no montages in the clinical sense, one channel being one muscle. Filtering in the reader instead would suit the data but has no precedent in the family and would put a filter in a layer that currently serves raw signals to every modality. The decision is worth making explicitly rather than by whichever is easier when someone adds the control.

Until then, treat the three runtime branches and the three interface actions as declared and inert. `EmgControls.vue` renders no filter control, so nothing reaches them today.

## The interface EMG module's lifecycle hooks are typed for documents

`resourceLifecycleHooks` in the interface package's EMG module declares `beforeDestroy`, `created` and `destroyed` as taking a `DocumentResource`, copied from doc-module. All three bodies are empty, so nothing misbehaves, but the first hook anyone writes is typed for the wrong resource. Lives in the interface package, not here.

## `EmgResource` declares an audio surface that only this class implements

The interface carries five audio members, and `EmgRecording` is the only implementation. That is fine while EMG is the only modality with audio, but the split to watch is that `BiosignalAudio` is core's while the playback surface is this module's — so a second modality that wants sound would either duplicate these five members or motivate moving them to a core-side interface. No action needed until a second one appears.

## Multi-channel audio is untested against a real buffer

Both call sites now pass every channel to `setAudioSignals` in one call, and a test pins that. What no test covers is what the asset does with more than one: `mintDirectBuffer` is reached only in a browser, since jsdom has no `AudioContext`, so the suite asserts on the call rather than on the sound. A recording with several muscles is the normal case for EMG, and whether they arrive as separate audio channels or mixed is unverified here.

Checking it needs either a browser-mode Vitest project or an `AudioContext` stub faithful enough to be worth trusting. The first is the honest option and is a workspace-level decision rather than this package's.

## Core reads the runtime global without guarding the object

`GenericBiosignalResource`'s constructor reads `window.__EPICURRENTS__.RUNTIME?.SETTINGS`, with the optional chain after the object rather than before it, so an absent global throws a `TypeError` naming `RUNTIME` rather than reporting a missing application. `GenericAsset`, a few lines earlier in the same construction, checks the object properly and logs. A core fix, noted here because it is what every test in this package has to work around and the workaround looks arbitrary without the reason.

## The declared subpath exports are wider than anything imports

[package.json](package.json) exports `./config`, `./runtime`, `./dist/config` and `./dist/runtime` in addition to the entry and the types. Nothing in the workspace uses any of the four: the builder imports the package namespace and the interface imports `./dist/types`. acc-module, audited later, declares only the entry, the types and `package.json`.

Narrowing them is a breaking change for any external consumer that reached for one, which is why this is a note rather than a change already made. The build emits the two entry points either way.
