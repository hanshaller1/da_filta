# Productive Input Character – P1-C

Implemented on `feature/p1c-dsp-cleanup`, based on P1-A `279e7db` (2026-10-02).
The app loads `input-preamp-processor.js` through AudioEngine; the former
P3B.4/P3B.5 controller is now integrated into that audible Worklet. Historical
test controllers remain comparison fixtures, never runtime dependencies.

## Rate and signal contract

| Stage | 44.1 / 48 kHz | 96 kHz |
| --- | --- | --- |
| LINEAR | 1x | 1x |
| SILK, TAPE, TUBE, CONSOLE, CRUNCH | 2x | 1x |
| DESTROY | 4x | 2x |

The matrix is fixed at context construction, matching the measured adaptive
candidate. Other host rates retain the original 2x/4x matrix; the explicit
measurement coverage is 44.1/48/96 kHz. There is no quality selector or dynamic
level-dependent rate switch. All drive curves, clamps, bias, Amount mapping and
GainNode ownership are unchanged.

The existing 257-tap Kaiser FIR (beta 8.6, cutoff 0.2375 of the higher rate) is
used with two polyphases for interpolation and filtering before decimation.
4x cascades the same two 2x stages. Historical measured rejection is at least
87.67 dB, ripple 0.000631 dB; the coefficients and filter geometry are preserved.

```text
highDry = upsample(input, factor)
correction = downsample(shape(highDry) - highDry, factor)
output = delay(input, 192) + smoothedAmount * delay(correction, padding)
```

Padding is 192 / 64 / 0 host samples at 1x / 2x / 4x. Every stage, LINEAR and
Amount 0 therefore has exactly 192 host samples of latency: 4.3537 / 4 / 2 ms at
44.1 / 48 / 96 kHz. The Character node precedes both global dry/wet branches;
neither stereo channel nor the Amount-zero route receives a different delay.
LINEAR/Amount 0 reproduces the original Float32 samples after that delay,
including the initial 192 zeros. As in the prepared C architecture, Amount 1
is a filtered nonlinear correction plus unfiltered delayed dry, rather than a
separately filtered full-wet signal. No compensation curve was added.
Global BYPASS retains the app's explicit direct sourceBus-to-output contract.

## State, transitions and realtime

All FIR rings, channel blocks, correction/dry padding, branch states and reset
lists are preallocated. Stage names become numeric branch indices on messages;
there are no new buffers, object returns, closures or assignment searches in
rendering. Only active and warming/fading target corrections run. LINEAR has no
correction FIR or nonlinear branch; its background TUBE state is deliberately
maintained for safe later entry, as specified by the prepared architecture.
At 96 kHz the shared DESTROY upsampler is idle outside its active/target branch;
the complete finite history is recovered during target warmup.

Stage requests are accepted at the next block, reset only the target's own
finite histories, process 384 host samples while the old branch remains audible,
then apply the existing 15-ms exponential linear fade (completion >0.9999).
Further requests coalesce to the latest target after the current fade.
Host Amount smoothing remains 15 ms. Source silence still advances state.

One stereo TUBE instance runs continuously at 88.2 / 96 / 96 kHz. Its pole is
`pow(0.9987, 48000 / internalRate)`; the analog 9.937729-Hz corner is preserved.
Panic does not reset Character or TUBE histories. A context/rate restart creates
new correctly rated histories. AudioEngine keeps master and bypass gains muted
through 250 ms of startup processing, then ramps the selected output over 10 ms.
Volume/bypass changes during that interval respect the mute. UI timers do not
calculate Character samples or modulation.
Source buttons and the input selector are disabled during STARTING, then enabled
on ON/OFF/ERROR, so the visible selection cannot diverge from the starting graph.

## Validation and measured limits

Before implementation the unchanged production audit, preamp, TUBE and UI
handoff tests passed. Afterwards 63 real stereo OfflineAudioContext combinations
(all stages, rates, Amount 0/50/100%, unequal channels and a high-level impulse)
match the prepared optimized controller with maximum sample difference **0**.
Additional paired streaming tests cover aligned fades, continuous TUBE state,
determinism, silence and preallocated storage. The rate-correct TUBE response
keeps its original 0.00002 absolute tolerance against the internal-rate formula.

Measured 48-kHz 10-kHz sine, peak 0.8, Amount 100%; identifiably folded
alias/fundamental amplitude ratios, aligned steady-state windows:

| Stage | Old 1x | Productive adaptive |
| --- | ---: | ---: |
| SILK | 1.211158% | 0.0000147% |
| TAPE | 7.055443% | 0.021911% |
| TUBE | 6.508290% | 0.015068% |
| CONSOLE | 5.401074% | 0.206457% |
| CRUNCH | 2.394045% | 0.859903% |
| DESTROY | 20.494911% | 0.152492% |

Low/high-level spectral, RMS, peak, DC and finite checks cover all three rates.
The 96-kHz five-stage 1x path intentionally preserves the adaptive candidate's
96-kHz internal rate; the extra 24–48-kHz output band is not filtered away.
Extreme DESTROY aliasing remains the documented effect compromise. These data
are source-specific measurements, not an assertion of universally alias-free DSP.

Native Chromium traces measure the actual AudioEngine's separate Worklets,
sample-source gate, enabled ten-band CURRENT feedback, Dynamic EQ, guard/safety,
MediaStream output and four live analyzer taps. Startup maxima and separate
transition windows are reported. All tested live cases are finite, deliver
telemetry and show no processor error. Short 96-kHz traces still contain callback
budget outliers; an equally configured frozen 1x baseline also reproduces them.
Thus no oversampling-specific blocker was established by this comparison, and
the existing repeated 96-kHz performance investigation stays P2. These short,
instrumented traces do not establish the former 30% comfort-margin goal or
guarantee device underrun-free operation. No filterbank or protection DSP was
changed to improve the timing report.

Reproduce with `tests/input-preamp.spec.js`; its last test writes the installed
graph trace summary under ignored test output. For the focused six-case 96-kHz
comparison set `P1C_INPUT_PROFILE=baseline` (frozen 1x) or `production` (current).
Historical 1x architecture tests load the byte-identical frozen
`tests/helpers/input-character-legacy-processor.js` so their measured baseline
and stored hash remain reproducible after the production integration.

Final validation (2026-10-02): Node 60/60, distinct focused browser cases 51/51,
Smoke 10/10, Standard Browser 241/241 (0 unexpected, skipped or flaky cases).
The 22 installed-graph cases at 48/96 kHz are finite with no processor error.
The 14 existing quarantine cases and their tags remain unchanged and were not
executed; the combined profile including quarantine was not run.
