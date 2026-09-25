# DSP gain staging and output contract

## Signal path

`sourceBus → inputGainNode (0…+24 dB) → inputPreampNode (character) → {dry, filterbank wet} → linear dry/wet mix → master (-60…0 dB) → output protection → destination`.

The bypass route is `sourceBus → bypassGainNode → destination`; it does not pass through input gain, character, filterbank, master or output protection. The wet analyzer taps the filterbank before the dry/wet mix and before final protection. Feedback is internal to the filterbank, ahead of master and output protection.

Static FILTERBANK and FILTER dB contributions combine before the band clamp. Dynamic EQ adds to the pre-Dynamic dB value inside the processor, and the resulting audible gain is clamped to `[-maxBandCutDb, +maxBandBoostDb]`. The default boost ceiling is +12 dB; DEV can set +18 or +24 dB. The final protection does not change these gains or the feedback topology.

## Baseline measurement before changing DSP

The `tests/dsp-headroom.spec.js` survey renders the actual Input Preamp and Filterbank AudioWorklets in an `OfflineAudioContext`. It taps the pre-filterbank input, wet output, pre-master mix, and post-master output. The baseline was recorded before adding output protection. It covered 44.1, 48, and 96 kHz; 29, 115, 777, 2800, 5200, and 11000 Hz sines; a six-tone signal; seeded white noise; a 0.5-amplitude impulse; and a simple synth-like harmonic signal. Sines and noise have source peak 0.1. Render duration is 0.32 seconds. These are sample peaks, not true-peak estimates. Each line below reports the rate and signal producing that configuration's largest wet peak across the survey. `>1` is the count of final samples above unity in that render, across two channels. All measured samples were finite.

| Configuration | Rate / signal | Input peak | Wet peak | Wet RMS | Raw final peak | Raw final >1 |
|---|---|---:|---:|---:|---:|---:|
| A Neutral, 50% wet, master -6 dB | 44.1k / impulse | 0.500 | 0.360 | 0.004 | 0.215 | 0 |
| B INPUT +24 dB | 44.1k / impulse | 7.924 | 5.703 | 0.067 | 5.703 | 4 |
| C 10 × 0 dB | 44.1k / impulse | 0.500 | 0.360 | 0.004 | 0.360 | 0 |
| D 10 × +12 dB normal | 44.1k / impulse | 0.500 | 1.433 | 0.017 | 1.433 | 4 |
| E 10 × +24 dB DEV | 44.1k / impulse | 0.500 | 5.703 | 0.067 | 5.703 | 4 |
| F FILTER bell +12 dB | 44.1k / impulse | 0.500 | 0.782 | 0.009 | 0.782 | 0 |
| G Dynamic EQ BOOST, Range 12 dB | 44.1k / impulse | 0.500 | 1.241 | 0.015 | 1.241 | 4 |
| H Bands + FILTER | 44.1k / impulse | 0.500 | 1.433 | 0.017 | 1.433 | 4 |
| I Bands + Dynamic EQ | 44.1k / impulse | 0.500 | 1.433 | 0.017 | 1.433 | 4 |
| J Bands + FILTER + Dynamic EQ | 44.1k / impulse | 0.500 | 1.433 | 0.017 | 1.433 | 4 |
| K All local Common Bus taps, +12 dB, resonance +1 | 44.1k / 777 Hz | 0.100 | 9.968 | 4.988 | 9.968 | 28086 |
| L FB ALL, +12 dB, resonance +1 | 96k / 11 kHz | 0.100 | 7.709 | 5.159 | 7.709 | 61117 |
| M Local + FB ALL, +12 dB, resonance +1 | 44.1k / 777 Hz | 0.100 | **19.114** | 9.966 | **19.114** | 28159 |
| N Local + FB ALL, +12 dB, resonance +0.75 | 44.1k / 777 Hz | 0.100 | 17.359 | 11.134 | 17.359 | 28129 |
| O Local + FB ALL, +12 dB, resonance -1 | 44.1k / 11 kHz | 0.100 | 16.239 | 9.053 | 16.239 | 28214 |
| P LINEAR at INPUT +24 dB | 44.1k / impulse | 7.924 | 5.703 | 0.067 | 5.703 | 4 |
| P SILK | 44.1k / impulse | 5.154 | 3.710 | 0.044 | 3.710 | 4 |
| P TAPE | 44.1k / impulse | 4.474 | 3.220 | 0.038 | 3.220 | 4 |
| P TUBE | 44.1k / impulse | 4.258 | 3.065 | 0.036 | 3.065 | 4 |
| P CONSOLE | 44.1k / impulse | 4.787 | 3.445 | 0.041 | 3.445 | 4 |
| P CRUNCH | 44.1k / impulse | 4.462 | 3.212 | 0.038 | 3.212 | 4 |
| P DESTROY | 44.1k / impulse | 4.046 | 2.912 | 0.034 | 2.912 | 4 |

Except A, the matrix uses 100% wet and 0 dB master, so wet, pre-master, and raw final peaks match. F uses BELL at 777 Hz with +12 dB gain and full width. G uses BOOST, -60 dB threshold, zero window, 12 dB range, 100% strength, 1 ms attack and peak detector. H–J hit the existing final band clamp, hence their impulse peaks do not stack beyond D. K–O have all ten feedback-band gates active when local is specified; FB ALL uses its separate MAIN gate. The character stages use 50% amount. A's final output includes the actual linear 50/50 mix and -6 dB master.

At 777 Hz, configuration M's wet peak was 19.114 at 44.1 kHz, 19.048 at 48 kHz and 18.930 at 96 kHz. The upper band shows a stronger rate dependence: configuration L's worst case was 11 kHz at 96 kHz. A second sweep of local, MAIN and both buses at resonance ±0.25, ±0.5, ±0.75 and ±1 with 0 dB bands also stayed finite. At +1, the combined buses reached 3.441 wet peak (96 kHz, 777 Hz); at -1 they reached 3.528 (44.1 kHz, multitone). Saturation bounds the feedback returns, but the ten audible bands can still sum to a large signal. INPUT +24 dB itself can raise a 0.5 impulse to 7.924 before the filterbank. The seven character stages reduced that impulse relative to LINEAR but did not ensure output headroom.

## Protection decision and contract

The survey shows that the normal UI can exceed unity even without DEV: D and G cross unity, and M is far above it at a 0.1 source peak. DEV +24 dB and INPUT +24 dB add further risk. Reducing parameter maxima would remove intentional ranges and would not solve all paths. Fixed internal attenuation would change the filterbank's level and character. No band normalization, Q change, feedback topology change, input range change or lookahead limiter is used.

The chosen zero-lookahead final soft protection is after master and before the output destination. DEV/LAB has a separate **OUTPUT** category between INPUT and KEYBOARD, collapsed by default. It exposes Enable (default ON), Threshold (0.50…0.95 FS, default 0.80 FS) and Softness (0…100%, default 100%). The category uses the existing DEV/LAB select and number-control styles. These values are included in state and DEV/LAB snapshots. There is no routing selector.

When enabled, for `|x| ≤ threshold`, `y = x` exactly. Above the threshold, let `span = 0.99 − threshold`, `z = (|x| − threshold) / span` and `h = 4 × (1 − softness/100)`. Then `y = sign(x) × [threshold + span × tanh(z + h × z²)]`, approaching 0.99. At default settings this equals `sign(x) × (0.8 + 0.19 × tanh((|x| − 0.8) / 0.19))`. Nonfinite input becomes zero. Enable, threshold and softness changes are smoothed over about 10 ms. There is no signal-following attack/release, lookahead or algorithmic latency. The stage never enters a feedback return. Bypass still routes the unprocessed source directly to the destination. Peaks above the threshold gain harmonic distortion and may be strongly compressed in extreme settings; below it the sound is unchanged. When the user switches OUTPUT protection OFF, processed-path peaks can again exceed unity.

The technical output contract is finite samples with peak at or below 0.99 on the active processed path when protection is ON and settled, under the measured matrix. Internal floating-point peaks above one are permitted. The protection keeps those peaks from reaching the output, but does not claim that aggressive UI or DEV settings will sound clean. Users can reduce INPUT, band boost, resonance, wet mix or master for a less compressed signal. The test matrix is deterministic and finite in duration; it does not prove safety for every possible input or indefinitely sustained oscillation.

The post-change survey rendered 876 rate/configuration/signal combinations through the protection worklet. Its largest final sample was 0.99000001 (Float32 rounding), with zero samples above 1.0 and zero nonfinite samples. The largest pre-protection wet sample remained 19.114. The dedicated transfer test also checks ON/OFF, threshold and softness behavior. OUTPUT OFF intentionally removes the processed-path ceiling.
