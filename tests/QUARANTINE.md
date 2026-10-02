# Quarantine register

Quarantine keeps established baseline failures executable and visible while
excluding them from ordinary active runs. It does not fix them or accept their
DSP/UI behavior as correct. No tests, assertions or tolerances were removed.

## Profiles

- Standard: `npm run test:browser` (226 active cases).
- Quarantine: `npm run test:browser:quarantine` (16 cases; failures keep exit code 1).
- Full: `npm run test:browser:full` (242 cases, the disjoint union of both profiles).
- Smoke: `npm run test:browser:smoke` (ten individual active cases).

On PowerShell use `npm.cmd`. Each profile writes to its own directory under
`tests/artifacts/test-results/`. Tags are Playwright test metadata:
`@quarantine` plus `@baseline-broken`. Only the individual cases below are tagged;
other cases in the same specs remain active.

## Evidence and exact cases

All cases below were already in the 17 failures of the 2026-09-28 full baseline
(225/242 passing). They were reproduced in a focused, single-worker run against
the unchanged product at `56caa74` on 2026-10-02: 16 failures, one pass.
The historical `profile unchanged P3B.4 before optimization: detailed constituents
and native 96k render` case passed this reproduction and remains active.
That timing/profile case is a watch item, not a newly admitted quarantine case.
The focused baseline log is locally available at
`tests/artifacts/cleanup-baseline.json` (ignored).

| Spec | Exact test title | Reproduced failure |
| --- | --- | --- |
| `band-value-display.spec.js` | band value displays mirror the configured asymmetric dB mapping | DEV limit select is hidden in the initial workspace; action times out. |
| `filterbank-core-switch-isolation.spec.js` | CURRENT remains bit-identical to the pre-ZDF processor across established configurations | CURRENT vs historical processor max difference 0.6003350987939212; exact-zero assertion retained. |
| `filterbank-debug-console.spec.js` | DEV LAB structured debug console opens and remains an internal, passive surface | Tooltip remains hidden after the old focus interaction. |
| `filterbank-feedback.spec.js` | AudioWorklet feedback, FB ALL and resonance remain finite, stereo-isolated and additive | Feedback tail 2.314693575700133e-12 vs required >1e-9. |
| `filterbank-local-loop-exp.spec.js` | LOCAL LOOP EXP keeps individual feedback returns local and coexists with MAIN | Old COMMON BUS label vs current COMMON BUS ? DA_FILTA-ORIGINAL. |
| `filterbank-local-loop-tuning.spec.js` | DEV LOCAL LOOP TUNING is a CURRENT-by-default LOCAL FEEDBACK control | Old test setup selects a disabled LOCAL LOOP TUNING control. |
| `filterbank-response-alignment.spec.js` | FILTERBANK response uses FILTER panel and graph surfaces across desktop sizes | Graph tick count is 10 vs required >10. |
| `filterbank-tpt-positive-e2e.spec.js` | the UI-to-production path delivers a non-zero positive local TPT residual to the wet and final outputs | Audition selector now has three more options than the exact old option list. |
| `filterbank-tpt-production.spec.js` | the production TPT worklet preserves the Biquad base path and the hybrid feedback migration behaviour | Parity deviation 1.0834189418732542e-5 vs <=2e-6. |
| `keyboard-preferences.spec.js` | KEY STEP and KEY SPEED control only held keyboard band-fader movement | Old setup attempts an unavailable control and times out. |
| `response-layout-baseline.spec.js` | MODE panel is absent and its height is assigned exclusively to the response graph | Old masthead height expectation 26px vs 29px. |
| `slider-touch-targets.spec.js` | tablet slider hit zones are invisible, enlarged, and kept within their bands | Old all-fader query counts 30 L/R/base rails vs expected ten. |
| `slider-touch-targets.spec.js` | global sliders keep a centered visible track and a 44px transparent touch target | Old centered global track geometry differs by 34.733px. |
| `slider-touch-targets.spec.js` | compact tablet keeps every fader hit zone in its own card | Old all-fader query counts 30 L/R/base rails vs expected ten. |
| `ui-layout-formatting.spec.js` | compact UI keeps normalized resonance and spread display formatting | Old output format expects 0 vs current 0.0 dB. |
| `ui-viewport-regression.spec.js` | desktop viewport contains the complete open DEV/LAB layout | Old DOM/layout probe dereferences a removed element. |

## Admission and retirement

A new failing case stays in the active profile. Diagnose it and report it;
never add a tag merely to make a run green. An explicit baseline-cleanup decision
requires evidence that the exact case predates the change, a reproduction,
and a register entry explaining the failure and risk. Do not tag entire specs,
use expected-failure annotations, catch assertion failures, or hide exit codes.

UI-contract updates and DSP repairs require their own authorized work. Do not
change production, widen tolerances, or weaken assertions during unrelated tasks.
Remove quarantine metadata after a reviewed correction and passing focused
verification. Run broader validation only under the repository test policy.
Existing baseline failures need not be re-investigated on every local feature task.
