# Current runtime architecture

Reference baseline: `279e7db` after P1-A; the working implementation adds P1-C
Input Character oversampling and legacy cleanup. This map describes behavior and does not supersede
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
| `input-preamp-processor.js` | Production Character curves, adaptive 1x/2x/4x FIR differential path, aligned stage handover and 192-sample delay; linear input gain is owned by the GainNode |
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

The obsolete MOD placeholder is removed. The old plan described clocked sine
band modulation at 10% gain, but explicitly left hold/toggle/timing undecided;
it never became a DSP path. Mapping it to LFO/Envelope/Clock Mod would invent
that contract. Old `modulated` arrays are ignored by existing explicit restore
paths; no MOD state or special case is added to the assignment core.
