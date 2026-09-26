# P3B.1 — TUBE DC blocker sample-rate correction

The TUBE DC-blocker pole is now derived once in the worklet constructor from the 48 kHz reference:

```js
this.tubeDcPole = Math.pow(0.9987, 48000 / sampleRate);
```

The 48 kHz coefficient remains exactly `0.9987`. TUBE bias, `tanh` curve, amount, gain, crossfade and all other DSP are unchanged.

Cutoff values below use the exact digital -3 dB frequency of `H(z)=(1-z^-1)/(1-a z^-1)`, relative to its high-frequency gain. “Old” uses the fixed 0.9987 pole at every rate; “new” uses the rate-correct pole.

| Rate | Old pole | New pole | Old cutoff | New cutoff | Change from 48 kHz target |
|---:|---:|---:|---:|---:|---:|
| 44.1 kHz | 0.9987 | 0.9985851153822345 | 9.1302863 Hz | 9.9377261 Hz | +0.0000005 Hz |
| 48 kHz | 0.9987 | 0.9987 | 9.9377266 Hz | 9.9377266 Hz | 0 Hz |
| 96 kHz | 0.9987 | 0.9993497886125758 | 19.8754531 Hz | 9.9377287 Hz | +0.0000021 Hz |

The new cutoffs agree within 0.000003 Hz. The old 44.1 kHz filter was about 0.80744 Hz below the reference, while the old 96 kHz filter was about 9.93773 Hz above it.

## Verification

- `tests/input-character-tube-dc-rate.spec.js` measures the production AudioWorklet at 1, 5, 10, 20 and 100 Hz for all three sample rates. Measured responses matched the calculated digital filter responses within `0.00002` amplitude ratio.
- The regression test checks the exact 48 kHz pole, equal cutoffs, and finite impulse tails after a +24 dB impulse. The largest late tail peak was `1.99e-21`.
- `tests/input-character-audit.spec.js` continues to pass. It covers Amount 0 neutrality, LINEAR identity, legal extreme gain/amount combinations, finite samples and identical stereo parity. Its generated cutoff metadata now reflects the corrected coefficient.
- Command: `npm.cmd run test:browser -- tests/input-character-tube-dc-rate.spec.js tests/input-character-audit.spec.js` — **2 passed**.

Changed files: `input-preamp-processor.js`, `tests/input-character-audit.spec.js`, `tests/input-character-tube-dc-rate.spec.js`, and this report. No oversampling, curve changes, unrelated DSP changes, commit or push.
