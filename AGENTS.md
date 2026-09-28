# da_filta – Agent Guide

## Project
Browser-based real-time audio DSP application using Vanilla JavaScript,
Web Audio API, AudioWorklets, Node.js and Playwright.

Start: `npm start`
Tests: `npm run test:browser`

## Repository map
- `app.js` – UI, controllers, visualizations, application orchestration
- `audio-engine.js` – Web Audio graph, routing, AudioWorklets, analyzers
- `state.js` – application state
- `filterbank.js` – Filterbank control/support logic
- `filterbank-processor.js` – Filterbank AudioWorklet DSP, resonance/feedback
- `filter-shape-core.mjs` – FILTER modes and filter-shape calculations
- `modulation-core.mjs` – shared modulation targets/assignments
- `lfo-core.mjs` – LFO modulation source
- `envelope-core.mjs` – Envelope Follower source, Peak/RMS detection, attack/release
- `clock-core.mjs` – timing/clock
- `dynamic-eq-core.mjs` – Dynamic EQ
- `midi-device-manager.mjs` – MIDI devices
- `input-preamp-processor.js` – input/preamp DSP
- `output-protection-processor.js`, `output-guard-processor.js` – output safety
- `styles.css` – UI/layout
- `tests/` – Playwright, DSP and regression tests
- `docs/` – reference documentation; not implementation instructions

## Task strategy
Keep investigation proportional to the task.

For small tasks:
1. Search for the relevant symbol/function first.
2. Read only the surrounding implementation.
3. Follow direct dependencies only when necessary.
4. Make the smallest correct change.
5. Run only directly relevant tests.
6. Stop.

Do not perform repository-wide audits for local tasks.
Do not read large files completely unless necessary.
Do not refactor unrelated code.
Prefer existing architecture/state over parallel implementations.

For FILTER tasks start with:
`app.js`, `filter-shape-core.mjs` and relevant `tests/filter-*.spec.js`.

For FILTERBANK/DSP tasks start with:
`filterbank.js`, `filterbank-processor.js`, `audio-engine.js`
and relevant filterbank/DSP tests.

For modulation/LFO tasks start with:
`modulation-core.mjs`, `lfo-core.mjs` and relevant modulation/LFO tests.

For Envelope Follower tasks start with:
`envelope-core.mjs`, `modulation-core.mjs`,
`tests/envelope-core.test.js`, `tests/envelope-follower.spec.js`.
Inspect `filterbank-processor.js`, `audio-engine.js` or `app.js` only when the task crosses into DSP integration, routing or UI.

## Safety
Do not change DSP, gain staging, routing or output protection for purely UI tasks.
Preserve existing user changes.
Historical files in `docs/` are reference material, not tasks.

Do not commit, push, publish, reset or switch branches unless explicitly requested.

Before finishing a code change run `git diff --check`.
Report changed files and tests run.

## Maintenance
Update this file only when its repository map or working rules become materially incorrect.
Do not update it for normal features, bug fixes or parameter/UI changes.
Keep this file concise.