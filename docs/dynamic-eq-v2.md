# Dynamic EQ V2

V2 extends the existing ten-band Dynamic EQ without redesigning its graph or changing the main signal path. ABS with LINKED detection retains the V1 threshold, window, smoothing, and sensitivity behavior.

REL compares each band's dB level with its inverse-distance weighted neighboring bands. The band order follows the filterbank's logarithmic frequency layout. When a learned profile is valid, REL instead compares each band against its learned dB target. LEARN averages the ten detector levels over three seconds while audio continues; FREEZE stores an explicit frozen state. A new LEARN starts a fresh profile.

LINKED uses one shared detector result and applies one smoothed gain to both channels. DUAL maintains independent peak/RMS and gain smoothing state for left and right. The detector still reads source-only bands before feedback and gain. Telemetry remains rate-limited to about 15 updates per second.

## State fields

- `detectorReferenceMode`: `ABS` or `REL`, default `ABS`
- `stereoDetectorMode`: `LINKED` or `DUAL`, default `LINKED`
- `dynamicEqCutRangeDb` and `dynamicEqBoostRangeDb`: independent 0–12 dB limits
- `learnedReferenceDb`: ten learned dB values
- `learnedReferenceValid` and `learnedReferenceFrozen`: profile validity and freeze state

Older snapshots that contain only `dynamicEqRangeDb` load that value into both new range fields. Missing V2 fields receive defaults, so existing V1 snapshots remain compatible.

The response graph has independent INPUT, REF, GAIN, OUT, and STATE view switches. All five default on; their visibility state is UI-only and never enters snapshots or worklet DSP settings. INPUT uses detector-level telemetry, REF uses absolute threshold/window guides and relative-reference or learned-profile values, and GAIN uses the resulting dynamic-gain telemetry. LINKED displays one detector/gain value per band; DUAL displays centered L/R pairs.

OUT means **applied per-channel band gain in dB**, not a measured post-processing audio level. The worklet copies the exact linear multiplier already used on each L/R band into a telemetry shadow, then converts it to dB at the existing low telemetry rate. This includes the static effective channel gain and any applied dynamic gain after its existing limit. Therefore OUT can differ between L and R under LINKED when the actual band states differ through CLASSIC/SPREAD or P/CH. Detector LINKED/DUAL and audio channel state remain separate dimensions. A missing OUT telemetry value is shown as unavailable rather than estimated from controls.

STATE reports Dynamic EQ ON/OFF, CUT/BOOST/BALANCE, ABS/REL, PEAK/RMS, LINKED/DUAL, PRE detector tap, CLASSIC/P/CH, and LEARNING/LEARNED/FROZEN where applicable; CLASSIC also reports a nonzero active SPREAD. The current system only implements the PRE detector tap, so the UI does not offer POST. Axis, grid, ten band positions, frequency labels, and sensitivity controls remain visible when layers are hidden.

The left plot scale maps detector levels in dBFS; dynamic gain and applied gain use separate bipolar dB mappings around the shared GAIN 0 dB baseline. Compact positive/negative ticks show the active dynamic cut/boost range and the applied band-gain limits. Permanent per-band L/R number rows are collapsed; focusing or hovering a band opens a compact detail card with its live INPUT, REF, GAIN, OUT, and sensitivity values. Each column remains keyboard and touch focusable.

The applied-gain axis reads its bounds from the live AudioEngine limits (with the existing limit selectors as the pre-audio fallback), not from Dynamic-EQ state, which does not own those limits. This avoids rendering undefined limits as `NaN` during initial render or mode transitions. The band readout shows no computed OUT until finite worklet telemetry is available.
