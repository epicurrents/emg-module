Electromyography module for Epicurrents
=======================================

EMG modality support for the Epicurrents viewer: a biosignal resource, its study loader, its worker service, and the annotation components a reader creates on an EMG trace. The module is registered with the application under the `emg` modality code and reads its signals through whichever importer the deployment pairs it with — the builder's EMG edition pairs it with [@epicurrents/wav-reader](../wav-reader), because EMG arrives as WAV rather than EDF.

What distinguishes EMG from the other biosignal modalities in this family is **audio playback**. Surface EMG is read by ear as much as by eye, so the recording owns a `BiosignalAudio` asset alongside its signal cache and exposes playback as part of its public surface.

Installation
------------

```sh
npm install @epicurrents/emg-module
```

The package declares [@epicurrents/core](../core) and [scoped-event-log](https://github.com/sam-19/scoped-event-log) as peer dependencies; install one copy of each. Core holds the runtime singletons this module registers against, so a second bundled copy would register against a different one.

Public surface
--------------

| Export | What it is |
|---|---|
| `EmgRecording` | The biosignal resource. Owns the channels, the signal cache and the audio asset. |
| `EmgStudyLoader` | Turns a loaded study into an `EmgRecording`, narrowing the study to the `emg` modality. |
| `EmgService` | Commissions and drives the reader worker. |
| `EmgSourceChannel` | A source channel fixed to the `emg` modality and microvolt units. |
| `EmgEvent`, `EmgLabel` | The annotation components, each with a `fromTemplate` constructor. |
| `EmgEvents` | The module's own event names, all four of them playback events. |
| `runtime`, `settings`, `modality` | What `app.registerModule('emg', …)` consumes. |

The types are re-exported from the package entry and are also reachable at `@epicurrents/emg-module/types`.

The recording lifecycle
-----------------------

Three steps, in order, and the ordering matters at each boundary.

1. **Construction.** `EmgStudyLoader.getResource()` builds an `EmgRecording` from the loaded study. The channel count, duration and sampling rate come from the study's `meta`, so the loader refuses a study that carries none of them rather than producing a recording with no channels. The constructor creates one `EmgSourceChannel` per declared channel, starts the service and reports the recording `loading`; the state advances to `ready` when the worker answers, and to `error` when it answers with nothing or rejects.

2. **Activation.** Making the recording active dispatches `ACTIVATE`, and the listener runs `_completeSetup` once. That is where the memory budget is requested, the mutex or the plain cache is commissioned, the signals are read, and the audio buffer is filled from them. The listener slot is synchronous, so the setup's rejection is caught inside the listener: unhandled, it would leave the recording half set up with nothing said about it.

3. **Deactivation.** Closing the recording unloads it only when `unloadOnClose` is set, which it is not by default — EMG recordings are short and reopened often, and the audio buffer is rebuilt from the cached signals.

### The memory budget

`_completeSetup` asks the memory manager for a float count, and that count has to match the layout the mutex writes: **one cell for the master lock plus five for the mutex meta fields** (`allocated`, `start`, `end`, `data_unit_duration`, `window_epoch`), then per channel its samples plus that channel's own meta header. The five meta fields are easy to forget because none of them is named in this package; they are `BiosignalMutex`'s, in core.

Audio playback
--------------

The recording exposes `playAudio`, `pauseAudio`, `rewindAudio`, `setAudioGain` and `setAudioSignals`, and announces every transition on the event bus so a control can follow it without polling:

| Event | When |
|---|---|
| `emg-audio-playback-started` | Playback begins, with the position in the payload. |
| `emg-audio-playback-paused` | Playback pauses, with the position in the payload. |
| `emg-audio-playback-stopped` | Playback is rewound, or has run out. |
| `emg-audio-playback-ended` | Playback reached the end of the recording. Followed by the stopped event, so a control listening for only one of the two still learns that playback finished. |

Each of the three playback methods dispatches its event in the `before` phase as well as the `after` one, and answers a boolean rather than throwing.

Two numbers in this path are worth knowing before changing them. `setAudioSignals` takes its length in **seconds**, not samples — it reaches core as `durationSeconds`. And the sample scale is capped at 50 mV, which is the largest amplitude surface EMG produces; the asset normalises against that cap, so raising it makes every recording quieter and lowering it clips.

The gain follows the sensitivity: the recording watches its own `sensitivity` property and rescales the audio by `1e-6 / sensitivity`, so the trace and the sound stay in step.

Annotations
-----------

`EmgEvent.fromTemplate` and `EmgLabel.fromTemplate` build an annotation from a template. Both copy every optional field with `??` rather than `||`, and the distinction is not cosmetic: the annotation constructors in core read an *absent* option as a request for the default, resolving `visible` to `true` and assigning `opacity` unguarded. Copying with `||` therefore turns a template marked hidden into a visible annotation and a fully transparent one into whatever the renderer defaults to.

Settings
--------

The module ships the common biosignal settings with no EMG-specific additions, and two of the defaults carry a decision:

- **`filterChannelTypes: { emg: […] }`** is what makes a recording-level filter default reach an EMG channel at all. Core's `getChannelFilters` propagates a default only to channels whose modality is listed there, so an omitted entry leaves every channel on its own zero. Note the limit of what declaring it buys: signals are filtered in core's `MontageProcessor`, this module defines no montage, and so **an EMG recording is not filtered today** whatever the setting says. See [ROADMAP.md](ROADMAP.md).
- **`unloadOnClose: false`**, for the reason given under the lifecycle above.

Licence
-------

Apache-2.0. See [LICENSE](LICENSE).
