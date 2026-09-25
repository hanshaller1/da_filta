# DA FILTA Typography Audit

Branch: `feature/typography-styleguide`  
Baseline: `7eee4f7` – Add extended filter shapes and type selector  
Audit method: CSS inventory plus browser `getComputedStyle()` at 1914×907, 1440×900, 1914×768 and 1199×800.

## Inventory before the change

- Font families found: `'Trebuchet MS', Arial, sans-serif`; `Consolas, 'Courier New', monospace`; and an active tablet fallback to browser Arial on `.mode-select`.
- Literal font sizes found: `0px`, `6px`, `7px`, `8px`, `9px`, `10px`, `11px`, `12px`, `13px`, `14px`, `15px`, `16px`, `17px`, `18px`, `20px`, `21px`, `23px`, `28px`, plus responsive `clamp()` values.
- Font weights found: `400`, `600`, `700`; additional computed `700` came from `<strong>`/`<b>` defaults.
- Shorthands found in the baseline included UI `font:` declarations from 9px to 16px and the debug `10px/1.35` monospace declaration.

## Computed baseline findings

| Role | Active baseline | Target / result |
|---|---|---|
| Brand | 28/700 UI; responsive brand clamp remained active below desktop | Keep; responsive behavior preserved |
| Masthead labels | 11/400 | 10/700 |
| Device/theme selects | 12/400 at desktop; theme select had an older 14px rule | 12/400 |
| Audio buttons | 10/600 at desktop; 11–12px in older responsive rules | 10/600 |
| Audio status | 12/400 label, 14/700 value | 10/400, 12/700 |
| Global control labels | 11/400 desktop; 12–13px responsive | 10/700 |
| Global values | 12/400 desktop; 13–14px responsive | 12/600 + tabular numerals |
| Mode navigation | 10/700 desktop; browser Arial 13.333/400 on tablet | 10/700 UI at all active breakpoints |
| FILTERBANK RESPONSE | 15/700 in active V2 title structure after runtime wrapping | 15/700 |
| FILTER RESPONSE | 15/700 | 15/700 |
| DEV / LAB | 16/700 | 15/700 |
| Mode placeholders | 17/700 title, 12px description desktop; tablet inherited 16px | 15/700 title; description remains utility/body-sized |
| Analyzer X axis | 12/700 at desktop and 17/700 in older active-looking rules | 10/600 |
| Filter X axis | 10/400 | 10/600 |
| Graph Y axes and frequency marker | 8/400 | Keep 8/400 |
| Filter type selector | trigger 11/700; groups 9/700; options 9/600 | trigger 11/700; groups 9/700; options 10/600 |
| Filter labels | inherited 10px without explicit weight | 10/700 |
| Filter values | standard 11/400; primary 14/700 | standard 11/600; primary 14/700 |
| Band frequency | 12/700 desktop; 18px tablet and older 20px rule | 12/700 |
| Classic/PCH gains | 10/400 | 10/600 + tabular numerals |
| CHANNELS | 9/400; low-height 8px rule | Keep 9/400 and low-height 8px |
| DEV/LAB controls | labels 11/400, inputs/selects 12/600, scale 9–10px | labels 10/400, inputs/selects 11/600, output 11/600, scale 9/400 |
| Analyzer normal status | 12/400 label, 13/700 value in source; runtime removes `.analyzer-status` | Source hierarchy retained; runtime removal documented as legacy |
| Tooltip | body 12/400, H3 14px, H4 11px | Keep hierarchy; UI token family |
| Theme editor | header 14/700, section 9/700, label 10/400, output 9/400 | Keep utility hierarchy |
| Debug console | 10/400 monospace | Keep 10/400 monospace; toolbar/buttons stay UI |

## Tokens introduced

```css
--font-ui: 'Trebuchet MS', Arial, sans-serif;
--font-mono: Consolas, 'Courier New', monospace;
--weight-regular: 400;
--weight-semibold: 600;
--weight-bold: 700;
--text-panel-title: 15px;
--text-section-title: 10px;
--text-control-label: 10px;
--text-button: 10px;
--text-value: 12px;
--text-value-small: 11px;
--text-value-compact: 10px;
--text-value-primary: 14px;
--text-status-value: 13px;
--text-axis: 10px;
--text-utility: 9px;
--text-micro: 8px;
```

All form controls now have a common UI-font basis. The debug console keeps `--font-mono`; its toolbar and buttons explicitly use `--font-ui`.

## After matrix and confirmations

- FILTERBANK RESPONSE = FILTER RESPONSE = DEV / LAB: 15px/700/UI at all desktop reference viewports.
- Filter and Filterbank X axes: identical 10px/600/UI.
- Filter and Filterbank Y axes: identical 8px/400/UI.
- Global control labels: consistent 10px/700.
- Filter parameter labels: consistent 10px/700, including all ten dynamic filter types.
- Filter selector: trigger 11px/700; group headings 9px/700; options 10px/600. PEAK / BELL, BAXANDALL / TONE and FORMANT / VOWEL were included in the selector cycle.
- Classic and P/CH gain values: identical 10px/600/tabular numerals.
- Debug log: remains 10px/400 monospace.
- Theme Editor: remains the intentional utility hierarchy.
- Analyzer microtelemetry: not globally enlarged; 6–10px roles remain local.
- `<strong>`/`<b>` semantics were covered through computed styles for active titles, values and controls.

## Legacy and overridden rules

The older pre-V2 rules were not removed. They remain in the stylesheet where they are layout/legacy context, but active typography is normalized by the final semantic layer. Notable overridden values include the old 14/16px global controls, 17/20px band labels, 16px DEV/LAB title, old analyzer axis sizing, older audio-bar sizes and the tablet browser-font fallback on mode tabs. The source `.analyzer-status` is removed at runtime by `app.js` before it can be an active DOM role; its source hierarchy is therefore documented but not treated as a live computed target. No general dead-CSS refactor was performed.

## Responsive and visual checks

- Computed styles checked at 1914×907, 1440×900, 1914×768 and 1199×800.
- Desktop screenshots checked at 1914×907 and 1914×768; no typography-induced overflow was observed.
- Tablet metrics checked for no horizontal scrollbar, ten band cards and one band row. The existing tablet layout still shows its pre-existing oversized SVG/icon geometry; no layout or icon refactor was introduced in this typography task.
- Brand responsive clamp and low-height CHANNELS 8px behavior were preserved.

## Tests

- Passed: `npx.cmd playwright test tests/typography-computed.spec.js --workers=1` (3/3).
- Passed: 18 relevant tests in `tests/filter-mode.spec.js`.
- Passed: 2 telemetry/DEV-LAB tests in `tests/filterbank-response-dev-lab.spec.js`.
- Existing unrelated failures: `ui-layout-formatting.spec.js` expects a spread output of `0` while the current app renders `0.0 dB`; `ui-viewport-regression.spec.js` expects an analyzer legend that current `app.js` removes at runtime. Neither `app.js` nor `index.html` was changed.
- Existing unrelated response-collapse failures: 2 tests in `tests/filterbank-response-collapse.spec.js` / `tests/filterbank-response-dev-lab.spec.js` expect `.response-collapse-toggle`, which is absent from the current runtime DOM.

## Changed files

- [styles.css](../styles.css)
- [tests/typography-computed.spec.js](../tests/typography-computed.spec.js)
- [docs/typography-audit.md](typography-audit.md)

git commit -m "Unify application typography"
