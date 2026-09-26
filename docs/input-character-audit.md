# INPUT CHARACTER DSP Audit (P3B)

Audit date: 2026-09-26. Production DSP was not changed. Measurements use the actual `input-preamp-processor.js` AudioWorklet with an `OfflineAudioContext`; the isolated runner is `tests/input-character-audit.spec.js`.

## Signal path and implementation

Production routing is `sourceBus → inputGainNode → inputPreampNode → dry/filterbank branches`. `inputGainNode.gain = 10^(dB/20)` is the sole input gain. The worklet's `inputGainDb` is metadata only. It receives the already amplified samples, computes `sample + amount × (shape(sample) − sample)`, and does no internal makeup gain or normalization. Amount and gain metadata are smoothed with `exp(-1/(sampleRate × 0.015))`; stage changes crossfade with the same coefficient. At settled Amount 0 the result is the input sample; LINEAR's shape returns the input at every Amount.

| Stage | Production mapping after clamp to [-12, 12] | Memory / filtering |
|---|---|---|
| LINEAR | Identity | None |
| SILK | `x / sqrt(1 + 0.16 x²)` | None |
| TAPE | `atan(1.45 x) / 1.45` | None |
| TUBE | `(tanh(1.3(x+0.18)) − tanh(1.3×0.18))/1.3` | Per-channel previous input/output; DC blocker `y[n]=x[n]−x[n−1]+0.9987y[n−1]` |
| CONSOLE | `x / (1 + 0.48 abs(x))` | None |
| CRUNCH | Linear through `abs(x)≤0.48`, then signed exponential shoulder `sign(x)(0.48 + 0.52(1−exp(−3.3(abs(x)−0.48)))` | None |
| DESTROY | `0.58×clamp(x,−0.62,0.62) + 0.3444×sin(2.85x)` | None |

Only TUBE has state or a filter. No stage uses oversampling, pre/post filters beyond TUBE's DC blocker, or sample-rate conversion. The six other character mappings are memoryless. The stage crossfade evaluates old and new stage mappings together; TUBE state is maintained per channel in two `Float64Array` entries.

## Measurements

The audit rendered 44.1, 48 and 96 kHz. Sinusoidal sweeps in this report mean discrete 100 Hz, 1 kHz, 5 kHz and 10 kHz tones at source amplitudes 0.03, 0.25 and 0.8; harmonic projections cover orders 2–24. Level runs covered Amount 0/25/50/75/100% and +0/+12/+24 dB input gain, with a 0.1-amplitude, 1 kHz tone. Transient runs used an impulse, asymmetric periodic wave and three-tone input at +24 dB. The test also switched Amount 100%→0% midway through an offset 100 Hz signal and compared identical stereo channels. The reported alias ratio is the root-sum-square of distinct folded harmonic bins not coincident with the fundamental or in-band harmonic bins, relative to the fundamental. It is a deterministic projection estimate, not a perceptual threshold or a comparison against an oversampled reference.

| Stage | Neutral @ 0% | Level change at 100% | Max THD | Max folded alias / fundamental | DC | Sample-rate dependence | Oversampling need / recommendation |
|---|---|---|---:|---:|---|---|---|
| LINEAR | Yes; max sample delta 7.5e-9 (Float32 rounding) | 1.000× | <0.00001% | <0.00001% | No generated tone DC | None measured | **NONE** — no nonlinear products |
| SILK | Yes | 0.879–0.999× RMS | 1.21% | 1.21% | No stationary sine DC | Curve is fixed; alias bins vary with Nyquist | **OPTIONAL / 2×** — small but measurable high-tone products |
| TAPE | Yes | 0.577–0.995× RMS | 7.06% | 7.06% | No stationary sine DC | Curve is fixed; alias bins vary with Nyquist | **RECOMMENDED / 2×** — soft compression produces measurable upper harmonics |
| TUBE | Yes | 0.552–0.945× RMS | 10.69% | 6.51% | Tone DC ≤5.9e-6; asymmetric signal's DC is filtered; impulse tail decays | **Yes** — DC-blocker corner moves with rate | **RECOMMENDED / 2×** — measurable nonlinear products; rate-correct the DC blocker separately |
| CONSOLE | Yes | 0.615–0.961× RMS | 5.42% | 5.42% | No stationary sine DC | Curve is fixed; alias bins vary with Nyquist | **RECOMMENDED / 2×** — measurable upper harmonics |
| CRUNCH | Yes | 0.739–1.000× RMS | 2.47% | 2.46% | No stationary sine DC | Curve is fixed; alias bins vary with Nyquist | **OPTIONAL / 2×** — modest alias level in these measurements |
| DESTROY | Yes | 0.335–1.552× RMS | 20.52% | 20.52% | No stationary sine DC | Curve is fixed; alias bins vary with Nyquist | **STRONGLY RECOMMENDED / 4×** — largest measured folded components; benefit should be confirmed by an oversampled A/B |

Maxima are over all tested tones, rates and amplitudes at Amount 100%. Harmonic THD for LINEAR is numerical residue. A result near 0% for a specific high tone does not mean no distortion: when harmonics lie above Nyquist they are reported as folded alias energy instead. For a 10 kHz, 0.8-amplitude tone at 44.1 kHz, measured folded alias/fundamental was SILK 1.21%, TAPE 7.06%, TUBE 6.51%, CONSOLE 5.42%, CRUNCH 2.43%, DESTROY 20.52%; LINEAR was below 0.00001%. At 96 kHz, more harmonics remain in band, so the corresponding folded alias values fall while THD projections rise. This is expected sampling behavior, not a change in the nonlinear curves.

At Amount 0, all stages reproduced the post-input-gain signal exactly within Float32 rounding. RMS and peak differences were zero at recorded precision; DC was below 5e-17 for the measured sinusoid. LINEAR at Amount 100 was also identity. No stage normalizes loudness. All nonlinear curves reduce RMS at some input levels, but DESTROY's small-signal slope is 1.56× at Amount 100 and its measured RMS ratio reaches 1.552×: it can act like a gain stage at low levels before clipping/shape compression dominates. Other stages remained at or below unity RMS in the tested level set.

All tested outputs remained finite. The +24 dB input gain path applied 15.85× before the character worklet. Nonlinear shapes clamp their internal input at ±12, but LINEAR passes the high sample unchanged. The transient suite did not show runaway state. With the asymmetric periodic input at +24 dB, the measured DC means were LINEAR 1.665, SILK 0.488, TAPE 0.106, TUBE 0.00018, CONSOLE 0.301, CRUNCH 0.012 and DESTROY 0.281 at 48 kHz. Those stages except TUBE have no DC blocker, so they retain bounded, signal-dependent DC from an asymmetric input; this is not accumulating state. After changing Amount 100%→0%, the final 50 ms mean stayed within 0.0036 of the input's 0.3 DC mean for every stage/rate. Identical stereo inputs produced bit-identical L/R outputs in all tested stages/rates. For the +24 dB impulse, TUBE's residual tail RMS was 1.57e-4 at 44.1 kHz, 9.46e-5 at 48 kHz and 1.84e-7 at 96 kHz; other memoryless stages had zero tail. A broader long-duration state soak was not part of this run.

## TUBE DC blocker detail

Production code implements `y[n] = x[n] − x[n−1] + a y[n−1]` with `a = 0.9987`, assigned directly per sample and not derived from `sampleRate`. The pole's effective corner is approximately `−ln(a) × Fs / (2π)`:

| Sample rate | Effective corner |
|---:|---:|
| 44.1 kHz | 9.13 Hz |
| 48 kHz | 9.94 Hz |
| 96 kHz | 19.88 Hz |

At 96 kHz the corner is 2.18× its 44.1 kHz value. This conflicts with the code comment's approximately 10 Hz intent and changes low-frequency response by sample rate. **Assessment: BUG / YES, make sample-rate-correct.** Do not change it in this audit. TUBE tone DC measured up to 5.9e-6 in the settled 1 kHz run; its 96 kHz amplitude was closest to zero in the test, consistent with the stronger per-second blocking at the doubled rate.

## Classification and recommendations

| Stage | Classification | Recommendation | Priority | Expected benefit / relative CPU cost |
|---|---|---|---|---|
| LINEAR | NO OVERSAMPLING NEEDED | NONE | — | No nonlinear alias source; 1× only |
| SILK | OVERSAMPLING OPTIONAL | 2× | Low | Reduce small upper harmonics; roughly 2× character-stage sample work |
| TAPE | OVERSAMPLING RECOMMENDED | 2× | Medium | Reduce measured folded harmonics; roughly 2× sample work |
| TUBE | OVERSAMPLING RECOMMENDED | 2× | Medium, after DC fix | Reduce nonlinear aliases; filter also needs a rate-correct coefficient; roughly 2× work plus per-channel filter state |
| CONSOLE | OVERSAMPLING RECOMMENDED | 2× | Medium | Reduce measured folded harmonics; roughly 2× sample work |
| CRUNCH | OVERSAMPLING OPTIONAL | 2× | Low | Modest measured alias reduction; roughly 2× sample work |
| DESTROY | OVERSAMPLING STRONGLY RECOMMENDED | 4× | High | Largest alias reduction opportunity; roughly 4× sample work and highest filter cost |

These are recommendations from the production curves' measured products, not measured oversampled improvements. Cost estimates count work per sample only; an actual polyphase filter adds overhead. Static operation count is lowest for LINEAR/SILK/CONSOLE, higher for TAPE/CRUNCH/DESTROY due transcendental operations, and highest for TUBE due two `tanh` evaluations plus state/filter work. Multiplying rate by 2×/4× scales each stage's sample work approximately by 2×/4×.

## Answers and scope

1. Relevant measured aliasing: DESTROY strongest; TAPE, TUBE and CONSOLE are clear; CRUNCH is modest; SILK is small. LINEAR has none beyond numerical residue.
2. Little aliasing: LINEAR, then SILK and CRUNCH relative to the stronger stages.
3. Most likely to benefit from 2×: TAPE, TUBE, CONSOLE; optional for SILK and CRUNCH.
4. 4× candidate: DESTROY. Validate with oversampled reference renders before implementation.
5. TUBE is sample-rate-dependent because its DC-blocker coefficient is fixed per sample.
6. Amount 0 is neutral across all stages after smoothing settles; sample error is Float32 rounding.
7. Unexpected level behavior: DESTROY boosts small signals up to 1.552× RMS. Other curves attenuate or approach unity in the tested range; no automatic makeup gain exists.
8. DC: no growing state found. TUBE blocks DC; other stages pass DC present in asymmetric inputs, without state accumulation.
9. Numerical stability: no NaN/Infinity in tested legal 0…+24 dB and Amount 0…100% matrix, including high-gain transients. This finite-duration run is not a proof for all inputs or indefinite operation.
10. Recommended production work: rate-correct TUBE's DC-blocker first; then stage-specific oversampling investigation, led by DESTROY and 2× candidates.
11. MUST FIX: TUBE coefficient/sample-rate dependency if the ~10 Hz intent is retained. Whether the DESTROY small-signal boost is a must-fix is a product decision; the measured behavior is certain.
12. OPTIONAL: stage-specific oversampling where classified optional/recommended; 4× DESTROY pending listening and CPU evidence. No automatic level matching.
13. Only audit/test files changed: `tests/input-character-audit.spec.js` and this report. No production DSP file was changed.
14. Test run: `npm.cmd run test:browser -- tests/input-character-audit.spec.js` — passed (one test, 15.2 s). It writes detailed measurements to Playwright's ignored test output directory.
15. Can P3B implementation be planned on these findings: **YES**, with TUBE rate correction tracked independently and DESTROY's gain-at-low-level behavior explicitly resolved in product design.

No oversampling, curve change, TUBE filter correction or other production modification was made. No commit or push was made.
