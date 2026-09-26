# Dynamic EQ V2

V2 extends the existing ten-band Dynamic EQ without changing its graph or the main signal path. ABS with LINKED detection retains the V1 threshold, window, smoothing, and sensitivity behavior.

REL compares each band's dB level with its inverse-distance weighted neighboring bands. The band order follows the filterbank's logarithmic frequency layout. When a learned profile is valid, REL instead compares each band against its learned dB target. LEARN averages the ten detector levels over three seconds while audio continues; FREEZE stores an explicit frozen state. A new LEARN starts a fresh profile.

LINKED uses one shared detector result and applies one smoothed gain to both channels. DUAL maintains independent peak/RMS and gain smoothing state for left and right. The detector still reads source-only bands before feedback and gain. Telemetry remains rate-limited to about 15 updates per second.

## State fields

- `detectorReferenceMode`: `ABS` or `REL`, default `ABS`
- `stereoDetectorMode`: `LINKED` or `DUAL`, default `LINKED`
- `dynamicEqCutRangeDb` and `dynamicEqBoostRangeDb`: independent 0–12 dB limits
- `learnedReferenceDb`: ten learned dB values
- `learnedReferenceValid` and `learnedReferenceFrozen`: profile validity and freeze state

Older snapshots that contain only `dynamicEqRangeDb` load that value into both new range fields. Missing V2 fields receive defaults, so existing V1 snapshots remain compatible.
