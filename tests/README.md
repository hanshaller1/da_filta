# Tests

Run commands from the repository root. On Windows PowerShell use `npm.cmd`.

| Command | Selection |
| --- | --- |
| `npm run test:node` | Node core/unit and server tests (`*.test.*`) |
| `npm run test:browser:smoke` | Ten individual `@smoke` cases; no DSP surveys |
| `npm run test:browser` | Active Playwright cases; excludes `@quarantine` |
| `npm run test:browser:quarantine` | Only documented `@quarantine` cases |
| `npm run test:browser:full` | Active plus quarantine cases |

Normal changes need only directly affected tests, for example:

```sh
npm run test:browser -- tests/envelope-follower.spec.js
node --test tests/envelope-core.test.js
```

Reserve complete browser runs for PRE-MERGE, RELEASE, BASELINE or an explicit
request. A quarantine run deliberately keeps failing assertions and exits
nonzero when they fail; it is not a release gate that can be called green.
See [QUARANTINE.md](QUARANTINE.md) for the exact cases and admission policy.

## Logical categories

Files remain in place because several specs cover more than one category.
The filename `smoke.spec.js` is historical and contains broader regression/DSP
coverage; the fast smoke profile uses individual tags, not the whole file.

| Category | Examples / selection |
| --- | --- |
| core / unit | `*.test.*`; pure cases in `dynamic-eq.spec.js`, `filter-shape.spec.js` |
| DSP | `filterbank-worklet`, `filterbank-tpt-*`, `input-preamp`, output guard/protection |
| UI | masthead, typography, layout, slider controls, workspace specs |
| integration | Clock Mod worklet, Envelope, MIDI, modulation, sample source |
| regression | state/restore, keyboard, channel isolation, legacy/current DSP comparisons |
| smoke | `@smoke` metadata on ten central app/UI/state checks |
| quarantine | `@quarantine` plus `@baseline-broken`; individual cases only |

## Generated output and historical fixtures

Each browser profile has its own ignored directory:
`tests/artifacts/test-results/{standard,smoke,quarantine,full}`.
Screenshots and other existing outputs under `tests/artifacts/` are also ignored.
The three INPUT CHARACTER report-writing specs use `measurement-report.cjs`
and write accumulated JSON under the active profile's `measurements/` directory.
They seed a focused run from the corresponding historical fixture if no output
exists yet; newly calculated fields replace that historical data as before.
Keep runs of the same profile sequential: its output directory is cleared by
Playwright at the beginning of a run. A spec's accumulated reports assume the
existing default file order (`fullyParallel` is off).

The five tracked JSON files in `tests/measurements/` are historical evidence and
reference fixtures used by assertions, profiling helpers and documentation.
They must not be overwritten by ordinary test runs or ignored/deleted as generic
generated output. The standalone oversampling generator writes to
`tests/artifacts/measurements/` by default:

```sh
node tests/helpers/measure-input-character-oversampling.cjs
```

Refreshing its two historical fixtures requires an intentional invocation with
`--fixtures` and review of the resulting diff. This is not a routine test step.
Browser profiles default to two workers rather than scaling to the CPU count.
Timing surveys can be slow and machine/load dependent. Use `--workers=1` for
focused timing investigations; do not infer real-time audio safety from a UI
smoke result or a main-thread replay benchmark.

For an optional JSON reporter, use an absolute `PLAYWRIGHT_JSON_OUTPUT_NAME`
under `tests/artifacts/`; Playwright resolves a relative reporter path against
the selected config directory, including nested profile configs.
