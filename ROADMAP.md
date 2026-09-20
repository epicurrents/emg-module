# @epicurrents/emg-module — roadmap

Findings carried in from the audits of the sibling packages, recorded here so they survive until this package's own audit opens it. The package has not been audited itself, so this is not a complete list of what is open — only of what is already known.

## eslint reads no configuration, so the lint script checks nothing

The configuration file is named [.eslint.config.mjs](.eslint.config.mjs), with a leading dot. eslint 9 looks for `eslint.config.mjs` without one, finds nothing, and exits pointing at the flat-config migration guide. `npm run lint` has therefore never linted a line of this package, and the failure reads as a configuration problem rather than as a missing file.

Renaming the file is the whole fix. Expect the first successful run to report a large number of findings — the flat config is core's, and it reported in the hundreds when it first reached acc-module — so budget the triage separately from the rename. ncs-module has the identical misnaming.

## `fromTemplate` turns a falsy option into a default

[EmgLabel.fromTemplate](src/components/EmgLabel.ts) and [EmgEvent.fromTemplate](src/components/EmgEvent.ts) copy twenty template fields through `tpl.x || undefined`. For a string or an array the two operators agree, but for a boolean or a number they do not: `||` maps `false`, `0` and `''` to `undefined`, and the annotation constructors read an absent option as "use the default".

`GenericAnnotation` resolves `this._visible = options?.visible ?? true`, so a template that marks an annotation hidden produces a visible one. `GenericBiosignalEvent` assigns `this._opacity = options.opacity` unguarded, so `opacity: 0` reaches the renderer as `undefined` and is drawn at whatever the renderer defaults to. The remaining falsy-capable fields — `locked`, `priority`, `background` — resolve to the same value either way and are unaffected today, which is the reason the whole set should change rather than the two that currently bite.

The fix is `??` throughout, which is what acc-module's equivalents now use. The same defect is live in eeg-module and ncs-module.

## The package has no tests

[tests/tests.ts](tests/tests.ts) holds an empty `describe` block and a note that the tests must run sequentially because of how integrated the module is. There is a [vitest.config.ts](vitest.config.ts) and a `test` script, so `npm run test` passes on nothing.

The integration concern the placeholder names is real for the recording and service paths, which need a worker and a memory manager to say anything. It does not reach the components: `fromTemplate`, the source channel and the settings defaults are pure enough to test directly, and that is where the known defect above lives. Start there rather than with the sequencing problem.

## The declared core range excludes the core this builds against

`package.json` asks for `@epicurrents/core: ^1.0.0` in both `devDependencies` and `peerDependencies`, and core is at 2.0.0. The workspace symlink resolves core from the checkout regardless, so nothing fails locally and the range is only load-bearing for a consumer installing from the registry.

Fifteen of the seventeen dependent packages carry the same stale range; only the two opened by the current audit sweep have been moved to `^2.0.0`. The family view of it is in the builder's roadmap.
