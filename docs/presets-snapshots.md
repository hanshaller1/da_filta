# Product presets, snapshots and morph

Schema version: **1**. `presets-core.mjs` projects the existing production base
state, uses the existing state/source normalizers, and applies it through
`AudioEngine.applyPresetState`. It does not own another application state or DSP
engine. Merely initializing this workspace reads defaults/storage; it never
recalls a sound or starts audio.

## Product state contract

`capturePresetState`, `normalizePresetState`, `clonePresetState` and
`applyPresetState` share one explicit projection. INIT is read-only and comes
from `ResonantState.createInitialState()` plus the existing AudioEngine's actual
startup defaults, not a separately maintained preset-default table.

| Included production bases/configuration | Details |
| --- | --- |
| FILTERBANK | Enable; ten L/R band controls; P/CH and per-band channel links; L/R LOCAL feedback gates; L/R FB ALL gates; signed resonance; concrete spread dB; dry/wet; FB ALL amount |
| FILTER | Enable, type, frequency, resonance, depth, slope, bandwidth; all current Bell, Shelf, Tilt, Formant and Baxandall bases, including their independent frequencies/gains |
| Dynamic EQ | Enable, mode, thresholds/window, ranges, strength, attack/release, detector/reference/stereo modes, ten sensitivities; learned reference calibration, validity and FREEZE |
| Input | Input Gain dB, Character stage and amount |
| LFO | Module enable, four source IDs and configuration: waveform, FREE/SYNC, free rate, division, polarity, phase **base**, output amount, invert, configured seed and assignments |
| Envelope | Module enable, four source IDs; enable, Peak/RMS, attack/release/delay, sensitivity, threshold, output amount and assignments |
| Clock / Clock Mod | Shared clock source and configured BPM; Clock Mod's existing productive configuration, configured seeds, band locks and assignments |
| Macros | `macro.1`…`macro.8`: all eight manual values and assignments |

Input Gain is included because its existing GainNode is before Input Character
and the dry/wet split: it changes drive and sound, rather than acting as device
calibration. The learned Dynamic EQ profile is persistent REL calibration,
not detector history. Explicit preset recall can restore a different frozen
profile; ordinary FREEZE still preserves its existing live reference.

Assignments keep their existing stable ID, source, target, amount, channel,
invert and enable contract. Unknown/unavailable targets remain stored and the
shared registry provides Lost Target status and automatic reactivation.

Explicitly excluded:

- Master listening volume, bypass/session playback, Output Guard and Final
  Safety enable/settings. Recall never changes these settings or bypasses nodes.
- Device IDs, input/output or sample selection, MIDI device/mapping state,
  keyboard preferences, theme, analyzer/display options, current workspace,
  selected editor slots, graphs, debug console and DEV/LAB UI state.
- DEV/LAB architecture choices and calibration/range controls: feedback cores,
  topology, tuning, taps, wet model, drive/ceiling/return variants, band gain
  limits, spread limit and legacy spread metadata. They retain session authority.
- Audio running/stopped/error, clock transport and MIDI timing runtime;
  oscillator phase/random generator state, detector/RMS/delay histories,
  Clock Mod holds, integrators, solver histories, telemetry and prepared caches.

Band values keep the existing normalized control representation. Recall uses
the retained session's gain/spread limits and existing setters. Thus changing
DEV/LAB ranges or cores between capture and recall can change the audible
interpretation or clamp values; product presets deliberately do not restore
those experiments. Normal production defaults and unchanged session limits
provide exact base-state endpoints. Spread storage accepts the existing
supported ±12 dB envelope; the active session spread limit remains authoritative.

Missing fields use product defaults. Unknown extra fields are discarded,
nonfinite/wrong numeric types are sanitized, arrays have ten bands/four
LFOs/four Envelopes/eight macros, and assignments pass through the existing
normalizers. Runtime fields cannot enter the projection.

## Library, storage and files

The library stores `{id, name, version, state}` user entries separately from the
built-in FACTORY / INIT option. Selection is silent; LOAD explicitly recalls.
SAVE AS captures current bases. UPDATE and DELETE require inline CONFIRM, with
CANCEL/Escape available. RENAME and DUPLICATE use the NAME field. Names are
trimmed, nonempty, at most 64 characters and unique; an existing name never
silently overwrites a preset. INIT cannot be updated, renamed or deleted.

`da-filta-presets-v1` stores the versioned user-library document. Single export:

```json
{
  "format": "da_filta-preset",
  "version": 1,
  "name": "My sound",
  "state": {}
}
```

`state` above stands for the complete normalized projection. Library export
uses `format: "da_filta-preset-library"`, `version: 1`, and a `presets` array of
single-preset documents with stable IDs. Only user entries are in the library;
INIT can also be exported individually.

IMPORT parses JSON, verifies format/version/name/state and normalizes **all**
entries before adding any. Invalid/future formats leave the existing library
untouched. Conflicting names receive ` (2)`, ` (3)`, etc.; conflicting IDs receive
new IDs. Loading conflicting stored entries uses the same safe resolution.
Neither import nor list selection automatically recalls audio.

Storage read, quota and security failures are caught and shown in the workspace.
In-memory presets/snapshots remain usable, with an explicit warning when they
could not persist. No backend, cloud or IndexedDB is introduced.

## Snapshot A/B and morph

Each independent slot offers CAPTURE and RECALL. Both use exactly the same
product state projection as presets. `da-filta-snapshots-v1` contains
`{format: "da_filta-snapshots", version: 1, slots: {A, B}}`; empty slots are null.
Reload retains both slots. Capturing snapshots does not modify user presets;
loading/deleting/importing presets does not modify snapshots.

MORPH is disabled until both endpoints exist. Stored endpoints are deep clones
and recursively frozen. Every event computes
`interpolatePresetState(snapshotA, snapshotB, percent)` anew. It never blends
from the current state. At 0 and 100 the normalized A/B state is copied exactly,
avoiding endpoint roundoff and cumulative drift.

The interpolation contract is explicit, not recursive JSON lerp:

| Semantic family | Interpolation |
| --- | --- |
| Percentages, gains/dB, signed resonance, dry/wet, spread, depth, strength, Macro Value, LFO phase base/output, Envelope output/sensitivity/threshold, tempo | Linear |
| Band gain | Convert current normalized controls to dB with existing helpers; interpolate dB; convert back using retained session cut/boost limits |
| FILTER frequencies, LFO free rate, Envelope attack/release/delay, Dynamic EQ attack/release, Clock Mod oscillator frequency | Logarithmic for positive endpoints: `exp(log(A) + t * (log(B) - log(A)))` |
| Time parameters permitting zero, currently Envelope delay | Linear fallback if either endpoint is zero |
| Enable, FILTER type, waveform, FREE/SYNC, clock source/division, polarity/invert, Peak/RMS, mode, channel links, feedback gates, locks/seeds and assignment structure | A for `<50%`; B for `>=50%` |

The existing Formant vowel base is a continuous vowel-position control and
interpolates linearly. Configured seeds switch discretely; runtime random state
is never serialized or interpolated.

An assignment amount interpolates only when ID, source, target, channel, invert
and enabled fields all match at both endpoints. Other rows/topologies follow
the midpoint rule. No partial target or source is invented.

Morph edits **BASE**. LFO, Envelope, Clock Mod and macros remain in the shared
`Source → Assignment → Registry → Mapping → Effective → DSP` path above it.
There is no Morph source/target, new cycle graph or modulation engine.

## Runtime and verification

Recall uses existing productive setters and a batched modulation update; it
keeps the AudioContext, source, Worklets, output devices and safety nodes.
Discrete changes use the existing structural path. Stable configuration uses
`set-modulation-base-values`: assignment coefficient updates retain prepared
links, graph and source/target handles. Duplicate rows still aggregate normally;
disabled/lost/cycle-blocked routes keep their existing semantics.

Existing LFO/Envelope/Clock configuration updates preserve their runtime
continuity where their existing parameter contract permits it. For example,
Envelope delay changes retain the existing delay-reset behavior. Existing
target/DSP smoothing and stage handover remain authoritative.

There is no storage/file operation during Morph, audio node recreation or
hidden assignment/slot DOM reconstruction on each slider event. Hidden source
editors render the updated base state when opened. Configuration messages may
allocate outside the DSP loop; sample processing and the existing 32-sample
control tick gain no new loops, scans or allocations.

Coverage includes product/excluded state, read-only INIT, library CRUD/reload,
single/library files and conflicts, malformed/forward inputs, blocked storage,
snapshot persistence, exact endpoints/nonmonotonic drift, semantic values,
assignment topology, additive modulation and frozen reference recall.
Responsive checks cover 1914/1440/1024/560 px, full 64-character names,
nonoverlapping snapshots/Morph and native keyboard controls.

The focused live test moves Morph 120 times over several seconds with four
LFOs, four Envelopes, Clock Mod, eight macros, FILTER, Dynamic EQ and LOCAL/MAIN.
It verifies unchanged nodes/safety, zero Processor Errors/storage writes/editor
mutations, and four structural updates for four midpoint crossings. Native
Chromium traces measure 128-frame full-graph Render callbacks at 48/96 kHz,
excluding the first 250 ms of each window. A representative focused run measured
48-kHz Morph p99 1.034 ms (budget 2.667 ms, no warm exceedances). The 96-kHz
measurements vary with host load; one optimized run measured p99 1.272 ms
(budget 1.333 ms), with 19 of 2572 warm callbacks exceeding budget. This remains
a release-hardening performance watch item, not a general real-time guarantee.
Startup spikes are recorded separately and covered by the existing muted start.
The two-worker standard run measured 96-kHz Morph p99 1.598 ms and 207/2816
warm exceedances while other DSP cases ran concurrently; timing reports must
be interpreted with their host-load context rather than as a pass/fail budget.

Without preset actions, production-bank output with all modulation families,
FILTER, Dynamic EQ and LOCAL/MAIN is sample-identical to accepted base
`4c9bf80` at 48/96 kHz. Resonator math/defaults, guard and safety DSP are unchanged.
MIDI, V2 features and a release/version change are outside this implementation.

Two existing UI assertions change with the explicit product contract: no main
placeholder remains, and the old global absence of file inputs now permits
exactly the hidden JSON preset importer. The audio-source test still requires
zero other file inputs and unchanged device/integrated-sample behavior. No
numeric DSP assertion, tolerance or quarantine tag is relaxed.
