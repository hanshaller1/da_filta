# Modulation Core and LFO assignments

## Sources, assignments, and base/effective values

The path is `Source → Assignments → Target Registry → Mapping → Effective → DSP`.
Exactly four independent LFO sources exist: `lfo.1` through `lfo.4`.
Each source can own any number of independently editable assignments, including
several routes to the same target. There is no small row limit and no LFO 5–20.
Old flat single-LFO snapshots migrate to `lfo.1`; the previous enable value
initializes both module power and source 1. The other sources default off.

Each source owns enable, waveform, free/sync mode, free rate, sync division,
polarity, phase offset, source invert, and random seed. Each assignment owns
`id`, `sourceId`, `targetId`, `amount`, `channel`, `invert`, and `enabled`.
Runtime
phase and random state belong to its independent audio-thread oscillator. The
module power switch gates every LFO contribution while preserving each source's
configuration. Slot selection only changes which source the editor displays.
The compact editor lists target, amount, channel, invert, ON/OFF and remove per
row. New rows start with no target and amount zero. Removing the final row keeps
an empty array; legacy aliases cannot recreate a deleted route.

Legacy source-level target/amount/channel migrate to one stable assignment. The
old LFO invert remains at the oscillator, so its migrated assignment invert is
false. New assignment invert negates only that route's final source sample;
source invert and assignment invert are independent. Read aliases mirror the
first assignment for old API consumers. Assignment arrays are authoritative.
IDs, unknown targets and empty arrays round-trip through existing version-1
DEV/LAB snapshots; there is no new snapshot schema.

Base values remain the values stored by controls and snapshots. The worklet
evaluates assignments into temporary effective values and never writes them
back into filter, band, Dynamic EQ, spread, dry/wet, or feedback base state.
Contributions from LFOs and Envelope Followers sum deterministically, then clamp
to the target's current range. Frequency contributions add in logarithmic
coordinates; dB and normalized parameters use their registry ranges. Band-gain
contributions join the existing dedicated Clock Mod, FILTER and global spread
layers before the final band-gain clamp. No intermediate per-route clamp loses
opposing contributions. Disabling/removing all contributions restores the base.

Assignment normalization and compilation happen on configuration updates,
outside sample processing. The compiled target links hold mutable source
references and aggregate coefficients per source/channel. Runtime cost depends
on sources and targets, not duplicate editor rows; evaluation creates no arrays,
objects or target-ID strings and does not scan the assignment list. The existing
32-sample control interval and audio-thread smoothing remain unchanged.

## Registered targets

The current registry contains 27 continuous targets:

- **GLOBAL:** `global.resonance`, `global.dryWet`, `global.spread`
- **FILTER:** frequency, resonance, depth, slope, bandwidth, gain, tilt, and
  formant vowel
- **FILTERBANK:** `filterbank.band.0.gainDb` through
  `filterbank.band.9.gainDb`, plus `filterbank.feedbackAllAmount`
- **DYNAMIC EQ:** threshold, range, strength, attack, and release

Filter slope is active for low-pass, high-pass, band-pass, and notch. Bandwidth
is active for band-pass and notch. Dynamic EQ attack and release use the
existing time parameters. Target activity follows powered modules and active
filter type, while stored assignments stay attached to their original target.
Frequency is unavailable in Formant/Vowel mode. Registry `channels` capability
lists drive the editor: mono targets allow BOTH; stereo band gains allow BOTH,
LEFT, RIGHT and SPREAD. SPREAD adds the contribution to L and subtracts it from
R; assignment invert reverses both signs. No new band-spread target IDs exist.

Availability/status is derived centrally, independently from persistence:
`active`, `source-disabled`, `assignment-disabled`, `target-unavailable`,
`target-invalid`, or `no-target`. Unknown/removed IDs remain invalid and saved.
An unavailable assignment contributes zero and automatically reactivates with
the same ID and settings when its target returns (LP → Formant → LP, for
example). A compact row status and slot warning show any unavailable/invalid
route, even when another source is selected. Source OFF alone is not a lost
target warning.

Dry/wet uses its existing 0–100% linear base control. The filterbank worklet
publishes a smoothed mono gain-delta signal on its second output; the existing
dry and wet GainNode AudioParams add that signal and its inverse to their base
gains. This keeps parameter modulation on the audio graph and leaves the base
control unchanged.

Spread uses an effective dB delta around the current base. The worklet applies
opposite temporary offsets to left and right band gains without materializing
them into the band controls. The target is inactive while per-channel/P/CH
selection or `FB_CH_SELECT` routing is active, preserving that routing's
priority.

Per-band feedback selection is Boolean, so no per-band feedback modulation
targets are registered. `filterbank.feedbackAllAmount` is registered because it
already exists as a continuous 0–100% parameter and does not change feedback
topology. Boolean feedback ON/OFF switches are never toggled by an LFO.

## Waveforms, polarity, and invert

Available waveforms are sine, triangle, saw up, saw down, square, pulse, random
sample and hold, and smooth noise. Square is 50% duty. Pulse is fixed at 25%,
with no pulse-width control. Sample and hold draws one seeded deterministic
value per LFO cycle and holds it until the next cycle. Each LFO has a separate
random stream. Noise interpolates smoothly between seeded random values with a
smoothstep curve; its oscillator rate controls the correlation time, avoiding
audio-rate white noise on parameters.

Bipolar sources produce −1…+1. Unipolar maps the same waveform to 0…1.
Invert multiplies the resulting modulation sample by −1; it does not alter the
oscillator phase. Thus inverted unipolar samples may be negative by design.

## Stereo routing

Assignments support BOTH, LEFT, RIGHT and SPREAD when a target has channel routing.
Filterbank band-gain targets are channel-aware: BOTH evaluates against both
channel bases, while LEFT or RIGHT updates only that channel's temporary
effective offset. Global targets, including resonance, dry/wet, spread, and FB
All Amount, remain global and route as BOTH. A channel-specific band assignment
does not change either stored base channel value.

## Clock and sync

All sync LFOs use one reusable `ClockCore`; each source has its own note
division. Internal clock runs from audio sample time at 30–300 BPM (default
120). Divisions are 1/32, 1/16, 1/8, 1/4, 1/2, 1/1, 2/1, and 4/1. Free mode
retains the 0.01–20 Hz logarithmic rate control.

MIDI clock uses Web MIDI when available. Timing Clock (`0xF8`) is measured at
24 PPQN; Start (`0xFA`) resets and starts sync phase, Continue (`0xFB`) resumes,
and Stop (`0xFC`) freezes synchronized LFOs. Free LFOs continue through MIDI
Stop. If MIDI access is unavailable or clock pulses disappear, the UI reports
that state and sync sources stop; free sources and internal clock remain
available. Oscillator phase advances only from AudioWorklet samples and the
shared clock position, never from requestAnimationFrame or DOM timers.

## Worklet and compact editor

All configured sources run in the filterbank AudioWorklet. The common target
evaluation interval remains every 32 samples (about 1.5 kHz at 48 kHz), and the
existing roughly 4 ms parameter smoothing remains in place. Source waveforms
are cheap per-sample calculations; target descriptors are evaluated together
at the existing control rate. Waveform shape, phase, polarity, and invert are
display-only; UI animation does not drive modulation.

The editor shows the four source slots. Additional rows extend a source's
assignment list rather than adding source pages. Only the selected source has
a waveform graph. The graph is
approximately 110–145 px high; other slots show a compact state, waveform, and
target summary.

## Erica reference and da_filta scope

The Erica Synths Resonant Filterbank Desktop is a functional reference whose
public description includes 20 LFOs, 20 envelope followers, multiple waveform
families, clock sync, stereo routing, and invert. This is not a claim that
undocumented Erica behavior was reproduced one to one.

da_filta ships four LFOs with multiple assignments and the existing FILTER,
Filterbank and Dynamic EQ targets. Cross-modulation, source-parameter targets,
cycle handling and V2 UI remain future work. Clock Mod keeps its dedicated
workspace and held band layer; it is not rebuilt as a registry source.

## Envelope follower V1

The four envelope sources are `envelope.1` through `envelope.4`. State is
stored independently in `envelopeSources`; legacy states with only
`envelope.1` are padded with defaults for the other sources. Each source uses
the same Source → Assignment → Target route. Source enable, PEAK/RMS mode,
attack, release, delay, sensitivity, threshold, amount, target, channel, and
invert are regular app state and travel through the same state snapshots as
the LFO settings.

The detector reads the existing stereo filterbank AudioWorklet input. The
audio-engine connects the Input Preamp output directly to that input, before
the filterbank, feedback processing, and filterbank modulation. PEAK detects
the largest absolute channel sample. RMS detects the stereo root mean square.
Both are unipolar and clamp the sensitivity-scaled signal to 0…1. Attack
(1…500 ms) and release (10…3000 ms) use sample-rate exponential smoothing in
the Worklet. Sensitivity is a 0…400% linear gain with 100% neutral. The
detector continues to run only while its source is enabled; disabling the
source removes its modulation contribution without changing assignments or
base values.

Envelope threshold semantics: the detector output is multiplied by sensitivity
first, clamped to 0..1, then compared with the threshold amplitude
`10^(thresholdDb/20)`. This retains the existing 0..400% sensitivity gain
semantics. Below threshold the smoothed target is zero and the envelope falls
through its configured release; above threshold the sensitivity-scaled detector
level passes to attack/release smoothing. The order is input -> PEAK/RMS
detector -> sensitivity -> threshold -> attack/release. The graph plots that
sensitivity-scaled raw detector and the smoothed envelope from Worklet
telemetry. Its dashed threshold guide uses the same dB-to-amplitude conversion
as the detector comparison. Module power and source enable are separate gates
and neither changes source settings, assignments, or base values.

Envelope amount uses the same normalized target mapping as LFO amount. Invert
is applied once by the modulation assignment. All sources targeting the same
parameter are summed by `ModulationCore` and then clamped by that target's
existing descriptor. LEFT and RIGHT route to one channel. SPREAD applies a
positive contribution to the left channel and its negative to the right;
these channel modes are available only for stereo-routable band-gain targets.
Global, filter, and Dynamic EQ targets come from the existing registry, with
their normal active-state and range rules.

Delay (0..2000 ms, default 0) starts once when the sensitivity-scaled detector
crosses threshold. If the signal falls below threshold while waiting, the
pending trigger is cancelled. Sustained signal starts attack after the delay;
during a retrigger delay, an existing envelope continues its release. Zero
delay preserves the prior immediate-threshold behavior. Every follower owns
its own delay counter and detector state.

The source graph displays selected-source Worklet telemetry at about 30 Hz; it does not run a
detector or alter modulation on the main thread. The UI uses the existing LFO
workspace split, waveform styles, target and slider controls, shared toggle
buttons, spacing, colors, and responsive single-column breakpoint.
