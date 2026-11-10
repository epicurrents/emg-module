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
| `EmgCascadeMontage` | The cascade view of one channel, described under [the cascade](#the-cascade). |
| `EmgMontageChannel` | A montage row, keeping the `emg` modality on every row a cascade cuts. |
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

1. **Construction.** `EmgStudyLoader.getResource()` builds an `EmgRecording` from the loaded study. The channel count, duration and sampling rate come from the study's `meta`, so the loader refuses a study that carries none of them rather than producing a recording with no channels. The constructor creates one `EmgSourceChannel` per declared channel, starts the service and reports the recording `loading`; the state advances to `ready` when the worker answers, and to `error` when it answers with nothing or rejects. The loader also hands over the application's memory manager, which the recording keeps only while `emg.useMemoryManager` is on. That is the setting a host reads to give the study a reader in its own thread, and such a reader can serve only a shared cache: a recording given that worker without the manager commissions a plain cache it can never read, and every draw asks for an empty range.

2. **Activation.** Making the recording active dispatches `ACTIVATE`, and the listener runs `_completeSetup` once. That is where the memory budget is requested, the mutex or the plain cache is commissioned, the signals are read, and the audio buffer is filled from them. The listener slot is synchronous, so the setup's rejection is caught inside the listener: unhandled, it would leave the recording half set up with nothing said about it.

3. **Deactivation.** Closing the recording unloads it only when `unloadOnClose` is set, which it is not by default — EMG recordings are short and reopened often, and the audio buffer is rebuilt from the cached signals.

### The memory budget

`_completeSetup` asks the memory manager for a float count, and that count has to match the layout the mutex writes: **one cell for the master lock plus five for the mutex meta fields** (`allocated`, `start`, `end`, `data_unit_duration`, `window_epoch`), then per channel its samples plus that channel's own meta header. The five meta fields are easy to forget because none of them is named in this package; they are `BiosignalMutex`'s, in core. The samples cover `BiosignalMutex.coveredLength` of the recording rather than its own length: the mutex stores its range in whole data units, so a 7.3 s recording is laid out as 8 s, and a request for 7.3 s leaves the buffers running past the allocation.

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

The cascade
-----------

`addCascadeMontages(rowCount, pageLength)` gives every source channel a cascade montage, named `cascade:<channel name>` and labelled with the channel's label, and keeps one a channel already has. Activating it with `setActiveMontage` makes `getAllSignals` answer one row per stacked page: row `i` starts `i` pages after the view start, so a page turn moves the view by the whole stack, `pageStep`. The cascade reads the source through the raw-signal path and cuts it on the main thread, as core's cascade does, so with shared memory it is refused until the recording's buffer is set up.

What sets it apart from core's other cascades is the timebase. Core's cascade locks the timebase unit to sec/page and keeps the row length as its own `pageLength`, which is the whole of an EEG timebase. An EMG timebase is ms/div, and what one page spans in seconds depends on how many divisions the display is wide, which this package cannot know. `EmgCascadeMontage` therefore sets no timebase unit: the recording keeps its ms/div timebase, a timebase change never reaches the montage, and the display assigns `pageLength` from the page it draws. `rowCount` is settable on it, and an assignment rebuilds the rows in place.

The recording has no setup of its own until the first cascade asks for one: `_sourceSetup` builds it from the source channels in source order, which is what makes a setup channel's index the source signal's index in the cache.

Annotations
-----------

`EmgEvent.fromTemplate` and `EmgLabel.fromTemplate` build an annotation from a template. Both copy every optional field with `??` rather than `||`, and the distinction is not cosmetic: the annotation constructors in core read an *absent* option as a request for the default, resolving `visible` to `true` and assigning `opacity` unguarded. Copying with `||` therefore turns a template marked hidden into a visible annotation and a fully transparent one into whatever the renderer defaults to.

Settings
--------

The module ships the common biosignal settings with no EMG-specific additions, and two of the defaults carry a decision:

- **`filterChannelTypes: { emg: […] }`** is what makes a recording-level filter default reach an EMG channel at all. Core's `getChannelFilters` propagates a default only to channels whose modality is listed there, so an omitted entry leaves every channel on its own zero. Note the limit of what declaring it buys: the raw signals are filtered nowhere, and the one montage this module defines, [the cascade](#the-cascade), filters only its own rows. See [ROADMAP.md](ROADMAP.md).
- **`unloadOnClose: false`**, for the reason given under the lifecycle above.

Licence
-------

Apache-2.0. See [LICENSE](LICENSE).
