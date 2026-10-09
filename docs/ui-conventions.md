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

## Workspace controls (2026-10-09)

Inside a workspace (`[data-mode-panel]`) the look of a control comes from its
role, not from the mode it sits in.

| Class | Use | Weight |
| --- | --- | --- |
| `ui-role-toggle` | on/off and one-of-many switches | semibold |
| `ui-role-view` | switches that only change what a graph shows | semibold, muted when off |
| `ui-role-utility` | secondary helpers (SETUP, VIEW, LOCK) | semibold, secondary colour |
| `ui-role-action` | does something once (ADD, RESET, LOAD) | bold |
| `ui-role-danger` | removes something | bold, error colour |

Every `ui-role-*` button, every `select` and every text or number field takes
its height from `--control-size` and its padding from `--control-padding`. A
component never sets these on the control; the container picks a size:

| Size | Token | Where |
| --- | --- | --- |
| default | `--control-height` (26px) | selects, fields and the buttons beside them |
| compact | `--control-height-compact` (22px) | panel headers, FILTER TYPE grid, band FB, Clock Mod locks |
| touch | `--control-height-touch` (32px) | PRESETS / SNAPSHOTS workspace |

Type roles in a workspace:

| Role | Size / weight | Examples |
| --- | --- | --- |
| Workspace title | `--text-panel-title` 15 / 700 | FILTER RESPONSE, LFO MODULATION |
| Group title | `--text-section-title` 10 / 700 | WAVE, DIRECTION, DETECTOR, SNAPSHOT A |
| Parameter label | `--text-control-label` 10 / 700 | above a slider |
| Field label | `--text-utility` 9 / 400 | beside a select, field or switch |
| Button | `--text-panel-button` 10 / 600, 9px from 1200 to 1599px | all `ui-role-*` buttons |
| Parameter value | `--text-value-small` 11 / 600, tabular | slider read-outs |
| Field value | `--text-value-compact` 10 / 400 | selects and fields |
| Status, axis | `--text-utility` 9 or `--text-micro` 8 | header status, assignment state, graph axes |

New controls get a role class and, if they need a different size, a container
that sets `--control-size`. Do not add a font size or height to the control.

Below 1200px the mode tabs are a grid above the workspace; below 1050px the page
is one column with DEV / LAB at the end. Both hold for every mode.

Repeated selectors are often intentional responsive or later feature overrides.
Only remove a declaration when cascade order, specificity and media scope prove
it redundant. Validate the affected elements' computed styles and geometry across
desktop/tablet breakpoints, themes and workspaces. Keep IDs, state keys, target
IDs, parameter ranges and default reset paths intact.
