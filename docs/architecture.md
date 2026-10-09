# Current runtime architecture

Feature baseline: `5a37dba` after P2 DSP/Modulation, the Erica-style production
resonator, macros, product presets, snapshots and Morph. The workspace cleanup
combines the editors and reduces manual sources to four. This map does not supersede
historical measurement reports.

## Signal flow

`audio-engine.js` owns device/sample input, node lifecycle and output playback:

```text
Device or sample -> sourceBus -> Input Gain -> Input Character Worklet
                                            |-> dry gain ------------------|
                                            |-> Filterbank -> wet gain ----|-> mix
mix -> Master Volume -> Output Guard -> Final Soft Protection -> media destination
sourceBus -> Bypass gain -------------------------------------> media destination
```

Bypass follows the existing direct source-to-output path. The analyzer branches
are taps with no connection back into audio output. Input and Filterbank spectrum
taps have different positions; do not infer routing from a UI graph's location.

## Ownership

| Component | Existing responsibility |
| --- | --- |
| `app.js`, `ui/*.js`, `index.html`, `styles.css` | Controllers, workspace visibility, UI-only graphs, themes, MIDI setup, keyboard, product preset/snapshot/Morph controls and separate DEV/LAB snapshots; see [UI modules](#ui-modules) |
| `state.js` | Base configuration, normalization and compatibility; not a second DSP engine |
| `presets-core.mjs` | Version-1 explicit production base projection using existing normalizers; user library/file exchange, immutable A/B snapshots and semantic Morph; no DSP or parallel application state |
| `audio-engine.js` | Web Audio graph, source selection, transport forwarding and worklet messages |
| `filterbank.js` | Filterbank wrapper, control updates and shared band definitions |
| `filterbank-processor.js` | Ten-band stereo processing, feedback/resonance, FILTER, Dynamic EQ and modulation application |
| `filter-shape-core.mjs`, `filter-shape.js` | Shared FILTER shape/math; browser compatibility facade |
| `dynamic-eq-core.mjs` | ABS/REL, LINKED/DUAL detection and gain smoothing helpers; source-only detection before feedback/gain |
| `modulation-core.mjs` | Shared target registry, assignment compiler and DAG; four manual static macro source states; effective contributions preserve bases |
| `lfo-core.mjs` | Four configured LFO sources, waveform/phase and assignment state |
| `envelope-core.mjs` | Four independent Peak/RMS Envelope sources with threshold, delay and attack/release |
| `clock-core.mjs` | Shared audio-sample clock and MIDI 24-PPQN transport/phase |
| `clock-mod-core.mjs` | Dedicated Clock Mod oscillator/progression and ten holds; latest/band source taps use shared assignments and independent step timing |
| `midi-device-manager.mjs` | Access, discovery, one selected input/listener and hotplug handling; UI requests access through ENABLE MIDI |
| `input-preamp-processor.js` | Production Character curves, adaptive 1x/2x/4x FIR differential path, aligned stage handover and 192-sample delay; linear input gain is owned by the GainNode |
| `output-guard-processor.js` | Independent gain-reduction guard before final soft protection |
| `output-protection-processor.js` | Final bounded soft-protection transfer |

Worklet runtime phase, detector history and Clock Mod held values remain runtime
data. Stored base fields and IDs are compatibility contracts. Telemetry is
rate-limited (typically 15 Hz) and may miss short audio transitions; a diagnostics
packet is not a replacement for rendered-sample assertions.

Modulation follows `Source → Assignments → Target Registry → Mapping → Effective
→ DSP`. Four LFOs, four Envelope Followers, Clock Mod and four manual macros
own stable assignment lists; the shared core compiles routes
per target/source/channel on state updates. Runtime sums contributions without
changing stored bases. Registry capabilities and availability drive both UI and
DSP. Unavailable/invalid routes persist and valid targets automatically
reactivate them. Clock Mod exposes its existing held normalized/native-dB
source taps to these same routes. All contributions join before the existing
final band-gain clamp. Meta routes use the existing validated DAG.
`macro.1` through `macro.4` publish static unipolar values (`value / 100`);
zero is neutral. Their values are not targets, so they add no incoming meta
edges. State/snapshots persist `macroSources` with IDs, values and assignments;
old states default to four neutral empty macros. Value-only Worklet messages
update prepared source handles without resetting modulators. Runtime retains
the 32-sample control tick, existing smoothing and allocation-free evaluation. See
[`modulation-core.md`](modulation-core.md) for migration and channel contracts.

Product presets and A/B snapshots share one production-base contract, separate
from DEV/LAB snapshots. INIT uses actual defaults. Library selection is silent;
LOAD/RECALL apply through existing AudioEngine setters without recreating audio
nodes. Master listening level, guard/safety, devices, UI, runtime histories and
DEV architecture choices remain session-owned. Input Gain is a saved sound
base because it drives Input Character before the dry/wet split.

Morph always derives bases from immutable A/B endpoints: semantic linear/dB or
log-frequency/time interpolation, with discrete topology switching at 50%.
Compatible assignment amounts reuse compiled links; structural changes use the
existing compiler/DAG only when configuration changes. All existing modulation
still acts above these bases. Configuration work stays outside sample/control
hotpaths; Morph does not persist per slider frame. Schema, storage, limits and
measurement details are in [`presets-snapshots.md`](presets-snapshots.md).

`tests/helpers/input-character-architecture*.cjs` and related measurement bundles
are experiments, including frozen comparison variants. They are deliberately
separate from production, even when a historical filename says "production".

## UI modules

`app.js` is the entry. It imports the modules under `ui/` in setup order; each
module builds its part of the DOM and registers its listeners while it loads.

| Modules | Area |
| --- | --- |
| `app-context.js` | State constants, the UI `state` object, the AudioEngine handle, `hooks` |
| `dev-lab-panel.js`, `dev-lab-controls.js`, `dev-lab-bindings.js`, `dev-lab-help*.js`, `dev-lab-telemetry.js`, `sweetspots.js` | DEV / LAB panel, its controls and their engine bindings, help, telemetry/debug console, sweetspots |
| `analyzer-header.js`, `spectrum-renderer.js`, `band-analyzer.js` | Filterbank response header, spectrum canvas, band bars and overlays |
| `band-gain-range.js`, `bands.js`, `global-controls.js`, `global-audio-sync.js`, `keyboard-preferences.js`, `keyboard-shortcuts.js` | Band strips, global sliders, feedback buttons and keyboard control |
| `modulation-assignments.js`, `macro-mode.js`, `filter-mode.js`, `dynamic-eq-mode.js`, `midi-clock.js`, `lfo-mode.js`, `clock-mod-mode.js`, `envelope-mode.js` | Workspace modes and the shared assignment editor |
| `mode-navigation.js`, `mode-api.js` | Mode tabs and the `window.*Mode` APIs used by tests |
| `audio-io.js`, `state-sync.js`, `presets.js`, `theme.js` | Audio source/devices and engine creation, engine-to-UI restore, presets, themes |

Rules that keep the setup order deterministic:

- A module imports only modules that `app.js` loads before it.
- A call from an earlier module into a later one goes through `hooks` in
  `app-context.js`. Each hook is declared there with its owning module, assigned
  once by that module, and only used from event handlers and render calls.
- A `let` that another module assigns is exported together with a setter from
  the module that declares it.
- `tests/ui-module-graph.test.mjs` checks the load order, the import direction
  and the hooks.

## P1-C DSP and compatibility decisions

Input Character now runs the prepared adaptive FIR architecture in the actual
Worklet. All stages, including LINEAR and Amount 0, share 192 host samples of
delay before the global dry/wet split. Startup processes muted for 250 ms and
then ramps the selected output over 10 ms. See
[`input-character-production.md`](input-character-production.md) for rates,
handover, measurements and the remaining 96-kHz performance watch item.

The `phase2` positive-resonance selector is **RETAIN AS EXPERIMENT**. It selects
the older LOCAL comparison in ISOLATED TPT, not a new production core. CURRENT
Common Bus/local loop, Unified ZDF and Per-Band ZDF keep their current LOCAL and
MAIN contracts. Per-Band ZDF already has Phase-1 local implicit returns and
Phase-2 coupled MAIN returns; these are independent of the legacy selector.
The isolated nonlinear TPT path supplies its matched 2x audition residual.
No documented final calibration/interaction contract justifies another
resonator architecture. Existing reachable comparison paths, residual telemetry,
signed negative resonance and legacy MAIN selection are preserved; no resonator
DSP was changed. A future promotion/removal requires a separate sound/CPU decision.
The stored legacy engine also gates TPT-specific LOCAL LOOP COMPENSATED tuning:
`phase2` retains the nominal loop frequencies. This compatibility side effect
is covered by the existing local-loop tuning audio test and is preserved.

`spreadCurve` and `spreadMode` follow **retain internal compatibility fields**.
Curve names round-trip old snapshots without transforming the concrete dB
offset; the inactive curve selector is removed. Legacy `FB_CH_SELECT` retains
its no-global-spread gate in the worklet and registry. Current P/CH authority,
L/R bases, anchors and assignment CHANNEL=SPREAD are unchanged. Invalid legacy
values normalize to `linear`/`CLASSIC`.

The obsolete MOD feature placeholder was removed; the current `mod` workspace
is deliberately empty after moving macros into PRESETS / SNAPSHOTS.
The old plan described clocked sine
band modulation at 10% gain, but explicitly left hold/toggle/timing undecided;
it never became a DSP path. Mapping it to LFO/Envelope/Clock Mod would invent
that contract. Old `modulated` arrays are ignored by existing explicit restore
paths; no MOD state or special case is added to the assignment core.

## Combined production workspace

PRESETS / SNAPSHOTS owns the four-source macro editor on the left and existing
preset/snapshot/Morph controls on the right. MOD is an empty UI workspace.
The navigation/workspace seam omits only the workspace left border; the internal
divider uses the existing panel border token. Old eight-macro data normalizes to
the first four sources without remapping; product schema/storage stay version 1.
