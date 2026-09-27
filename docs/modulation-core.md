# Modulation Core and LFO V1

## Base and effective values

UI controls and saved state hold base values. The audio worklet computes an
effective value from the base and the active assignments. It never writes a
modulated value back into filter, band, or Dynamic EQ base state. When a source
is off or a target is inactive, the modulation contribution is zero and the
effective value returns to the base through the parameter's existing smoothing.

## Sources, assignments, and targets

Sources publish normalized bipolar (`-1..1`) or unipolar (`0..1`) samples under
stable IDs. V1 publishes `lfo.1`. An assignment connects `sourceId` to a
registered semantic `targetId` with an amount from `0..100%`. The core stores
multiple assignments per source and sums them per target; V1 exposes one target
selector for the LFO.

The registry currently contains:

- `global.resonance`
- `filter.frequencyHz`, `filter.resonance`, `filter.depth`, `filter.gainDb`,
  `filter.tiltDb`, and `filter.formantVowel`
- `filterbank.band.0.gainDb` through `filterbank.band.9.gainDb`
- `dynamicEq.thresholdDb`, `dynamicEq.rangeDb`, and `dynamicEq.strength`

Descriptors define units, ranges, mapping, applicability, and how effective
values reach DSP. Filter frequency maps logarithmically. Gain and other numeric
targets map linearly in their native dB or normalized domains. Formant vowel
uses its continuous `A..U` value. Filterbank band ranges follow the current
boost and cut limits. Assignments remain stored while their filter type or
module is inactive; they are never redirected to another target.

## LFO V1

The LFO supports sine, triangle, saw up, saw down, square, and seeded sample and
hold waveforms. Rate is free running from `0.01..20 Hz` with a logarithmic
control. Polarity remaps the same bipolar waveform to bipolar or unipolar
source values. Amount belongs to the assignment. Phase is a waveform offset;
the running phase accumulator starts at zero after power-on or reset. Changing
rate or waveform preserves the running phase.

## Audio and UI threads

The LFO phase and sample are advanced in the AudioWorklet once per audio sample.
Targets are reevaluated every 32 samples (about 1.5 kHz at 48 kHz); target DSP
paths retain their existing smoothing. FILTER's pure shape math is shared by
main thread and worklet so the worklet can calculate effective filter shapes
without UI timers or base-state updates. The UI sends configuration only and
uses throttled worklet telemetry for the phase display. Its animation frames
never drive audio parameters.

## Future sources

Envelope followers, clock modulation, macros, and MIDI can publish samples
through the same source API and create assignments through the same core.
V1 does not add those source engines, clock sync, or multi-target UI.
