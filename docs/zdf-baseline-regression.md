# ZDF-Baseline- und Regressionsprüfung

Verglichen wurden der unmittelbare vor-ZDF-Stand `dfbb30fbda217ac32dc399e27d696fe784f5b609` (`HEAD`, unverändert separat aus einem Git-Archiv bereitgestellt) und der aktuelle uncommittete Arbeitsstand auf `feature/feedback-resonance`. Beide wurden mit demselben Chromium/Playwright auf getrennten lokalen Ports getestet. Keine Alt-Tests und keine DSP-Parameter wurden für diese Prüfung angepasst.

## Zwölf Fehlschläge auf beiden Ständen

Die neun betroffenen Testdateien umfassen 25 Tests. Auf der Baseline: **13 bestanden, dieselben 12 fehlgeschlagen**. Der aktuelle vollständige Lauf hatte ebenfalls dieselben zwölf Fehlschläge (70 bestanden / 12 fehlgeschlagen zum damaligen Stand; spätere temporäre Diagnose-Tests nicht mitgezählt).

| Testdatei und Testname | Assertion / beobachtete Ursache (Baseline → ZDF-Stand) | Kategorie | Vor ZDF? |
| --- | --- | --- | --- |
| `dev-lab-tooltips.spec.js` — all DEV/LAB properties expose complete hover and keyboard help | 21 Controls erwartet; 25 → 26 vorhanden. Der neue Core-Select erhöht die bereits vorher falsche Anzahl um eins. | UI/Layout | Ja |
| `filterbank-common-bus-self-oscillation.spec.js` — COMMON BUS follows smoothed resonance through zero without seeding a digital null state | `postTargetZero.length > 0` erwartet; 0 → 0. Das 0,40–0,46-s-Fenster ist 60 ms lang, die Diagnostik sendet mit 15 Hz (~66,7 ms); der Test bekommt darin keinen passenden Diagnosepunkt. | CURRENT DSP (Test/Telemetrie-Zeitfenster) | Ja |
| `filterbank-debug-console.spec.js` — DEV LAB structured debug console opens and remains an internal, passive surface | Tooltip nach Fokus auf `[data-dev-lab-freeze]` sichtbar erwartet; hidden → hidden. | UI/Layout | Ja |
| `filterbank-feedback.spec.js` — AudioWorklet feedback, FB ALL and resonance remain finite, stereo-isolated and additive | Für jede Per-Band-Konfiguration `leftTailMax > 1e-9` erwartet; erster verletzender Wert `2.314693575700133e-12` → derselbe Wert. Ein Tail ist unter der pauschalen Untergrenze. | Legacy DSP | Ja |
| `filterbank-tpt-positive-e2e.spec.js` — the UI-to-production path delivers a non-zero positive local TPT residual to the wet and final outputs | Audition-Select mit 7 Optionen erwartet; auf beiden Ständen 10, einschließlich 1.50/2.00/4.00. Scheitert vor der eigentlichen DSP-Assertion. | UI/Layout | Ja |
| `filterbank-tpt-production.spec.js` — the production TPT worklet preserves the Biquad base path and the hybrid feedback migration behaviour | `leftMaxError ≤ 2e-6` erwartet; `1.0834189418732542e-5` → exakt derselbe Wert. | CURRENT DSP | Ja |
| `smoke.spec.js:455` — latest FB UI rules keep neutral keys and inactive modes correct | 10 `.mode-button` erwartet; 0 → 0. | UI/Layout | Ja |
| `smoke.spec.js:515` — audio I/O controls build and stop a mocked stereo pass-through | Erster Mock-Gain `10^(6/20) ≈ 1,99526` erwartet; 0 → 0. Testannahme passt nicht zur Input-Preamp-Kette. | Mock/Testinfrastruktur | Ja |
| `smoke.spec.js:697` — audio I/O reports a denied permission as ERROR | Fehlermeldung soll „verweigert“ enthalten; stattdessen auf beiden Ständen `this.context.createGain is not a function` im Mock. | Mock/Testinfrastruktur | Ja |
| `smoke.spec.js:719` — audio I/O reports an AudioWorklet load error as ERROR | Filterbank-Worklet-Fehler erwartet; auf beiden Ständen scheitert zuerst das Input-Preamp-Worklet. | Mock/Testinfrastruktur | Ja |
| `ui-layout-formatting.spec.js` — compact UI keeps normalized resonance and spread display formatting | Skalen-/Track-Ausrichtung: 32 erwartet, 34 → 34. | UI/Layout | Ja |
| `ui-viewport-regression.spec.js` — desktop viewport contains the complete open DEV/LAB layout | 20 DEV-LAB-Selects erwartet; 24 → 25. Der neue Select erhöht die bereits vorher falsche Anzahl um eins. | UI/Layout | Ja |

Damit: **12/12 nachgewiesen vorbestehend; 0 neu ZDF-bedingte Fehlschläge.** Die beiden DEV-LAB-Zählwerte unterscheiden sich erwartungsgemäß um den neuen Select, aber ihre Assertions schlugen schon vorher fehl. Die drei DSP-Testdateien wurden zusätzlich auf beiden Ständen isoliert erneut ausgeführt und trafen dieselbe Assertion mit denselben Zahlen. Die Testschuld bleibt offen; sie wurde hier bewusst nicht durch angepasste Erwartungen verdeckt.

## CURRENT-Sample-Regression

Ein temporärer Cross-Origin-OfflineAudioContext-Vergleich renderte dieselben 13 Konfigurationen mit dem vor-ZDF-Worklet und mit dem aktuellen Worklet bei ausdrücklich `feedbackCore = current`. Pro Konfiguration wurden 8192 Float32-Samples bei 48 kHz für **beide Kanäle bitweise** verglichen (insgesamt 212.992 Float32-Samples):

1. LOCAL positiv PRE GAIN;
2. LOCAL positiv POST GAIN;
3. MAIN positiv RAW/POST GAIN;
4. MAIN positiv 1/√10/POST GAIN;
5. LOCAL+MAIN positiv RAW/POST GAIN;
6. LOCAL+MAIN positiv 1/√10/POST GAIN;
7. LOCAL negativ POST GAIN;
8. MAIN negativ RAW/POST GAIN;
9. LOCAL+MAIN negativ 1/√10/POST GAIN;
10. bisheriger `LOCAL LOOP EXP`;
11. Stereo-Dual-Feedback mit unterschiedlichen L/R-Gates und Eingängen;
12. MAIN `DRIVE 4 / RETURN 0.2`;
13. MAIN POST-GAIN-Feedback-Soft-Knee.

**Ergebnis: 0 abweichende Sample-Bits in jeder Konfiguration.** Zusammen mit den numerisch identischen Alt-Testfehlern wurde keine CURRENT-Klang- oder Signalregression gefunden. Der Test deckt diese Konfigurationen und 48 kHz ab, nicht jede denkbare Parameterkombination.

## Extrempegel: Diagnose ohne DSP-Eingriff

Konfiguration: zehn LOCAL-Bänder aktiv, alle +24 dB, MAIN RAW, POST GAIN, CONSTANT CEILING Drive 16 / Ceiling 4, Resonance +1, 30-ms-Burst bei 777 Hz, anschließend Null-Input, 0,8 s bei 48 kHz.

| Messung | ZDF | CURRENT |
| --- | ---: | ---: |
| Wet-Peak | 353,551 | 354,023 |
| Zeitpunkt des Peaks | 77,46 ms | 77,71 ms |
| Spitzenbereich nach 100 ms | ca. 353,536–353,539 in jedem 50-ms-Fenster | ca. 353,970–353,997 |
| 50-ms-RMS nach 100 ms | ca. 162–185 | ca. 160–186 |
| LOCAL-/MAIN-Return-Peak | je 4 / 4 | je 4 / 4 |
| größter Base-Band-Peak | 10,311 | 10,308 |
| größter MAIN-Tap-Peak | 353,551 | 354,023 |
| Solver-Fallbacks in 0,8 s | 84 | nicht anwendbar |
| schlechtester Residualwert / Non-finite-Resets | `9,53e-7` / 0 | nicht anwendbar |

Bei ZDF überschritten 38.357 von 38.400 Samples den Betrag 1, 35.675 den Betrag 10 und 22.725 den Betrag 100. Die 50-ms-Peaks bleiben über die gesamten 0,8 s nahezu konstant; der Pegel ist **kein einzelner Solver-Ausreißer**. CURRENT erzeugt unter denselben Einstellungen einen nahezu gleich großen dauerhaften Zustand. Ohne Feedback (`resonance = 0`) betrug der ZDF-Peak lediglich 0,474 und der Tail klang ab.

Die beiden tanh-Returns sind einzeln auf ±4 begrenzt, nicht aber die nachfolgende Summe der zehn TPT-Bandausgänge mit je +24-dB-Fadergewicht (`≈15,85×`) im hörbaren `FILTERBANK SUM`. Die gemeinsame Rekursion hält die Base-Bänder mit Peaks um 10 aktiv; ihre vorzeichenbehaftete gewichtete Summe erreicht etwa 353,6. Bei diesem Wert entsteht kein Float32-Overflow; alle gerenderten Samples waren endlich. In der App folgen jedoch nur Dry/Wet-Mix und Volume-Gain, **kein Limiter**. Bei den Defaults Wet 50 % und Volume −6 dB ergibt der gemessene Wet-Peak rechnerisch noch etwa `353,55 × 0,5 × 10^(−6/20) ≈ 88,6` vor dem MediaStream-Ausgang (Dry-Anteil hier vernachlässigbar). Das liegt weit außerhalb ±1; Clipping bei nachgelagerter Medien-/Geräteausgabe ist deshalb eine reale Gefahr. Der genaue Clipping-Ort wurde nicht gemessen. Es wurde weder begrenzt noch normalisiert.

## Ergebnis

- Nachweislich vorbestehende Fehlschläge: **12 von 12**.
- CURRENT-Regression in den geprüften Signalkonfigurationen: **keine**, bitweise identische Samples.
- ZDF-Code im `CURRENT`-Modus: für die geprüften LOCAL-/MAIN-/Stereo-/Vorzeichen- und DEV-Kombinationen vollständig transparent.
- Manueller A/B-Hörtest: **technisch freigabefähig**, mit bewusst vorsichtigem Pegelmanagement bei extremen Boost-/RAW-/Drive-Kombinationen. Dies ist keine Produktionsfreigabe oder klangliche Entscheidung.
