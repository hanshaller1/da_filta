# Modulation Core and LFO V1.5

## Sources, assignments, and base/effective values

The existing `Source → Assignment → Target` core remains the modulation path.
Four independent LFO sources are active in the product: `lfo.1` through
`lfo.4`. The state factory is count based and normalizes source IDs from their
array index, so increasing the count does not require per-LFO fields or changes
to the core. Old flat single-LFO snapshots migrate to `lfo.1`; the previous
enable value initializes both module power and source 1. Added sources default
off.

Each source owns enable, waveform, free/sync mode, free rate, sync division,
polarity, phase offset, amount, target, channel, invert, and random seed. Runtime
phase and random state belong to its independent audio-thread oscillator. The
module power switch gates every LFO contribution while preserving each source's
configuration. Slot selection only changes which source the editor displays.

Base values remain the values stored by controls and snapshots. The worklet
evaluates assignments into temporary effective values and never writes them
back into filter, band, Dynamic EQ, spread, dry/wet, or feedback base state.
Multiple LFOs assigned to one target sum in a stable assignment order and clamp
to that target's current range. Assignments remain present when their target is
inactive; they are not redirected.

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

Assignments support BOTH, LEFT, and RIGHT when a target has channel routing.
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

The editor shows four slots at a time with page size four. It creates the
required number of slots from the state array and adds page navigation only
when there are more than four, so 20 sources form five pages without CSS tied
to source IDs. Only the selected source has a waveform graph. The graph is
approximately 110–145 px high; other slots show a compact state, waveform, and
target summary.

## Erica reference and da_filta scope

The Erica Synths Resonant Filterbank Desktop is a functional reference whose
public description includes 20 LFOs, 20 envelope followers, multiple waveform
families, clock sync, stereo routing, and invert. This is not a claim that
undocumented Erica behavior was reproduced one to one.

da_filta V1.5 ships four LFOs on a count-based path scalable to at least 20,
with its own Filter, Filterbank, and Dynamic EQ targets and the existing
modulation core. Clock Mod remains a future workspace.

## Envelope follower V1

The first envelope source is `envelope.1`. State is count based in
`envelopeSources`, with normalized source IDs, so later sources can use the
same Source → Assignment → Target route. Source enable, PEAK/RMS mode, attack,
release, sensitivity, amount, target, channel, and invert are regular app
state and travel through the same state snapshots as the LFO settings.

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

Envelope amount uses the same normalized target mapping as LFO amount. Invert
is applied once by the modulation assignment. All sources targeting the same
parameter are summed by `ModulationCore` and then clamped by that target's
existing descriptor. LEFT and RIGHT route to one channel. SPREAD applies a
positive contribution to the left channel and its negative to the right;
these channel modes are available only for stereo-routable band-gain targets.
Global, filter, and Dynamic EQ targets come from the existing registry, with
their normal active-state and range rules.

The source graph displays Worklet telemetry at about 30 Hz; it does not run a
detector or alter modulation on the main thread. The UI uses the existing LFO
workspace split, waveform styles, target and slider controls, shared toggle
buttons, spacing, colors, and responsive single-column breakpoint.
