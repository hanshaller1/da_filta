# Current runtime architecture

Reference baseline: `e525331`; the working implementation adds P1-A modulation
assignments. This map describes behavior; it does not change DSP or supersede
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
| `app.js`, `index.html`, `styles.css` | Controllers, workspace visibility, UI-only graphs, themes, MIDI setup, keyboard and DEV/LAB snapshots |
| `state.js` | Base configuration, normalization and compatibility; not a second DSP engine |
| `audio-engine.js` | Web Audio graph, source selection, transport forwarding and worklet messages |
| `filterbank.js` | Filterbank wrapper, control updates and shared band definitions |
| `filterbank-processor.js` | Ten-band stereo processing, feedback/resonance, FILTER, Dynamic EQ and modulation application |
| `filter-shape-core.mjs`, `filter-shape.js` | Shared FILTER shape/math; browser compatibility facade |
| `dynamic-eq-core.mjs` | ABS/REL, LINKED/DUAL detection and gain smoothing helpers; source-only detection before feedback/gain |
| `modulation-core.mjs` | Stable target registry and assignments; contributions affect effective values while preserving bases |
| `lfo-core.mjs` | Four configured LFO sources, waveform/phase and assignment state |
| `envelope-core.mjs` | Four independent Peak/RMS Envelope sources with threshold, delay and attack/release |
| `clock-core.mjs` | Shared audio-sample clock and MIDI 24-PPQN transport/phase |
| `clock-mod-core.mjs` | Dedicated held per-band additive layer; borrows LFO waveform code, uses independent step timing, is not a registry target/source |
| `midi-device-manager.mjs` | Access, discovery, one selected input/listener and hotplug handling; UI requests access through ENABLE MIDI |
| `input-preamp-processor.js` | Production input character/gain behavior; test oversampling controllers are not loaded by the application |
| `output-guard-processor.js` | Independent gain-reduction guard before final soft protection |
| `output-protection-processor.js` | Final bounded soft-protection transfer |

Worklet runtime phase, detector history and Clock Mod held values remain runtime
data. Stored base fields and IDs are compatibility contracts. Telemetry is
rate-limited (typically 15 Hz) and may miss short audio transitions; a diagnostics
packet is not a replacement for rendered-sample assertions.

Modulation follows `Source → Assignments → Target Registry → Mapping → Effective
→ DSP`. Four LFOs own stable assignment lists; the shared core compiles routes
per target/source/channel on state updates. Runtime sums contributions without
changing stored bases. Registry capabilities and availability drive both UI and
DSP. Unavailable/invalid routes persist and valid targets automatically
reactivate them. Clock Mod remains its dedicated additive band layer and joins
other contributions before the existing final band-gain clamp. See
[`modulation-core.md`](modulation-core.md) for migration and channel contracts.

`tests/helpers/input-character-architecture*.cjs` and related measurement bundles
are experiments, including frozen comparison variants. They are deliberately
separate from production, even when a historical filename says "production".
