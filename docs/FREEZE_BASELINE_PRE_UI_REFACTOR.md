# Freeze-Baseline vor UI-Refactor

**Freeze-Zweck:** Referenzstand der funktionierenden Filterbank-, Feedback- und Resonanz-Implementierung vor dem vollständigen UI-Refactor.

- Datum: 2026-09-22
- Branch: `feature/feedback-resonance`
- Freeze-Commit: ausstehend – der aktuelle Ausführungsbereich erlaubt keinen Schreibzugriff auf `.git`; SHA wird beim autorisierten Freeze-Commit ergänzt.
- Tag: `pre-ui-refactor-baseline`

## Grenze dieser Baseline

Der kommende UI-Refactor darf weder DSP-Verhalten, Klangcharakter, Feedback-Semantik noch Filterbank-Werte ändern. Diese Baseline dient dabei als Referenz für Regression-Vergleiche. Insbesondere bleiben positive und negative Resonanz, Filter-Core, Frequenzen, Saturation, ZDF-Solver, Spread, P/CH, L/R-Linking, Wet Model, Analyzer, DEV LAB, Keyboard/MIDI und Audio-Routing unverändert.

## Aktuelle Kernarchitektur und Defaults

| Bereich | Baseline |
| --- | --- |
| Band-Filterbank | 10 Bänder: 29 Hz, 61 Hz, 115 Hz, 218 Hz, 411 Hz, 777 Hz, 1.5 kHz, 2.8 kHz, 5.2 kHz, 11 kHz; Base-Gain `-100…100`, neutral `0` |
| Feedback Cores | `CURRENT` (Default), `ZDF UNIFIED`, `ZDF PER-BAND` |
| Feedback Topologies | `ISOLATED TPT`, `COMMON BUS` (Default), `LOCAL LOOP EXP` |
| Wet Models | `FILTERBANK SUM` (Default), `REFERENCE + DELTA` |
| Feedback-Tap | `POST GAIN` (Default), `PRE GAIN` |
| FB ALL / MAIN | FB ALL L/R ist standardmäßig aus. MAIN/FB-ALL verwendet standardmäßig `COMMON BUS`, `POST GAIN SUM`, `1 / SQRT(10)`, Amount `100 %`; LOCAL und MAIN bleiben getrennte Rollen. |
| Negative Resonance | `SIGNED` (Default), `DAMPING`, `ANTI-RESONANCE`, `PHASE`; Amount `100 %`, LOCAL und MAIN an, Phase `90°`; NEG PHASE ist nur im PHASE-Modus aktiv. |
| Globale Defaults | Resonance `0`, Spread `0`, Spread Curve `LINEAR`, Spread Max Offset `6 dB`, Dry/Wet `50 %`, Input `0 dB`, Volume `-6 dB`. |
| Keyboard | KEY STEP Default `5 %`, Ganzzahl-Step im UI; KEY SPEED Default `30 Hz`. |

## P/CH, Spread und L/R

- Classic ist die Standardansicht. P/CH zeigt separate L/R-Bandfader und deaktiviert Spread technisch sowie visuell, ohne den gespeicherten Spread-Wert zu löschen.
- Beim Ausschalten von P/CH wird der zuvor gespeicherte Spread-Wert wieder verwendet.
- L/R-Linking erhält die bestehende Differenz beider Base-Fader; eine Bewegung verschiebt beide Werte gemeinsam und begrenzt sie an den jeweiligen Limits.
- Die Center-Ansicht repräsentiert nach P/CH den Mittelwert der beiden Base-Fader.

## Prüfumfang dieses Freeze

- Vollständige Playwright-Suite: `npx.cmd playwright test`.
- Finaler Ergebnisstand am 2026-09-22: **110 Tests ausgeführt, 75 bestanden, 35 fehlgeschlagen**.
- Der bestätigte Regression-Bug in `filterbank-main-sat-return.spec.js` wurde behoben: DEV MAIN SAT/RETURN beeinflusst den negativen MAIN-Resonance-Pfad nicht mehr. Dieser Test ist im finalen Lauf grün.
- Es gibt keinen bekannten echten Freeze-Blocker mehr.
- Zusätzlich gezielter UI-/State-Smoke-Check: 10 Bandfader vorhanden; ein Fader aktualisiert die dB-Anzeige auf `+6.0 dB`; P/CH erzeugt 20 Kanal-Fader, deaktiviert Spread und erhält dessen Wert (`0.4`); beim L/R-Link bleibt eine Differenz von `40 / 0` erhalten; FB ALL schaltet auf `ON`; SIGNED/DAMPING/ANTI-RESONANCE sperren NEG PHASE, PHASE aktiviert es; Sweetspot A ist nach SAVE ladbar.

## Bekannte offene Punkte (nicht Teil dieses Freeze)

- Solver-Fallbacks und Performance separat profilieren.
- Filter-Core, Q und Bandbreite separat untersuchen.
- Analyzer- und Telemetry-Semantik weiter schärfen.
- Freeze-/Beat-/Clock-Thema separat behandeln.
- Zukünftige Module und neuer Workspace gehören in einen eigenen Arbeitsblock.
- Der UI-Refactor ist der nächste große Block.

## Bekannte Testlage (nicht im Freeze behoben)

Die 35 fehlgeschlagenen Suite-Tests sind klassifizierte Testschuld, bewusst geänderte Semantik oder Environment-Abhängigkeiten; sie sind kein bekannter echter Freeze-Blocker und kein Anlass für einen Refactor. Sie fallen in diese Kategorien:

- **C – bewusst geänderte UI-Semantik / veraltete Assertions:** DEV-LAB-Control-Anzahlen und Tooltip-Interaktion, P/CH-Label-Struktur, Analyzer-/Bandwert-Darstellung, Response-Collapse-Layout, aktualisierte Defaults und Optionslisten.
- **B – vorhandene bzw. bereits dokumentierte Testschuld:** UI-/Layout-Annahmen, Audio-Fehlerstatus-Mocks und mehrere historische ZDF-/Feedback-Regressionserwartungen (siehe auch `docs/zdf-baseline-regression.md`).
- **D – timing-/umgebungsabhängig zu verifizieren:** einzelne AudioWorklet- bzw. Solver-Energie- und strikte Gleichheits-Assertions.

Abgesehen von der lokal behobenen MAIN-SAT/RETURN-Regressionskopplung wurden für diesen Freeze keine dieser Abweichungen korrigiert. Es erfolgen keine weiteren DSP- oder Feature-Änderungen.
