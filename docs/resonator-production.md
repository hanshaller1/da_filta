# Erica-style Resonator: Produktpfad und Messvertrag

Stand: 2026-10-02, `fix/erica-style-resonator`, Basis `main` / `25211b8`
(lokal und `origin/main` identisch; sauberer Ausgangsstand).

## Produktvertrag

Der normale Resonator verwendet den vorhandenen `zdf-per-band`-Core:

```text
bandInput[i] = input + localReturn[i] + mainReturn
LOCAL i: Band i -> post-gain Tap -> signed Gain -> tanh -> nur Band i
MAIN:    Bandsumme -> post-gain-sum -> Level -> signed Gain/Amount -> tanh -> alle Bänder
```

LOCAL und MAIN werden bei aktivem FB ALL gemeinsam im vorhandenen gekoppelten
Schur/Newton-Solver gelöst. Ohne MAIN bleibt der vorhandene skalare LOCAL-Solver
aktiv. Die Histories sind Warmstarts für die implizite Gleichung, keine hörbaren
Previous-Sample-Returns. Je Band und Sample wird der bestehende Base-TPT-Zustand
genau einmal mit dem gelösten Eingang fortgeschrieben.

FB Band N aktiviert ausschließlich LOCAL N. Mehrere LOCALs bleiben unabhängig,
solange MAIN aus ist. FB ALL ist ein zusätzliches MAIN-Gate, kein Alias für die
zehn LOCAL-Gates. MAIN gelangt an den gemeinsamen Eingang; LOCAL eines fremden
Bands gelangt dort nicht hin. Stereo verwendet getrennte Systeme und Histories.

Resonance ist signed. Der Default verwendet unverändert
`K = sign(resonance) * 1.25 * resonance²`: positiv verstärkt, null liefert keinen
Feedbackbeitrag, negativ invertiert denselben Loop. Damping, Anti-Resonance,
Phase und alternative negative Kurven bleiben explizite DEV/LAB-Einstellungen.

Die zehn Frequenzen bleiben **29, 61, 115, 218, 411, 777, 1500, 2800, 5200,
11000 Hz**. Die bestehenden Qs, TPT-SVFs, Gain-Kennlinien und tanh-Sättigungen
bleiben erhalten. Keine neue Filterarchitektur, kein neuer Feedback-Core,
keine Oversampling-Stufe und keine LOCAL-Frequenzkompensation im Produktpfad.

## Verifizierte Kette und Defaults

Band-FB, FB ALL und Resonance: `app.js` -> normaler State -> AudioEngine-Setter
und `getFilterbankState()` -> Filterbank-Wrapper -> `processorOptions` bzw.
Port-Messages -> `processChannelFrame()` -> Per-Band LOCAL bzw. Coupled MAIN.
Der Audioausgang bleibt Bandsumme -> Wet-Gain -> Mix -> Volume -> Output Guard
-> Final Safety -> Destination. Der parallel geführte Dry-Pfad bleibt erhalten.

| Einstellung | Produktdefault |
|---|---|
| feedbackCore | zdf-per-band |
| feedbackTopology | common-bus, als vorhandener ZDF-Dispatcher; LOCAL ist hier per-band |
| feedbackTap / wetModel | post-gain / filterbank-sum |
| feedbackTapModulation | include (seit 2026-10-07, siehe Nachtrag) |
| feedbackAllEngine / feedbackAllSource | common-bus / post-gain-sum |
| feedbackAllLevel / feedbackAllAmount | sqrt10 (1/√10) / 100 % |
| feedbackAllResonanceCurve / SaturationReturn | current / current |
| positiveResonanceEngine / localLoopTuning | tpt / current |
| negativeResonanceMode / Curve / Amount | signed / same-as-positive / 100 % |
| negative LOCAL / MAIN | beide aktiviert |

AudioEngine, Wrapper, Worklet und DEV-Auswahl starten konsistent. Fehlende
Optionen erhalten die Produktdefaults; explizite alte Werte bleiben gültig.
Partielle Restores behalten die aktuelle explizite Architektur. Der Wrapper
restauriert nun auch `isolated-tpt`, `pre-gain`, `reference-delta`, `legacy` und
`post-gain-sum` nach vorherigem Wechsel zuverlässig. Panic löscht Feedback und
Histories, behält den gewählten Core. Ein DEV-Core-Wechsel ist kein Panic: die
Returns bleiben pro Core getrennt und Base-TPT-Integratorzustände kontinuierlich.

## Erhaltene Vergleiche

Vorher war der Produktcore CURRENT: aktive Band-Taps speisten einen gemeinsamen
LOCAL-Bus, dessen gesättigter Return im nächsten Sample alle Bänder anregte.
FB ALL ergänzte bereits eine separate, ebenfalls verzögerte MAIN-Summenschleife.
Beide konnten gleichzeitig laufen; die individuellen Bandtasten bedeuteten
somit Bus-Abgriffe und keine privaten LOCALs.

CURRENT/Common Bus bleibt unverändert als da_filta-Charakter im DEV/LAB.
Unified ZDF bleibt ein gemeinsamer impliziter LOCAL/MAIN-Return. CURRENT
`local-loop-exp` bleibt der explizite private One-Sample-Vergleich, einschließlich
seiner begrenzten `compensated`-Experimente. Isolated TPT, positive/residual
Audition und Legacy FB ALL bleiben erhalten. Legacy MAIN wird nur im passenden
CURRENT-Vergleich verwendet; Per-Band ZDF verwendet den gekoppelten MAIN-Solver.
Alle expliziten DEV-Snapshots können diese Alternativen weiter wählen.

Normale Buttons und Layout bleiben gleich. Nur ihre Hinweise und DEV-Beschriftung
werden präzisiert. Die Diagnostik zeigt private LOCAL-Return-/Bus-Werte je Band und
separaten MAIN-Return/-Bus; der Produktpfad zeigt keinen gemeinsamen LOCAL-Return.
Der vorhandene LOCAL-Trace zeigt dort das beschriftete Maximum der absoluten
privaten Returns je Kanal, SESSION MAX deren gemessene Intervallpeaks. Der
Return/Bus-Quotient verwendet private Paare; COMMON-Sättigungszeilen werden
für den Per-Band-Core ausgeblendet. MAIN bleibt separat sichtbar.

## Messungen: Audio und Topologie

`tests/resonator-production.spec.js` verwendet echte aktuelle DSP-Klassen mit
frameweiser Beobachtung sowie native OfflineAudioContexts mit dem produktiven
Worklet. A/B: explizites CURRENT/Common Bus gegen Per-Band ZDF, identische Inputs,
Fader, Gates, Resonance und Sample-Raten. JSON-Rohdaten bleiben ignoriert unter
`tests/artifacts/erica-final-targeted/`; keine generierten Reports im Git-Diff.

Struktur: LOCAL 5; LOCAL 4+7; MAIN-only; LOCAL 5+MAIN; LOCAL 4+7+MAIN;
alle LOCALs ohne MAIN; Resonance null und negativ. Die tatsächlich verarbeiteten
Band-Inputs entsprechen samplegenau ihrer jeweiligen LOCAL-/MAIN-Zuordnung.
Inaktive LOCALs bleiben exakt null, rechts ohne Input entsteht kein Return.
Die bestehenden Per-Band-Tests prüfen zusätzlich Post-Gain-Gewichtung,
fremde Fader, MAIN-Tap, Amount, L/R und genau einen TPT-Commit je Sample.

Zusätzliche Energie in den neun fremden Base-Bändern bei LOCAL 5, Resonance 0,7,
0,02-FS/411-Hz-Burst für 40 ms, 350-ms-Render; Summe der quadratischen Differenzen
zur neutralen Bank (für Ratenvergleiche durch die Rate teilen):

| Rate | CURRENT LOCAL | Produkt LOCAL | Produkt MAIN-only |
|---|---:|---:|---:|
| 44,1 kHz | 0,38408 | **0** | 0,02689 |
| 48 kHz | 0,41907 | **0** | 0,02930 |
| 96 kHz | 0,84660 | **0** | 0,05886 |

Kleinsignal-Response bei 48 kHz: 0,0001 FS, Frequenzraster 0,6…1,4 × Bandzentrum,
20 nominale Einschwingzyklen und 20 Messzyklen, LOCAL an, Resonance 0,7.
`compensated` ist absichtlich gewählt und bleibt im ZDF-Core wirkungslos.

| Zentrum | CURRENT Peak im Raster | Produkt Peak | Neutrale Bandsumme am Zentrum |
|---|---:|---:|---:|
| 61 Hz | 61 | 61 | +3,35 dB |
| 411 Hz | 411 | 411 | +3,37 dB |
| 777 Hz | 777 | 777 | +3,25 dB |
| 2800 Hz | 2660 | 2800 | +3,46 dB |
| 5200 Hz | 4680 | 5200 | +2,98 dB |
| 11000 Hz | 8800 | 11000 | +2,13 dB |

Bei allen drei Raten liegt der Produktpeak im Raster am nominellen Zentrum.
Band-Gain dort steigt von ungefähr 1,00 auf 2,58; negative Resonance reduziert
ihn. Die Zahl der Rasterpunkte innerhalb −3 dB sinkt von sieben auf fünf:
Nachweis der schmaleren Resonanz, keine präzise Hardware-Bandbreitenkalibrierung.
Der neutrale Summenresponse ist dokumentiert, nicht entzerrt oder neu abgestimmt.

Native LOCAL-Selbstoszillation bei Resonance 1, Fader 0 dB, 60-ms-Burst und
800-ms-Render; Frequenz aus positiven Nulldurchgängen der letzten 300 ms:

| Zentrum | 44,1 kHz | 48 kHz | 96 kHz |
|---|---:|---:|---:|
| 61 | 60,0 | 60,0 | 60,0 |
| 411 | 410,0 | 410,0 | 410,0 |
| 777 | 773,3 | 773,3 | 773,3 |
| 2800 | 2796,7 | 2796,7 | 2796,7 |
| 5200 | 5196,7 | 5193,3 | 5193,3 |
| 11000 | 11023,3 | 11030,0 | 10990,0 |

Die Zählauflösung beträgt 3,33 Hz. Dies ist Oszillationsfrequenz, getrennt vom
Kleinsignal-Resonanzpeak. Tail-RMS liegt meist bei 0,589 FS; nahe Nyquist bei
11 kHz/44,1 kHz bei 0,710 FS. Positive Resonance erhöht die Energie unmittelbar
nach dem Burst; die sehr späte subkritische Restenergie kann unter Rundungsrauschen
fallen und dient dann nicht als Frequenzmessung. Peak, RMS und frühe/späte Tails
werden für beide Cores, null, 0,7, 1 und −0,7 bei allen sechs Bändern gespeichert.

Onset-Raster 0,6/0,8/0,9/1 bei 411 Hz: LOCAL hält bei 0,9 bereits einen Tail,
bei 0,6/0,8 klingt er ab. MAIN-only mit 0-dB-Fadern und 1/√10 klingt auch bei 1
ab; mit allen Fadern +6 dB hält MAIN bei 1 einen Tail (48 kHz: 1,60 FS,
413,3 Hz), während 0,9 im Messfenster abklingt. Null-Input erhält keinen
künstlichen Seed. Exakte Onset-Schwellen und MAIN/LOCAL-Gleichheit werden nicht
erzwungen; sie bleiben Kalibrierfragen. Alle gemessenen States bleiben endlich.

## Coupled-Solver-Korrektur und Performance

Der vorhandene Newton-Solver verwendete nach akzeptierten Kandidaten weiterhin
die anfängliche Jacobi-Matrix. Bei kontinuierlichem Eingang und mehreren starken
Loops verursachte diese Chord-Iteration vermeidbare Fallbacks. Die vorhandene
Evaluator-Funktion aktualisiert jetzt auch dort die Jacobi-Matrix. Gleichungen,
Schur-Struktur, Warmstarts, sechs Newton-Schritte, Safeguards, Nested/Bisection-
Fallback, Grenzen und Residualtoleranz **1e−8** bleiben gleich. Keine neue
Sample-Loop-Allokation. CURRENT, Unified und der skalare LOCAL-Solver bleiben gleich.

Solver-Survey: 500 ms kontinuierlich 0,15 × sin(173 Hz) + 0,03 × cos(2203 Hz),
Fader +3 dB, Resonance 0,7; links gemessen, 1/√10 MAIN. Alle zwölf Fälle nach
der Korrektur: Fallbackrate **0 %**, Resets **0**, maximales Residual **<1e−8**.

| Konfiguration | Mittel/max bei 48 kHz | Mittel/max bei 96 kHz |
|---|---:|---:|
| 1 LOCAL | 2,00 / 2 | 2,00 / 2 |
| 5 LOCAL | 2,00 / 2 | 2,00 / 2 |
| 10 LOCAL | 2,01 / 3 | 2,00 / 3 |
| MAIN-only | 2,54 / 3 | 2,00 / 2 |
| 5 LOCAL + MAIN | 2,95 / 3 | 2,75 / 3 |
| 10 LOCAL + MAIN | 3,91 / 4 | 3,43 / 4 |

Die veröffentlichten Solverzähler enthalten die abschließende Konvergenzprüfung
(bei Coupled +1). Ohne Fallback sind die akzeptierten Newton-Schritte entsprechend
ein Schritt weniger. Vorher: 10 LOCAL+MAIN bei 48 kHz 5,87/max 7, **13,08 %**
Fallbacks; bei 96 kHz 4,70/max 6. Nachher kein Fallback in diesen Fällen.
Auch die bestehenden RAW-MAIN-Hochbandfälle verlieren ihre bisherigen Fallbacks
und behalten endliche Outputs und Resonanzfrequenzen innerhalb ihres Testvertrags.

Native vollständige Produktionsgraph-Messung mit bestehender P2-Infrastruktur:
Bekannte Rechnerkonfiguration aus dem bisherigen Projektkontext: Ryzen 7 5700X.
Gemessen mit Chromium, einem Testworker, 1,5 s je Konfiguration, Stereo,
Fader +3 dB und Resonance 0,7; erste 250 ms ausgeschlossen. Callback-Budget:
2,667 ms bei 48 kHz, 1,333 ms bei 96 kHz. Werte **Mittel / p99 / Maximum** in ms:

| Konfiguration | 48 kHz | 96 kHz |
|---|---:|---:|
| 1 LOCAL | 0,479 / 0,613 / 0,764 | 0,442 / 0,741 / 0,900 |
| 5 LOCAL | 0,547 / 0,874 / 0,988 | 0,521 / 0,876 / 1,008 |
| 10 LOCAL | 0,640 / 1,033 / 1,069 | 0,610 / 0,998 / 1,386 |
| MAIN-only | 0,673 / 1,073 / 1,253 | 0,586 / 0,944 / 1,061 |
| 5 LOCAL + MAIN | 0,788 / 1,216 / 1,317 | 0,694 / 1,112 / 1,320 |
| 10 LOCAL + MAIN | 0,959 / 1,488 / 1,666 | 0,836 / 1,316 / 1,579 |

48 kHz: keine Budgetüberschreitung nach Startup. 96 kHz: ein Callback über Budget
bei 10 LOCALs, acht bei 10 LOCALs+MAIN; p99 bleibt jeweils unter Budget, im letzten
Fall mit geringer Reserve. Vor der Jacobi-Korrektur lag dort p99 bei 1,620 ms und
93 Callbacks über Budget. Das sind Trace-Zeitmessungen, kein Nachweis hörbarer
Dropouts und keine Echtzeitgarantie für beliebige Rechner oder Zusatzlast.
Alle nativen Renders hatten endliche Ausgänge und null Processor-Errors.

## Kompatibilität, Tests und Grenzen

Die eingefrorene `25211b8`-Referenz bestätigt 42 Audio-Konfigurationen bei
44,1/48/96 kHz sampleidentisch (maximale Float32-Differenz 0): explizite Cores,
LOCAL-EXP/Legacy-Vergleiche und feedbackfreie Produktzustände. Die Coupled-
Jacobi-Korrektur verändert Konvergenz und kann bei stark nichtlinearen Zuständen
die approximierten alten Solvertrajektorien verändern; sie ist keine neue Klangkurve.

Der P2-Paritätstest gegen P1-C umfasst 137 Konfigurationen: 118 unveränderte
Pfade behalten exakte Audio-, State- und Solver-Parität. Die 19 betroffenen
Per-Band-MAIN-Fälle prüfen endliche Outputs/States, unveränderte Clock-/LFO-/
Envelope-Histories und keine Resets; reguläre Fälle zusätzlich Residual <1e−8
und null Fallbacks. Der bestehende extreme RAW/resonance=1/Impulse/DESTROY-Fall
behält seinen Safeguard-/Fallback-Vertrag (gemessenes Residual bis etwa 4,56e−7).
Er ist getrennt von den zwölf streng geprüften Produktkonfigurationen; die
Solver-Toleranz wird für ihn nicht gelockert.

Vorhandene CURRENT-/isolierte Testfixtures wählen ihre Architektur nun explizit;
die Biquad-Unity-plus-Delta-Referenz wählt `reference-delta`. Unveränderte Audio-
und Strukturassertionen prüfen weiter die jeweiligen DEV-Verträge. Zehn neue
aktive Produktfälle prüfen Defaults/Restore/Panic, eingefrorene Parität,
Transitions/Histories, private Inputs, Cross-Band-Energie, native Audio-A/B,
kontinuierlichen Solver, Response, Onset und native Graphkosten.

Hardware-style bezeichnet die LOCAL/MAIN-Topologie und implizite Looplösung.
Es ist **keine exakte Erica-Emulation**. Offen bleiben Hardwaremessungen zu Q,
Bandbreite, Loop-Gains, MAIN-Normalisierung, Sättigung, Tap-Punkt, Onset-Schwellen
und Bauteiltoleranzen. FILTER, Dynamic EQ, Modulatoren, MIDI, Input Character,
Output Guard, Final Safety, Presets und übrige Effekte werden nicht verändert.

## Nachtrag 2026-10-07: Band-Modulation im Feedback-Tap

Vorher gewichteten die ZDF-Cores ihre POST-GAIN-Taps (LOCAL und MAIN) nur mit
dem Fader-Gain `1 + deltaGain`. LFO, Envelope, Clock Mod, FILTER- und
Spread-Modulation veränderten ausschließlich den hörbaren Bandpegel. Ein per
Modulation auf −12 dB gezogenes Band oszillierte deshalb unverändert weiter,
ein Fader auf −12 dB beendete die Oszillation (LOCAL 5, Resonance 0,97:
Abklingen 0 dB gegenüber etwa −53 dB). CURRENT bezog die Modulation bereits ein.

Neu folgen beide Taps in UNIFIED und PER-BAND ZDF dem effektiven Band-Gain vor
Dynamic EQ: `(1 + deltaGain) * modulationGain`. Der Modulations-Smoother wird
dafür im Solver genau einmal je Band und Sample fortgeschrieben; die Bandschleife
verwendet denselben Wert. Dynamic-EQ-Gain bleibt außerhalb des Loops. Ohne
aktive Band-Modulation ist `modulationGain` exakt 1, alle bisherigen Zustände
bleiben sample-identisch. DEV LAB `DEV FB TAP MOD` (`feedbackTapModulation`)
stellt mit `FADER ONLY · LEGACY` das alte Verhalten für Vergleiche und alte
DEV-Snapshots wieder her; Produkt-Presets speichern den Wert nicht.

Gleichzeitig behoben: Bei PER-BAND ZDF mit `ISOLATED TPT` läuft kein Solver.
Die Bandschleife übersprang trotzdem das Glätten von Fadern und Gates, sodass
Laufzeitänderungen nicht hörbar wurden. Tests:
`tests/filterbank-feedback-tap-modulation.spec.js`,
`tests/filterbank-per-band-isolated-controls.spec.js`.

## Geänderte Dateien

Produktion (vier Dateien):

- `app.js`
- `audio-engine.js`
- `filterbank.js`
- `filterbank-processor.js`

Dokumentation (drei Dateien):

- `docs/resonator-production.md` (neu)
- `docs/BACKLOG.md`
- `docs/unified-signed-zdf-common-bus.md`

Tests und Testdokumentation (29 Dateien):

- `tests/resonator-production.spec.js` (neu)
- `tests/helpers/resonator-production.cjs` (neu)
- `tests/helpers/dsp-performance.cjs`
- `tests/dsp-performance.spec.js`
- `tests/feedback-all-level-integration.spec.js`
- `tests/filterbank-common-bus-fb-all.spec.js`
- `tests/filterbank-common-bus-resonance-curve.spec.js`
- `tests/filterbank-common-bus-self-oscillation.spec.js`
- `tests/filterbank-debug-console.spec.js`
- `tests/filterbank-response-dev-lab.spec.js`
- `tests/filterbank-local-loop-exp.spec.js`
- `tests/filterbank-local-loop-tuning.spec.js`
- `tests/filterbank-main-sat-return.spec.js`
- `tests/filterbank-post-gain-fb-weight.spec.js`
- `tests/filterbank-resonance-calibration.spec.js`
- `tests/filterbank-resonator-scaffold.spec.js`
- `tests/filterbank-tpt-nonlinear-audition.spec.js`
- `tests/filterbank-tpt-nonlinear-resonance.spec.js`
- `tests/filterbank-tpt-positive-audition.spec.js`
- `tests/filterbank-tpt-positive-e2e.spec.js`
- `tests/filterbank-tpt-positive-resonance.spec.js`
- `tests/filterbank-unified-zdf.spec.js`
- `tests/filterbank-worklet.spec.js`
- `tests/p1-feedback-ui.spec.js`
- `tests/modulation-crossmod.spec.js` (nur explizite alte DSP-Optionen im P2-Audiovergleich)
- `tests/panic-shortcuts.spec.js`
- `tests/smoke.spec.js`
- `tests/sweetspots.spec.js`
- `tests/QUARANTINE.md`

## Abschlussvalidierung

| Lauf | Ergebnis |
|---|---|
| `npm.cmd run test:node` | **71/71 bestanden** |
| Per-Band-ZDF und neue Produktfälle, ein Worker | **16/16 bestanden** |
| P2-Paritätsvertrag (137 Konfigurationen) | **1/1 bestanden** |
| letzte DEV-Diagnostik, Layout und korrigierte Vergleichsfixtures, ein Worker | **11/11 bestanden** |
| `npm.cmd run test:browser:smoke -- --output=tests/artifacts/erica-smoke-verified` | **11/11 bestanden** |
| `npm.cmd run test:browser -- --output=tests/artifacts/erica-standard-verified` | **265/265 bestanden**, 15,8 min |
| Quarantäneprofil, nur `--list` | **14 Fälle in zwölf Dateien**, nicht ausgeführt |
| `git diff --check` | ohne Befund |

Beim letzten Standard-Lauf lieferte die PowerShell-Logumleitung einen äußeren
Exitcode 1 wegen der umgeleiteten Node-`NO_COLOR`-Warnung (`NativeCommandError`).
Playwright bestätigt **265 passed** und `.last-run.json` enthält `status: passed`
mit leerer Fehlerliste. Der Umleitungseffekt wurde separat reproduziert:
ein erfolgreiches Node-Programm mit `stderr` liefert nativ Exitcode 0, während
der umleitende PowerShell-Aufruf ohne explizite Exitcode-Übernahme 1 meldet.

265 aktive Browserfälle, davon elf Smoke-Fälle; unverändert 14 Quarantäne-Tags.
Full inklusive Quarantäne wurde nicht ausgeführt. Keine Assertionstoleranz wurde
gelockert, kein Fall neu quarantänisiert. Vergleichsfixtures wählen ihre alte
Architektur explizit; der geänderte Coupled-Solver erhält einen mathematischen
Konvergenzvertrag und separate unveränderte Audio-/Source-State-Paritätschecks.

Die 36 geänderten/neuen Dateien stehen vollständig oben. Generierte Messungen
und Logs liegen ignoriert unter `tests/artifacts/`. Der Branch bleibt
`fix/erica-style-resonator`, HEAD bleibt `25211b8`. Kein Commit und kein Push.

**ERICA-STYLE RESONATOR COMPLETE**
