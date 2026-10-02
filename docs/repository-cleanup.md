# Repository cleanup report

Date: 2026-10-02. Branch: `chore/repository-cleanup`.
Starting commit: `56caa74c7cb9d4e7135ff4494044eecd777b3776` (clean `feature/clock-mod`).
The user selected this current stand, retaining Clock Mod; its parent integration
stand is `main` at `85a0d2e`. No commit, push, publish or dependency upgrade.

## Inventory and classification before implementation

The initial tracked inventory contained 154 files, 27 root files, 21 documents,
76 Playwright specs / 242 cases, five native test files / 51 cases and five
measurement JSON fixtures. There was no `scripts/`, `.github/` workflow, bundler
or GitHub Pages build script. `npm start` serves the static root through
`server.js`; Playwright starts/reuses that server. No deployment architecture
was added or changed.

Read `AGENTS.md` in full, inspected package/lock/config/ignore rules, mapped root
JS/MJS imports and module ownership, reviewed state/modulation boundaries,
searched debug/TODO/catch/timer/allocation patterns and test setup/output paths,
compared exact repeated CSS rules and indexed the existing documentation.

| Class | Finding | Decision |
| --- | --- | --- |
| A SAFE CLEANUP | Root `.tmp-*` results and Chromium `debug.log`; incomplete portable ignore rules | Remove identified generated root artifacts; add focused ignore rules |
| B SAFE REFACTOR | Three report writers duplicate read/merge/write logic and overwrite historical JSON | Shared test-only report helper; generated JSON isolated by profile |
| B SAFE REFACTOR | Five earlier identical CSS blocks, two subsequently overwritten fader-size blocks, one duplicate LFO pressed-state block | Remove eight redundant rules; retain final cascade and media-specific rules |
| C TEST INFRASTRUCTURE | Only one browser command; native tests had no script; no granular quarantine or fast tagged smoke profile | Add four browser profiles, native script, individual metadata, documented register |
| C TEST INFRASTRUCTURE | 17 historically failed cases, 16 reproduced failures and one passing profiling case | Quarantine only the 16 reproduced historical cases; profiling case remains active |
| C TEST INFRASTRUCTURE | CPU-count concurrency competes with native DSP timing surveys | Default browser profiles to two workers; timing investigations can use one |
| D DOCUMENTATION | Current, legacy and experimental documents mixed without an index; Clock Mod missing from agent map | Add index, compact runtime/UI maps and test policy/docs |
| E OBSOLETE CANDIDATE | Empty scratch file, old contract probes, unused public parameter, backlog status questions | Retain; record candidates below |
| F FUNCTIONAL CHANGE | Hidden/disabled controls, labels/options, state compatibility and layout contracts behind old tests | No product/UI/state/MIDI/Clock changes |
| G DSP-RISK | CURRENT historical parity, feedback tail, TPT parity, sample-path allocation and numerical/constants consolidation | Record only; no DSP changes or assertion weakening |

## Changes by category

- **Test infrastructure / config / scripts:** `test:node`, standard active,
  quarantine, full and tagged smoke profiles. Standard excludes `@quarantine`;
  quarantine selects it; full clears the exclusion; smoke selects `@smoke` and
  retains the quarantine exclusion. Separate output roots preserve each result.
  Absolute test paths and explicit server cwd let nested profile configs work.
  Playwright starts the same server with portable `node server.js`.
- **Safe refactor / JS cleanup:** test-only `measurement-report.cjs` consolidates
  three report writers. Calculations, stimuli, assertions and tolerances remain
  unchanged. Reports accumulate within a spec/profile; focused runs seed missing
  data from the historical fixture. The standalone generator writes ignored
  output by default and refreshes its two reference fixtures only with `--fixtures`.
- **CSS cleanup / dead declarations:** remove redundant earlier `.fb-workspace`,
  `.bands`, `.band-card`, `.fader-wrap`, `.fader-track` declarations, two overridden
  fader-size rules, and one earlier LFO pressed-state rule. Shared selectors in
  different media scopes remain intact. No selector/ID or CSS value was changed.
- **Repo hygiene:** `.gitignore` adds `/.tmp-*/`, `/test-results/`,
  `/playwright-report/`, `/blob-report/`; existing `*.log`, `node_modules/` and
  `tests/artifacts/` remain. Removed the two empty root result directories
  `.tmp-lfo-test-results` and `.tmp-output-safety-results`, plus generated
  Chromium `debug.log`. Removed cleanup probes created during this task.
  No tracked user/project files or historical reference data were deleted.
- **Docs:** documentation status index, runtime signal flow/ownership map,
  existing UI conventions, test README, exact quarantine register and this report.
  Historical documents stay in place with original content/links.
- **AGENTS.md:** compact normal/full/quarantine test policy, output/fixture rule,
  native/smoke commands and missing Clock Mod module entry. No general feature
  instructions were added.

No production JS imports, exports, functions, DOM IDs, state fields or parameters
were deleted. No accidental production console output was proven: server startup
logging, DEV/LAB surfaces, measurement diagnostics and test hooks are intentional.
Defensive storage/disconnect catches retain their existing fallback/recovery
semantics. Existing single-frame guards and worklet telemetry bounds remain.

## Test infrastructure before and after

| Before | After |
| --- | --- |
| One `test:browser` command included all known failures | Active profile excludes only individually registered baseline cases |
| No native-test script | `npm run test:node`: 53 cases, including two report-isolation checks |
| `smoke.spec.js` mixed UI, state and rendered DSP checks | Ten central individual `@smoke` cases across existing files; no benchmarks |
| Historical measurement fixtures overwritten by test runs | Read-only references plus ignored per-profile generated JSON |
| Scattered current/historical/prototype documentation | Explicit CURRENT / LEGACY / EXPERIMENTAL / OBSOLETE CANDIDATE index |

Exact quarantined titles, reproduced errors and evidence are in
[../tests/QUARANTINE.md](../tests/QUARANTINE.md). No whole spec was excluded when
it also had active cases. No global error suppression, expected-failure shortcut,
exit-code workaround, assertion removal or tolerance change was introduced.
New regressions remain active and must be reported/diagnosed.

| Profile | Standard command | Selection |
| --- | --- | --- |
| Node | `npm run test:node` | Native core/unit/server/report tests |
| Smoke | `npm run test:browser:smoke` | 10 tagged active cases |
| Standard browser | `npm run test:browser` | 226 active cases |
| Quarantine | `npm run test:browser:quarantine` | 16 reproduced historical failures |
| Full | `npm run test:browser:full` | All 242 cases |

Use `npm.cmd` in this PowerShell environment. Logical category mappings are in
the test README; no large file moves or synthetic category claims were made.

## State, modulation, dependencies and retained candidates

`state.js`/normalizers preserve base/effective separation, L/R values, compatibility
fields and restore defaults. Runtime Envelope/LFO/Clock Mod phase/history stays
in the worklet. Registry target/source IDs, assignment semantics and MIDI device
listener/permission behavior remain intact. Small module-local clamps and
normalizers were not generalized across runtime/bundle boundaries. Shared band
counts, smoothing and DSP constants were not moved.

The sole declared dependency is devDependency `playwright`; specs/config/CLI use
it directly. `playwright-core` is its locked transitive dependency. No unused
dependency was proven, no package was removed/upgraded, and package/lock versions
remain unchanged.

| OBSOLETE CANDIDATE | Reason | Risk and recommendation |
| --- | --- | --- |
| `docs/_schmierzettel` | Empty scratch file | User/planning ownership unclear; keep until an explicit deletion decision |
| Quarantined UI/layout probes | Historical hidden-control, option-label, DOM and geometry assumptions | Review current contracts in a separate test-maintenance task; keep exact failing assertions here |
| `tests/smoke.spec.js` name | Contains much more than fast smoke coverage | Use individual smoke tags; defer a rename/split because historical commands depend on the path |
| `tests/input-character-production-architecture.spec.js` name | Exercises test-only architecture prototypes | Clarified in docs; defer rename to avoid breaking historical references |
| `envelope-core.mjs:normalizeEnvelopeSources` parameter `requestedCount` | Signature parameter currently unused with fixed four-source normalization | Public export/signature compatibility; document/deprecate separately rather than changing API shape |
| `docs/BACKLOG.md` status-review entries | Some entries explicitly flag potentially completed/overhauled work | Product decisions, not cleanup instructions; reconcile under a dedicated backlog task |

Frozen `input-character-architecture.cjs` / `input-character-architecture-p3b4.cjs`
duplication is intentional evidence: a test asserts byte equality, and optimized
variants compare against the frozen implementation. Keep it. The five tracked
measurement JSON files are fixtures/documented evidence, not disposable reports.

| FUNCTIONAL CHANGE CANDIDATE (not implemented) | Reason for deferral |
| --- | --- |
| Alter controls, options, formatting, graph ticks or layout to satisfy older tests | Would change current UI behavior or design; requires contract review |
| Merge state/Dynamic EQ normalizers or remove compatibility SPREAD CURVE fields | Could affect stored snapshots, defaults or restore fallback |
| Change hotplug/storage catch behavior or unify animation loops | Changes recovery, scheduling or UI behavior |
| Add LFO/Envelope/Clock Mod V2, MIDI Learn, macros or presets from backlog | Outside hygiene scope |

| DSP-RISK CANDIDATE (not implemented) | Evidence / recommendation |
| --- | --- |
| CURRENT vs historical parity | Difference 0.6003350987939212; rendered comparison in a separate DSP audit |
| Feedback tail | 2.314693575700133e-12 vs >1e-9; preserve assertion and investigate separately |
| Production TPT parity | 1.0834189418732542e-5 vs <=2e-6; no coefficient/calibration change |
| `applyMainCommonBusSaturation` object result in sample processing | Potential allocation-cost candidate; measure first and preserve saturation/return semantics |
| Centralizing DSP constants, smoothing or signal helpers | Numerical/order/import/bundle risk; no such refactor performed |

## Validation and changed files

Final validation completed against the cleanup worktree.

- Focused historical baseline reproduction: 16 failed, one passed (17 selected,
  one worker, 175.9 s); only the 16 known failures were tagged.
- Node: 53/53 passing, including fixture immutability/report accumulation and
  profile-isolation checks. Temporary test data uses the OS temp directory.
- Smoke: 10/10 passing, 9.1 s, one worker.
- Profile discovery: standard 226, quarantine 16, full 242, smoke 10. Verified
  standard/quarantine disjointness, full union and smoke subset using real CLI
  discovery; no browser Full suite needed solely to validate selection.
- CSS before/after: 96 combinations (eight desktop/tablet/mobile viewports,
  two themes, six workspaces), zero differences in all computed properties,
  before/after pseudo-elements and geometry of the affected elements.
- Standard browser: 226/226 passing, zero skipped/flaky/unexpected cases,
  two workers, 669.6 s (11.2 min). Generated JSON stayed outside tracked fixtures.
- Separate quarantine: 16/16 reproduced failures, zero passing/skipped/flaky
  cases, two workers, 77.4 s; command exit code 1, as required.
- Full execution: not run; active plus separate quarantine covers all cases once
  at the end and discovery validates the union without duplicating benchmarks.
- `git diff --check`: passed. Existing assertion lines remain identical.
- Byte comparison: all 27 protected production/HTML/lock/reference files match
  the starting commit. New local documentation links resolve.
- Runtime smoke, standard and quarantine JSON logs plus the CSS parity matrix
  are retained locally under ignored `tests/artifacts/`; none is in the diff.

Changed files (41; all uncommitted):

```text
.gitignore
AGENTS.md
docs/README.md
docs/architecture.md
docs/repository-cleanup.md
docs/ui-conventions.md
package.json
playwright.config.js
styles.css
tests/QUARANTINE.md
tests/README.md
tests/band-value-display.spec.js
tests/clock-mod-ui.spec.js
tests/config/full.config.cjs
tests/config/quarantine.config.cjs
tests/config/smoke.config.cjs
tests/dynamic-eq.spec.js
tests/envelope-follower.spec.js
tests/filter-mode.spec.js
tests/filterbank-core-switch-isolation.spec.js
tests/filterbank-debug-console.spec.js
tests/filterbank-feedback.spec.js
tests/filterbank-local-loop-exp.spec.js
tests/filterbank-local-loop-tuning.spec.js
tests/filterbank-response-alignment.spec.js
tests/filterbank-tpt-positive-e2e.spec.js
tests/filterbank-tpt-production.spec.js
tests/helpers/measure-input-character-oversampling.cjs
tests/helpers/measurement-report.cjs
tests/input-character-adaptive-oversampling.spec.js
tests/input-character-production-architecture.spec.js
tests/input-character-transition-performance.spec.js
tests/keyboard-preferences.spec.js
tests/masthead.spec.js
tests/measurement-report.test.cjs
tests/modulation-lfo.spec.js
tests/response-layout-baseline.spec.js
tests/slider-touch-targets.spec.js
tests/smoke.spec.js
tests/ui-layout-formatting.spec.js
tests/ui-viewport-regression.spec.js
```

**CLEANUP COMPLETE.** The requested hygiene and test separation are validated.
The 16 quarantined product/test-contract issues remain open by design; they are
not repairs included in this task.

Behavior contract: no functionality, audio behavior, UI behavior, parameters or
defaults changed; no existing feature removed and no new product feature added.
Production JS/DSP/routing/state/MIDI/Clock sources remain byte-identical to the
starting commit. CSS redundancy removal has computed-style/geometry parity.
This cleanup does not claim the quarantined historical product issues are fixed.

git commit -m "Clean up repository and test infrastructure"
