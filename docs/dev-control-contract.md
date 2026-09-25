# DEV/LAB control contract

The UI dims and disables a stored control when the selected architecture cannot use it. Disabling a control does not reset its value; Sweetspots and engine state preserve it. For feedback controls, the table describes architectural availability. Audible feedback also requires the corresponding FB or FB ALL gate, nonzero resonance and input (or an established oscillation).

| Group | Controls | Available when |
|---|---|---|
| INPUT | Stage | Always |
| INPUT | Character | Stage is not LINEAR |
| OUTPUT | Soft Protection | Always; defaults ON |
| OUTPUT | Threshold, Softness | Soft Protection is ON |
| KEYBOARD | Key Step, Key Speed | Always; UI preference, not audio DSP |
| FILTERBANK | Reference | Wet model is REFERENCE + DELTA |
| FILTERBANK | Band Boost, Band Cut, Wet Model | Always configurable |
| FILTERBANK | Spread Curve | Never affects audio; disabled as an INACTIVE compatibility value |
| FILTERBANK | Spread Max Offset | CLASSIC spread mode |
| LOCAL FEEDBACK | FB Topology | Always; architecture selector |
| LOCAL FEEDBACK | Feedback Core | COMMON BUS or LOCAL LOOP EXP |
| LOCAL FEEDBACK | Local Loop Tuning | LOCAL LOOP EXP + CURRENT core + TPT engine |
| LOCAL FEEDBACK | FB Tap | COMMON BUS, or LOCAL LOOP EXP + ZDF PER-BAND |
| LOCAL FEEDBACK | FB Saturation | Common Bus local or MAIN return is available |
| LOCAL FEEDBACK | FB Drive, FB Ceiling | Common Bus return with CONSTANT CEILING saturation |
| FB ALL / MAIN | FB ALL Engine | CURRENT core with COMMON BUS or LOCAL LOOP EXP |
| FB ALL / MAIN | FB ALL Source, FB ALL Level | Common Bus MAIN return is available |
| FB ALL / MAIN | Post Gain FB Weight | Common Bus MAIN with STATIC POST-GAIN SUM |
| FB ALL / MAIN | FB ALL Amount | A MAIN return is available; all CURRENT architectures and non-isolated ZDF architectures |
| FB ALL / MAIN | Resonance Curve | COMMON BUS MAIN |
| FB ALL / MAIN | MAIN Sat/Return | COMMON BUS MAIN with CURRENT saturation and Common Bus engine |
| NEGATIVE RESONANCE | Mode, Curve, Amount, Local, Main | Resonance is negative |
| NEGATIVE RESONANCE | Phase | Negative resonance with PHASE mode |
| LEGACY / RESONATOR LAB | Resonator Engine | ISOLATED TPT without ZDF PER-BAND |
| LEGACY / RESONATOR LAB | Audition, Drive, Floor, Output, Latency, Curve | ISOLATED TPT resonator engine without ZDF PER-BAND |

In the default COMMON BUS topology, each FB band button selects a source tap. The local return then feeds all ten base filters in that channel. FB ALL controls a separate MAIN bus and does not switch those ten buttons. `STATIC POST-GAIN SUM` uses the static band gains; Dynamic EQ's time-varying gain does not enter that tap. MOD is visible but disabled because it has no audio path yet. Neither MOD nor SPREAD CURVE state is deleted.
