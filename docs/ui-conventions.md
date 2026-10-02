# Existing UI conventions

This documents `index.html`/`styles.css` at `56caa74`; it introduces no new design.
Use the final cascade, including responsive overrides, when comparing styles.

| Component | Existing hooks and convention |
| --- | --- |
| Buttons | Existing workspace, power and segmented-control selectors; `aria-pressed`, active/disabled states and theme variables carry visual state |
| Selects | Native device/DEV selects and FILTER type buttons; preserve each control's existing height, options, disabled state and semantic typography |
| Sliders | Global `.range-hit-area` and workspace `.filter-parameter-control`; existing visible track and transparent touch area are distinct |
| Labels | `.control-label` and component labels use semantic type roles; preserve units, case and letter spacing |
| Value displays | Existing `output` elements and per-band readouts; signed dB, percentages and normalized values follow the owning formatter, with tabular numeric alignment |
| Panel titles | Existing headers/`strong` elements and `--text-panel-title`/section roles; use current panel borders/background variables |
| Utility controls | Snapshot, help, theme and MIDI actions keep their existing utility/status roles and accessible labels |
| Graph controls | Existing view toggles, legends and source selectors; visibility controls affect graph layers independently of audio power |

The typography tokens at the start of `styles.css` distinguish panel title,
section title, control label, button, several value roles, axis, utility and micro
text. Theme colors come from existing variables such as `--cyan`,
`--panel-background`, `--output-border`, `--button-background` and
`--active-background`.

Repeated selectors are often intentional responsive or later feature overrides.
Only remove a declaration when cascade order, specificity and media scope prove
it redundant. Validate the affected elements' computed styles and geometry across
desktop/tablet breakpoints, themes and workspaces. Keep IDs, state keys, target
IDs, parameter ranges and default reset paths intact.
