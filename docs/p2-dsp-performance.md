# P2 DSP / AudioWorklet Performance

Stand: 2026-10-02. Branch `perf/p2-dsp-audioworklet`, sauberer Ausgangspunkt
`main` / `3c15441332736bf7ac1accb40b0c5f9b8f6a7390` nach P1-C.

Status: **P2 DSP/PERFORMANCE COMPLETE**.

## Methode und Grenzen

Windows, Ryzen 7 5700X (16 logische CPUs), 31,91 GiB RAM,
Playwright Chromium 153.0.8010.12. Stereo, 128 Frames pro Block.
Budget: 2,667 ms bei 48 kHz, 1,333 ms bei 96 kHz; 44,1 kHz werden
zusätzlich in den Audio-/State-/Core-Vergleichen geprüft.

Die Referenzdateien werden mit `git show 3c15441:<Datei>` unverändert gelesen
und über Browser-Routen bereitgestellt. Auch deren ESM-Abhängigkeiten kommen
aus diesem Commit. Die Tests benötigen diesen Commit in der lokalen History;
ein flacher Checkout muss ihn vor dem Vergleich nachladen.

Drei Messungen haben verschiedene Aufgaben:

- Tatsächliche Processor-Klassen als Browser-ESM, vorallokierte Stereo-Blöcke:
  gepaarte Kosten, Audio, State und deterministische Aufruf-/Solverzähler.
  Keine nachgebaute DSP-Mathematik, kein Node-VM-Ersatz für die Filterbank.
  Der CPU-/Paritäts-Harness verbindet sie mit einem festen 30/70%-Mix und
  −6-dB-Master in JavaScript. Native GainNode-Summierung und AudioParam-
  Ausführung werden separat im echten Graph gemessen; dessen Live-Analyser
  liefert finite/Peak-Beobachtungen, keinen synchronen Sample-A/B-Stream.
- Uninstrumentierte Zeitmessung, anschließend separater CDP-CPU-Profile-Lauf.
  Der Browser-Harness teilt JIT-Code zwischen Raten und Konfigurationen;
  diese Zahlen sind keine nativen Worklet-Deadline-Garantien.
- Native `AudioEngine.start()` mit echten separaten Worklets, GainNodes,
  Dry/Wet, Guard, Final Safety, MediaStream-Ausgang und Start-Mute/Ramp.
  CDP misst vollständige 128-Frame-Render-Callbacks. Ein zusätzlicher
  2048-Sample-Analyser nach Final Safety kontrolliert finite Ausgabe per RAF.
  Enthalten sind die nativen Analyzer-/Graph-Kosten; Grafik- und Analyzer-Lesezeit
  im Main Thread lassen sich daraus nicht einzeln dem Audio-Thread zuordnen.

Native Fälle laufen 1,5 s nach `start()`. Die ersten 250 ms der Render-Trace
werden gesondert als Startup betrachtet, nicht in die laufenden Perzentile
gemischt. Stage-Wechsel erfolgen etwa bei 0,5 s; das konservative Fenster
0,4–0,8 s enthält Warmup, Fade und benachbarte Render-Bursts. Startup-Maxima
von mehreren ms bleiben sichtbar und werden nicht als Steady-State ausgegeben.
Vollmatrix und drei zusätzliche 96-kHz-Paare mit wechselnder A/B-Reihenfolge
zeigen erhebliche Streuung. P99 ist ein lokaler Messwert, keine zugesicherte Reserve.

Timing hat keine enge CI-Assertion. Harte Gates betreffen Sample-/State-/Solver-
Parität, finite Werte, Message-/Aufrufzahlen, echte Sample Rate und Processorfehler.
Heap-Sampling läuft getrennt, mit Erfassung eingesammelter Objekte. Es kann JIT
und Boxing beeinflussen; die ausgewiesenen Bytes sind Indikatoren im Browser-
Processor-Harness, keine exakt zugewiesenen nativen Worklet-Allokationen.
Trace-GC-Zahlen umfassen Browser/V8 und beweisen keine einzelne Worklet-Ursache.

## Umgesetzte Änderungen

1. FIR-Historien werden bei jedem Schreiben gespiegelt. Der Tap-Loop liest
   zusammenhängend statt bei jedem Tap einen Wrap-Masken-Ausdruck auszuführen.
   Koeffizienten, Summationsreihenfolge und Float32-Grenzen bleiben identisch.
   Der Tradeoff ist mehr vorallokierter History-Speicher: zusätzlich 64 KiB
   bei 44,1/48 kHz und 12 KiB bei 96 kHz pro Stereo-Processor, keine
   Laufzeitallokation. Die Spiegelhälften werden auch beim Branch-Reset geleert.
2. Bei vollständig leerer Assignment-Liste entfällt die periodische Runtime-
   Target-Auswertung. Parameternachrichten setzen statische Bases weiterhin
   sofort. LFO, Clock, Clock-Mod-Held-Updates und Envelope-State laufen nach
   ihrem bisherigen Vertrag weiter. Inaktive oder verlorene gespeicherte
   Assignments zählen weiterhin als vorhandene Assignments; deren Pfad bleibt aktiv.
3. `applyMainCommonBusSaturation` gibt einen Skalar statt eines Ergebnisobjekts
   pro Stereo-Sample zurück. Der zweite Diagnosewert liegt in einem numerischen
   Scratch-Feld und wird unmittelbar in den betreffenden Kanal kopiert.
   CURRENT, Constant Ceiling, signed negative MAIN und Drive-4/Return-0.2
   behalten ihre bisherige Arithmetik. Der Helper hat nur diesen internen Aufrufer.
4. Der Wrapper unterdrückt identische Band-/MAIN-Gate-Targets und identische
   Pre-Dynamic-Gain-Paare. `Object.is` erhält dabei auch die Unterscheidung ±0.
   Konstruktor-Optionen initialisieren alle Targets; `applyState` sendet immer
   den vollständigen Restore. Panic synchronisiert die Wrapper-Gates.
   Reset-, Learn-, Clock- und Transportereignisse werden nicht dedupliziert.
   Band-Base-Gain und Resonance bleiben bewusst ungekürzt: ihre Worklet-Setter
   lösen auch bei gleichem Wert eine Modulation-Target-Aktualisierung aus.

Vor der Integration wurden einzelne Kandidaten gegen die unveränderte Referenz
gemessen (sieben gepaarte Runden, 512 Blöcke pro Runde):

| Kandidat | 48 kHz vorher → nachher, ms/Block | 96 kHz vorher → nachher, ms/Block |
| --- | ---: | ---: |
| DESTROY, nur FIR-History | 0,30957 → 0,29824 | 0,13125 → 0,11270 |
| Filterbank, leere Assignments | 0,24629 → 0,23945 | 0,27480 → 0,26152 |
| CURRENT LOCAL + MAIN, nur Skalar-Helper | 0,31641 → 0,29336 | 0,33652 → 0,32188 |

Alle Kandidaten waren sample-identisch. Diese Einzelmessung begründet die
Integration; spätere gemischte Harness- und native Messungen liefern keine
allgemein reproduzierbare prozentuale Gesamtgraph-Beschleunigung. Insbesondere
der 96-kHz-Heavy-Graph bleibt ein Realtime-Risiko.

Heap-Sampling des alten MAIN-Helpers zeigte etwa 11,6 MB attributierte
Allokation für 1024 Stereo-Blöcke; der reine Skalar-Kandidat lag bei etwa
3,2 MB (unter anderem verbleibendes Numeric Boxing). Strukturell entfallen
zwei Ergebnisobjekte pro Stereo-Frame. Weder der gesamte DSP noch V8 werden
damit als allokationsfrei bezeichnet.

Der Wiederholungsfall `100 × applyEffectiveBandGains + applyEffectiveFeedbackState`
sendet 5.300 → 2.100 Nachrichten (−60,38 %). 2.000 Base-Gain- und 100 Resonance-
Nachrichten bleiben erhalten. Über sieben native MessagePort-Runden wurden
37.100 → 14.700 Nachrichten empfangen; die mediane Sendezeit je Runde sank
im fokussierten Regressionslauf von 8,3 auf 3,5 ms. Das ist kein Audio-Callback-
Benchmark. Änderungen, Restore, Panic, ±0, wiederholte Events und Dispose
werden zusätzlich funktional geprüft.

Nicht übernommen: Vorrechnen der konstanten TUBE-Bias-Tanh-Zahl und eine feste
LFO-Sync-Division-Tabelle. Die gepaarten Versuche zeigten keinen belastbaren
Vorteil (TUBE bei 96 kHz sogar langsamer). Kennlinien und LFO-Code bleiben gleich.
Die temporären Varianten sind nicht Bestandteil des produktiven Codes oder
der dauerhaften Test-Helfer.

Auch ein zusätzliches Gate für die unbenutzte MAIN-Gewichtsfunktion wurde
separat gegen den integrierten Stand gemessen: geschlossene MAIN-Gates bei
48 kHz unverändert (0,23496 ms/Block), bei 96 kHz 0,26914 → 0,25586 ms.
Aktives LOCAL + MAIN wurde dabei langsamer: 0,26719 → 0,27070 bzw.
0,30742 → 0,31582 ms. Der Standard-Gewichtspfad ist bereits eine einfache
Identität; das zusätzliche Gate wird wegen dieses gemischten Resultats nicht
übernommen. Diagnosewerte bleiben vollständig erhalten.

## Input Character und Ursache der 96-kHz-Last

Die Input-Matrix umfasst LINEAR/TAPE/TUBE/CRUNCH/DESTROY, Amount 0/100,
Steady-State und Transition bei 48/96 kHz: 40 Processor-Phasenfälle plus
40 native Graph-Fälle je Vorher-/Nachher-Version. Übergänge werden auch mit
schnellen DESTROY → CRUNCH → TUBE-Anfragen gegen P1-C verglichen.

P1-C bleibt unverändert: LINEAR 1x; SILK/TAPE/TUBE/CONSOLE/CRUNCH bei
44,1/48 kHz 2x, bei 96 kHz 1x; DESTROY 4x bzw. 2x. FIR: 257 Taps,
Kaiser 8,6, Cutoff 0,2375. 192 Host-Samples Latenz für sämtliche Stages und
Amount 0; 384 Samples Warmup; 15-ms-Exponentialfade; kontinuierlicher TUBE-
DC-State; 250-ms-Start-Mute und 10-ms-Ausgangsramp.

Bei 48 kHz läuft der gemeinsame 2x-Up-Pfad auch im LINEAR-Fall, um TUBE-State
warm zu halten. Amount 0 deaktiviert die Branch-Arbeit nicht: sonst würden
History und Amount-Handover geändert. Bei 96 kHz sind TAPE/TUBE/CRUNCH 1x;
DESTROY ist der zusätzliche 2x-FIR-Lastfall. Warmup/Fade rechnen alte und neue
Korrektur gleichzeitig, teilen den Up-Pfad und berechnen TUBE-State weiterhin
einmal. Die Dauer des Exponentialfades bis zum bestehenden Completion-Epsilon
ist länger als die 15-ms-Zeitkonstante; sie wurde nicht künstlich verkürzt.

Die Filterbank ist im realistischen Heavy Case der größere Kostenblock.
Dynamic EQ, Runtime-Assignments, Feedback und insbesondere Per-Band-Coupling
mit Fallbacks werden getrennt von FIR/Character gemessen. Ausreißer auch bei
LINEAR und bei abgeschaltetem Oversampling-Korrekturanteil lassen sich nicht
alle dem Oversampling zuschreiben. Unterschiedliche Browser-/Host- und JIT-
Ausreißer bleiben trotz sample-identischer Optimierung möglich.

## Telemetrie, Diagnose und inaktive Pfade

Dynamic-EQ-Detektion läuft nur bei Enabled/LEARN, und weiterhin vor angewendetem
Bandgain. Resonator- und nichtlineare Diagnosearbeit haben getrennte bestehende
Gates; bei geschlossenen Gates darf der hörbare Resonator trotzdem auslaufen.
Filterbank OFF überspringt den Spektralpfad erst nach dem etablierten Mix-Fade.
Envelope hält seinen bestehenden Disabled-/Delay-/RMS-Vertrag. LFO-Free/Sync-
Phasen, MIDI-/interne Clock und Clock-Mod-Held-State werden nicht pauschal pausiert.

64 Blöcke bei 96 kHz: ohne Assignments nun 0 statt 256 Runtime-Target-Auswertungen;
mit 1 oder 12 Assignments weiterhin 256. Dynamic EQ aktiv: 8.192 Updates, inaktiv:
0. CURRENT MAIN aktiv: 16.384 Saturation-Aufrufe für Stereo. Source-Phasen und
Clock-Position sind vorher/nachher identisch.

LFO-/Envelope-/Clock-Telemetrie ist nach Enabled/Dirty gegatet. Dynamic EQ
sendet nach Enabled/LEARN/Dirty, Resonator-Diagnostik nur nach explizitem Enable.
Arrays, Kopien, Strings und Diagnoseobjekte dort gehören zur Publish-/Control-
Ebene, nicht zum Sample-Loop. Safety-Peak-/Reduction-Aggregation und ihre
Publikation sind bereits nach `telemetryEnabled` gegatet. Bestehende Frequenzen
(Dynamic EQ/Resonator etwa 15 Hz) und Safety-Metriken bleiben unverändert.
Die Mehrkosten von DEV-Diagnose entstehen vor dem Publish, nicht nur durch
eine zusätzliche Nachricht. Die CPU-Probe findet Band-/Feedback-Verarbeitung,
Character-Prozess und Coupled-Solver als Hauptblöcke; keine pauschale Diagnose-
oder Safety-Abschaltung wurde eingeführt.

## Bestehende Feedback-Cores und Legacy

CURRENT Common Bus behält den gemeinsamen verzögerten Charakter; CURRENT
Local arbeitet mit getrennten lokalen Returns, MAIN bleibt separat. Unified
ZDF löst einen gemeinsamen skalaren impliziten Return. Per-Band ZDF hat
separate LOCAL-Roots und bei MAIN ein gekoppeltes Schur-System mit Safeguards.
Die Cores haben unterschiedliche Klang-/Tail-Verträge; die CPU-Tabelle benennt
Kosten, bestimmt aber keinen neuen Default.

Die Vergleichsmatrix umfasst positive/negative Resonance, LOCAL/MAIN/beides,
48/96 kHz und 44,1-kHz-Audio-Parität, 1/2/5/10 LOCAL-Bänder sowie Resonance 0
und geschlossene Gates. MAIN-only umfasst weiterhin die zehn Bank-Bänder;
„0 LOCAL“ bedeutet keine geöffneten lokalen Feedback-Gates.
Smoothing, TPT-State-Commit und Tuning bleiben unverändert.

Bestehende Early-outs unterdrücken bei Resonance 0/geschlossenen Gates alle
Newton-Iterationen. Smoother-/Filter-/Affine-Arbeit bleibt notwendig; ein Gate
wird während seiner Abklingzeit nicht als bereits mathematisch null behandelt.
Vorallokierte Per-Band-Workspaces und bestehende Fallbacks werden beibehalten.
Die veröffentlichte Coupled-Iterationszahl enthält einen zusätzlichen
Convergence-Zähler und kann 7 sein; das ist nicht sieben Newton-Updates.
Fallback-Zähler zählen betroffene Solves, nicht die Zahl einzelner Bisection-
Schritte. Diese vorhandenen Telemetrie-Semantiken werden nicht umdefiniert.

`feedbackAllEngine=legacy` bleibt bewusst erhalten. Es ist über DEV/LAB, State/
Snapshots, Wrapper-/Worklet-Defaults und historische Vergleiche erreichbar.
CURRENT MAIN verwendet dort verzögerte per-Band-Returns mit der bestehenden
1/√10-Normalisierung; das ist hörbar verschieden vom Common-Bus-MAIN.
Die vorhandenen Tests belegen implizites = explizites Legacy samplegenau und
isolieren dessen Verhalten von den neuen MAIN-LAB-Reglern. AudioEngine bleibt
defaultmäßig CURRENT/Common Bus. ZDF-Cores verwenden ihre impliziten MAIN-
Gleichungen unabhängig vom Legacy-Selector. Eine Migration oder Entfernung
wäre eine zusätzliche Produkt-/Klangentscheidung; keine ist für P2 erforderlich.

## Messwerte

### Native Gesamtmatrix

Alle Zeiten in ms, Dezimalpunkt. Diese Einzelmatrix und die separat wiederholten
A/B-Paare duerfen nicht zu einer universellen Prozentgarantie zusammengezogen werden.
Quelle: `p2-native-before-final` / `p2-native-after`. 0 Processorfehler, alle Ausgaben finite.

| Rate | Case | P50 before -> after | P99 before -> after | Mean after | Max after | Overbudget before -> after |
| --- | --- | --- | --- | --- | --- | --- |
| 48000 | idle | 0.214 -> 0.195 | 0.383 -> 0.276 | 0.194 | 0.584 | 0/574 -> 0/570 |
| 48000 | filterbank | 0.475 -> 0.440 | 0.788 -> 0.554 | 0.451 | 0.688 | 0/574 -> 0/577 |
| 48000 | filter | 0.476 -> 0.451 | 0.817 -> 0.582 | 0.456 | 0.766 | 0/581 -> 0/574 |
| 48000 | dynamic-eq | 0.666 -> 0.578 | 1.100 -> 1.105 | 0.624 | 1.164 | 0/585 -> 0/577 |
| 48000 | lfo-one | 0.531 -> 0.507 | 1.015 -> 0.945 | 0.534 | 3.020 | 1/581 -> 1/577 |
| 48000 | lfo-many | 0.555 -> 0.525 | 1.030 -> 0.981 | 0.557 | 3.249 | 1/581 -> 1/574 |
| 48000 | envelope | 0.521 -> 0.501 | 0.852 -> 0.881 | 0.525 | 0.992 | 0/581 -> 0/577 |
| 48000 | clock-mod | 0.516 -> 0.465 | 0.982 -> 0.775 | 0.486 | 1.317 | 0/577 -> 0/574 |
| 48000 | current-local | 0.562 -> 0.494 | 0.952 -> 0.839 | 0.521 | 0.927 | 0/577 -> 0/577 |
| 48000 | current-local-main | 0.589 -> 0.527 | 1.000 -> 0.893 | 0.553 | 0.977 | 0/584 -> 0/577 |
| 48000 | unified | 0.602 -> 0.516 | 1.058 -> 0.930 | 0.548 | 1.101 | 0/581 -> 0/581 |
| 48000 | per-band | 0.771 -> 0.690 | 1.356 -> 1.255 | 0.730 | 1.623 | 0/581 -> 0/577 |
| 48000 | tube | 0.576 -> 0.544 | 1.013 -> 0.848 | 0.544 | 1.025 | 0/577 -> 0/577 |
| 48000 | destroy | 0.764 -> 0.757 | 1.160 -> 1.109 | 0.759 | 1.206 | 0/585 -> 0/574 |
| 48000 | heavy | 0.837 -> 0.874 | 1.322 -> 1.487 | 0.891 | 1.914 | 0/581 -> 0/574 |
| 48000 | worst | 2.764 -> 2.703 | 4.668 -> 4.637 | 2.916 | 15.268 | 364/515 -> 322/526 |
| 48000 | diagnostics-linear | 0.790 -> 0.787 | 1.328 -> 1.175 | 0.792 | 1.432 | 0/577 -> 0/574 |
| 96000 | idle | 0.149 -> 0.132 | 0.282 -> 0.256 | 0.145 | 0.566 | 0/1155 -> 0/1155 |
| 96000 | filterbank | 0.410 -> 0.425 | 0.678 -> 0.707 | 0.432 | 0.802 | 0/1177 -> 0/1162 |
| 96000 | filter | 0.425 -> 0.422 | 0.712 -> 0.623 | 0.416 | 0.811 | 0/1170 -> 0/1158 |
| 96000 | dynamic-eq | 0.544 -> 0.564 | 0.913 -> 0.886 | 0.569 | 1.142 | 0/1169 -> 0/1162 |
| 96000 | lfo-one | 0.446 -> 0.466 | 0.785 -> 0.870 | 0.487 | 3.198 | 2/1162 -> 2/1170 |
| 96000 | lfo-many | 0.470 -> 0.466 | 0.784 -> 0.858 | 0.493 | 2.998 | 2/1162 -> 2/1163 |
| 96000 | envelope | 0.445 -> 0.475 | 0.725 -> 0.859 | 0.501 | 0.971 | 0/1168 -> 0/1155 |
| 96000 | clock-mod | 0.435 -> 0.450 | 0.742 -> 0.856 | 0.491 | 1.404 | 0/1170 -> 1/1170 |
| 96000 | current-local | 0.464 -> 0.498 | 0.779 -> 0.921 | 0.535 | 0.978 | 0/1164 -> 0/1170 |
| 96000 | current-local-main | 0.504 -> 0.522 | 0.824 -> 0.964 | 0.565 | 1.032 | 0/1162 -> 0/1162 |
| 96000 | unified | 0.501 -> 0.526 | 0.859 -> 0.967 | 0.569 | 1.035 | 0/1167 -> 0/1162 |
| 96000 | per-band | 0.663 -> 0.701 | 1.145 -> 1.256 | 0.753 | 1.361 | 2/1162 -> 1/1162 |
| 96000 | tube | 0.445 -> 0.434 | 0.796 -> 0.781 | 0.468 | 0.846 | 0/1162 -> 0/1163 |
| 96000 | destroy | 0.569 -> 0.557 | 0.963 -> 0.952 | 0.600 | 1.018 | 0/1185 -> 0/1161 |
| 96000 | heavy | 0.650 -> 0.760 | 0.951 -> 1.357 | 0.811 | 1.569 | 0/1155 -> 17/1166 |
| 96000 | worst | 1.877 -> 2.065 | 3.082 -> 4.150 | 2.238 | 10.193 | 787/787 -> 694/694 |
| 96000 | diagnostics-linear | 0.646 -> 0.742 | 0.864 -> 1.361 | 0.801 | 1.524 | 0/1159 -> 17/1173 |
| 96000 | heavy-transition:tube->destroy | 0.662 -> 0.800 | 0.950 -> 1.370 | 0.863 | 3.107 | 2/1170 -> 21/1169 |
| 96000 | heavy-transition:destroy->tube | 0.623 -> 0.701 | 0.858 -> 1.292 | 0.772 | 1.397 | 0/1170 -> 4/1181 |

Heavy: TUBE, Dynamic EQ CUT -30 dB, vier LFOs mit 12 Assignments (Free/Sync),
RMS-Envelope mit 40-ms-Delay/SPREAD, Clock Mod 123 BPM/20%, fuenf LOCAL-Gates,
MAIN, Resonance +0.6, Bandgain +3 dB, Dry/Wet 70%, Master -6 dB, Guard/Final Safety.
Worst: DESTROY, 32 Assignments, Dynamic EQ/Envelope/Clock, zehn LOCAL-Gates und
MAIN bei Resonance +1, Per-Band ZDF und lineare DEV-Diagnostik.
Der separate Heavy-Transition-Fall nutzt Dynamic EQ, fuenf Gates und MAIN +0.6,
ohne LFO/Envelope/Clock. Er ist kein identischer Ersatz fuer den kombinierten Heavy Case.

### Drei native 96-kHz-A/B-Runden

Median der drei Run-Metriken; Overbudget wird ueber die drei Runs summiert.
Max ist das groesste beobachtete Einzelmaximum. Quelle: `p2-native-paired`.

| Case | Mean before -> after | P99 before -> after | Max before -> after | Overbudget before -> after |
| --- | --- | --- | --- | --- |
| filterbank | 0.399 -> 0.413 | 0.656 -> 0.654 | 0.898 -> 0.769 | 0/3477 -> 0/3482 |
| per-band | 0.643 -> 0.649 | 1.041 -> 0.983 | 1.412 -> 1.239 | 1/3513 -> 0/3496 |
| tube | 0.417 -> 0.417 | 0.707 -> 0.668 | 0.996 -> 0.828 | 0/3499 -> 0/3494 |
| destroy | 0.528 -> 0.525 | 0.829 -> 0.791 | 0.974 -> 0.999 | 0/3510 -> 0/3494 |
| heavy | 0.697 -> 0.711 | 1.163 -> 1.159 | 1.496 -> 1.688 | 5/3500 -> 11/3504 |
| diagnostics-linear | 0.673 -> 0.697 | 1.166 -> 1.154 | 1.424 -> 1.363 | 2/3517 -> 1/3541 |
| heavy-transition:tube->destroy | 0.692 -> 0.724 | 1.120 -> 1.207 | 2.903 -> 2.614 | 9/3530 -> 13/3524 |
| heavy-transition:destroy->tube | 0.639 -> 0.654 | 1.122 -> 1.130 | 1.395 -> 1.577 | 3/3512 -> 13/3511 |

Heavy-P99-Reserve im Median: 12.78% vorher, 13.08% nachher. Die Mean-Zeit
ist etwas hoeher, und Ausreisser bleiben. Der einmalige Nachlauf hatte sogar
P99 1.357 ms und 17 Budgetueberschreitungen; kein belastbarer Gesamt-Heavy-Speedup.
DESTROY-P99 sank im Paarmedian von 0.829 auf 0.791 ms, die mittlere Zeit
nur von 0.528 auf 0.525 ms. Der FIR-Einzelgewinn wird im kompletten Graph relativiert.

### Native Input-Matrix

Filterbank mit +3 dB, ohne Resonance/Dynamic EQ/Assignments; Guard/Final Safety,
Dry/Wet 70%, Master -6 dB. Amount 0 und 1 sind jeweils echte Processor-Targets.
Die Transition-Zeilen enthalten auch Steady-Blöcke; ihre P99 beziehen sich
auf den ganzen Lauf, das separate Switch-Fenster ist in den JSON-Reports enthalten.

| Rate | Stage | Amount | Mode | Mean before -> after | P99 before -> after | Max after | Overbudget before -> after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 48000 | linear | 0 | steady | 0.466 -> 0.475 | 0.758 -> 0.750 | 0.897 | 0 -> 0 |
| 48000 | linear | 0 | transition:tape->linear | 0.485 -> 0.495 | 0.800 -> 0.747 | 0.916 | 0 -> 0 |
| 48000 | linear | 1 | steady | 0.472 -> 0.485 | 0.763 -> 0.772 | 0.992 | 0 -> 0 |
| 48000 | linear | 1 | transition:tape->linear | 0.567 -> 0.511 | 1.003 -> 0.892 | 1.049 | 0 -> 0 |
| 48000 | tape | 0 | steady | 0.604 -> 0.588 | 1.024 -> 0.982 | 1.121 | 0 -> 0 |
| 48000 | tape | 0 | transition:linear->tape | 0.572 -> 0.593 | 0.960 -> 1.079 | 1.671 | 0 -> 0 |
| 48000 | tape | 1 | steady | 0.532 -> 0.553 | 0.847 -> 0.951 | 1.055 | 0 -> 0 |
| 48000 | tape | 1 | transition:linear->tape | 0.538 -> 0.558 | 0.949 -> 0.934 | 1.680 | 0 -> 0 |
| 48000 | tube | 0 | steady | 0.535 -> 0.533 | 0.895 -> 0.830 | 0.949 | 0 -> 0 |
| 48000 | tube | 0 | transition:linear->tube | 0.529 -> 0.560 | 0.894 -> 0.926 | 1.748 | 0 -> 0 |
| 48000 | tube | 1 | steady | 0.517 -> 0.543 | 0.834 -> 0.834 | 0.940 | 0 -> 0 |
| 48000 | tube | 1 | transition:linear->tube | 0.545 -> 0.560 | 0.958 -> 0.979 | 1.781 | 0 -> 0 |
| 48000 | crunch | 0 | steady | 0.525 -> 0.550 | 0.836 -> 0.853 | 1.092 | 0 -> 0 |
| 48000 | crunch | 0 | transition:linear->crunch | 0.509 -> 0.552 | 0.833 -> 0.959 | 1.969 | 0 -> 0 |
| 48000 | crunch | 1 | steady | 0.513 -> 0.540 | 0.802 -> 0.833 | 0.980 | 0 -> 0 |
| 48000 | crunch | 1 | transition:linear->crunch | 0.525 -> 0.558 | 0.944 -> 0.971 | 1.481 | 0 -> 0 |
| 48000 | destroy | 0 | steady | 0.758 -> 0.854 | 1.078 -> 1.308 | 1.444 | 0 -> 0 |
| 48000 | destroy | 0 | transition:linear->destroy | 0.731 -> 0.805 | 1.272 -> 1.372 | 1.740 | 0 -> 0 |
| 48000 | destroy | 1 | steady | 0.755 -> 0.857 | 1.132 -> 1.268 | 1.422 | 0 -> 0 |
| 48000 | destroy | 1 | transition:linear->destroy | 0.798 -> 0.792 | 1.378 -> 1.308 | 2.726 | 0 -> 1 |
| 96000 | linear | 0 | steady | 0.464 -> 0.459 | 0.764 -> 0.771 | 0.927 | 0 -> 0 |
| 96000 | linear | 0 | transition:tape->linear | 0.459 -> 0.432 | 0.797 -> 0.794 | 0.969 | 0 -> 0 |
| 96000 | linear | 1 | steady | 0.484 -> 0.410 | 0.840 -> 0.714 | 0.981 | 0 -> 0 |
| 96000 | linear | 1 | transition:tape->linear | 0.430 -> 0.422 | 0.757 -> 0.785 | 0.929 | 0 -> 0 |
| 96000 | tape | 0 | steady | 0.427 -> 0.410 | 0.747 -> 0.730 | 0.945 | 0 -> 0 |
| 96000 | tape | 0 | transition:linear->tape | 0.421 -> 0.457 | 0.722 -> 0.792 | 0.975 | 0 -> 0 |
| 96000 | tape | 1 | steady | 0.412 -> 0.412 | 0.672 -> 0.680 | 0.785 | 0 -> 0 |
| 96000 | tape | 1 | transition:linear->tape | 0.441 -> 0.453 | 0.799 -> 0.780 | 0.933 | 0 -> 0 |
| 96000 | tube | 0 | steady | 0.403 -> 0.402 | 0.649 -> 0.673 | 0.816 | 0 -> 0 |
| 96000 | tube | 0 | transition:linear->tube | 0.414 -> 0.407 | 0.696 -> 0.682 | 0.833 | 0 -> 0 |
| 96000 | tube | 1 | steady | 0.419 -> 0.429 | 0.723 -> 0.754 | 0.886 | 0 -> 0 |
| 96000 | tube | 1 | transition:linear->tube | 0.415 -> 0.401 | 0.725 -> 0.650 | 0.982 | 0 -> 0 |
| 96000 | crunch | 0 | steady | 0.425 -> 0.416 | 0.689 -> 0.729 | 0.826 | 0 -> 0 |
| 96000 | crunch | 0 | transition:linear->crunch | 0.431 -> 0.405 | 0.686 -> 0.667 | 0.871 | 0 -> 0 |
| 96000 | crunch | 1 | steady | 0.416 -> 0.405 | 0.670 -> 0.682 | 0.796 | 0 -> 0 |
| 96000 | crunch | 1 | transition:linear->crunch | 0.458 -> 0.412 | 0.805 -> 0.735 | 1.003 | 0 -> 0 |
| 96000 | destroy | 0 | steady | 0.597 -> 0.504 | 0.905 -> 0.800 | 1.012 | 0 -> 0 |
| 96000 | destroy | 0 | transition:linear->destroy | 0.562 -> 0.490 | 0.909 -> 0.818 | 2.365 | 1 -> 1 |
| 96000 | destroy | 1 | steady | 0.595 -> 0.515 | 0.911 -> 0.796 | 1.121 | 0 -> 0 |
| 96000 | destroy | 1 | transition:linear->destroy | 0.608 -> 0.496 | 1.056 -> 0.840 | 2.018 | 1 -> 2 |

Alle Steady-Faelle blieben hier innerhalb des Budgets. Uebergaenge haben
vereinzelte Ausreisser, auch mit Amount 0. Der Maximalwert allein belegt
daher keine reine FIR-Ursache. Der native 96-kHz-DESTROY-Amount-1-Steady-Mean
dieser Matrix sank 0.595 -> 0.515 ms; die drei Wiederholungen oben zeigen,
dass dieser einzelne Lauf kein allgemein zugesicherter 13%-Graphgewinn ist.

### Isolierte Input-Phasen

Ungeprofilete Processor-Harness-Mittelwerte bei Amount 1; einzelne Block-Uhren
sind grob quantisiert. Warm/Fade-Werte dienen der Lokalisierung, nicht CI-Deadlines.
Amount-0-Versionen und Blockzahlen liegen ebenfalls in `p2-costs.json`.

| Rate | Stage | Steady before -> after | Warm before -> after | Fade before -> after |
| --- | --- | --- | --- | --- |
| 48000 | linear | 0.056 -> 0.075 | 0.133 -> 0.167 | 0.117 -> 0.140 |
| 48000 | tape | 0.119 -> 0.142 | 0.133 -> 0.133 | 0.117 -> 0.140 |
| 48000 | tube | 0.106 -> 0.126 | 0.067 -> 0.100 | 0.108 -> 0.129 |
| 48000 | crunch | 0.109 -> 0.131 | 0.133 -> 0.133 | 0.110 -> 0.131 |
| 48000 | destroy | 0.313 -> 0.339 | 0.300 -> 0.367 | 0.313 -> 0.337 |
| 96000 | linear | 0.028 -> 0.030 | 0.067 -> 0.033 | 0.040 -> 0.040 |
| 96000 | tape | 0.040 -> 0.042 | 0.033 -> 0.033 | 0.040 -> 0.039 |
| 96000 | tube | 0.030 -> 0.030 | 0.033 -> 0.033 | 0.033 -> 0.033 |
| 96000 | crunch | 0.034 -> 0.034 | 0.033 -> 0.033 | 0.036 -> 0.036 |
| 96000 | destroy | 0.138 -> 0.140 | 0.100 -> 0.167 | 0.139 -> 0.139 |

### Core-Kosten, fuenf LOCAL-Baender bzw. MAIN-only

Ms pro 128-Frame-Stereo-Bankblock, Median von fuenf 128-Block-Runden, 96 Warmblocks.
Band-Control 25 (= +3 dB), Resonance +/-0.7, gleiche Source und Optionen je A/B.
MAIN-only hat 0 offene LOCAL-Gates. Kein Input-/Safety-/Analyzer-Anteil.
Raten/Konfigurationen teilen Harness-JIT; native Core-Faelle stehen getrennt oben.

| Core | Sign | Route | 48k before -> after | 96k before -> after |
| --- | --- | --- | --- | --- |
| current-common | + | local | 0.790 -> 0.759 | 0.811 -> 0.765 |
| current-common | + | main | 0.791 -> 0.748 | 0.812 -> 0.759 |
| current-common | + | both | 0.827 -> 0.776 | 0.830 -> 0.805 |
| current-common | - | local | 0.826 -> 0.748 | 0.793 -> 0.764 |
| current-common | - | main | 0.774 -> 0.740 | 0.782 -> 0.756 |
| current-common | - | both | 0.834 -> 0.781 | 0.820 -> 0.802 |
| current-local | + | local | 0.785 -> 0.803 | 0.796 -> 0.809 |
| current-local | + | main | 0.805 -> 0.822 | 0.811 -> 0.817 |
| current-local | + | both | 0.825 -> 0.882 | 0.824 -> 0.860 |
| current-local | - | local | 0.825 -> 0.823 | 0.839 -> 0.847 |
| current-local | - | main | 0.809 -> 0.826 | 0.833 -> 0.830 |
| current-local | - | both | 0.873 -> 0.882 | 0.867 -> 0.966 |
| zdf | + | local | 0.772 -> 0.787 | 0.775 -> 0.795 |
| zdf | + | main | 0.777 -> 0.781 | 0.774 -> 0.766 |
| zdf | + | both | 0.837 -> 0.843 | 0.801 -> 0.827 |
| zdf | - | local | 0.809 -> 0.821 | 0.805 -> 0.847 |
| zdf | - | main | 0.775 -> 0.796 | 0.784 -> 0.802 |
| zdf | - | both | 0.816 -> 0.836 | 0.810 -> 0.852 |
| zdf-per-band | + | local | 0.765 -> 0.761 | 0.781 -> 0.780 |
| zdf-per-band | + | main | 0.941 -> 0.906 | 0.900 -> 0.877 |
| zdf-per-band | + | both | 1.054 -> 1.027 | 1.007 -> 0.995 |
| zdf-per-band | - | local | 0.773 -> 0.759 | 0.776 -> 0.765 |
| zdf-per-band | - | main | 0.887 -> 0.870 | 0.880 -> 0.895 |
| zdf-per-band | - | both | 0.986 -> 0.984 | 0.978 -> 0.978 |

### Band-Skalierung und Zusatzpfade

| Core | 1 LOCAL + MAIN | 2 LOCAL + MAIN | 5 LOCAL + MAIN | 10 LOCAL + MAIN |
| --- | --- | --- | --- | --- |
| current-common | 0.756 | 0.777 | 0.805 | 0.760 |
| current-local | 0.826 | 0.837 | 0.860 | 0.876 |
| zdf | 0.802 | 0.809 | 0.827 | 0.858 |
| zdf-per-band | 0.908 | 0.923 | 0.995 | 1.137 |

| Case | Rate | Before -> after |
| --- | --- | --- |
| current-common/+/both/5@44 | 44100 | 0.795 -> 0.769 |
| current-common/-/both/5@44 | 44100 | 0.806 -> 0.826 |
| current-local/+/both/5@44 | 44100 | 0.841 -> 0.857 |
| current-local/-/both/5@44 | 44100 | 0.871 -> 0.938 |
| zdf/+/both/5@44 | 44100 | 0.837 -> 0.814 |
| zdf/-/both/5@44 | 44100 | 0.815 -> 0.835 |
| zdf-per-band/+/both/5@44 | 44100 | 1.084 -> 1.069 |
| zdf-per-band/-/both/5@44 | 44100 | 0.999 -> 1.018 |
| legacy-main | 48000 | 0.793 -> 0.810 |
| legacy-main | 96000 | 0.797 -> 0.848 |
| isolated-tpt | 48000 | 0.764 -> 0.728 |
| isolated-tpt | 96000 | 0.757 -> 0.743 |

CURRENT und Unified skalieren moderat, weil die gesamte Bank weiter laeuft.
Gekoppeltes Per-Band-MAIN steigt mit Zahl der aktiven Variablen und Fallbacks.
Legacy bei 96 kHz ist in diesem JIT-Survey nicht schneller; es bleibt wegen
seines Vertrags und Vergleichsnutzens erhalten, nicht als neuer Default.

### Solver und Audio-Stress, 96 kHz

Separater Paritaets-Stimulus: ungleiches Stereo, Impuls +12/-3, danach Stille.
128 Bankbloecke = 32768 Kanal-Samples; Steady-CPU-Stimulus ist ein anderer.
Unified/LOCAL-Mittelwerte nutzen die vorhandenen Iterationszaehler; Coupled
zeigt akzeptierte aeussere Newton-Updates ohne Convergence-Extra-Zaehler.
Nested-Fallback-/Bisection-Schritte sind darin nicht einzeln instrumentiert.

| Case | Solver | Mean Newton/counter | Max | Max residual | Fallback solves | Active roots/variables per channel-sample |
| --- | --- | --- | --- | --- | --- | --- |
| zdf/+/local/5 | unified | 2.000 | 3 | 7.97e-9 | 0/32768 (0.0000%) | 1.0 |
| zdf/+/main/5 | unified | 3.314 | 4 | 1.00e-8 | 0/32768 (0.0000%) | 1.0 |
| zdf/+/both/5 | unified | 2.537 | 4 | 1.00e-8 | 0/32768 (0.0000%) | 1.0 |
| zdf/-/local/5 | unified | 1.982 | 3 | 9.99e-9 | 0/32768 (0.0000%) | 1.0 |
| zdf/-/main/5 | unified | 2.713 | 4 | 9.98e-9 | 0/32768 (0.0000%) | 1.0 |
| zdf/-/both/5 | unified | 2.725 | 4 | 9.99e-9 | 0/32768 (0.0000%) | 1.0 |
| zdf/+/both/1 | unified | 3.266 | 4 | 1.00e-8 | 0/32768 (0.0000%) | 1.0 |
| zdf/+/both/2 | unified | 2.752 | 4 | 1.00e-8 | 0/32768 (0.0000%) | 1.0 |
| zdf/+/both/10 | unified | 2.781 | 5 | 1.00e-8 | 1/32768 (0.0031%) | 1.0 |
| zdf-per-band/+/local/5 | local | 1.986 | 3 | 1.00e-8 | 0/163840 (0.0000%) | 5.0 |
| zdf-per-band/+/main/5 | coupled | 3.344 | 6 | 1.00e-8 | 1/32768 (0.0031%) | 1.0 |
| zdf-per-band/+/both/5 | coupled | 2.184 | 6 | 1.00e-8 | 0/32768 (0.0000%) | 6.0 |
| zdf-per-band/-/local/5 | local | 1.885 | 3 | 1.00e-8 | 0/163840 (0.0000%) | 5.0 |
| zdf-per-band/-/main/5 | coupled | 1.714 | 6 | 9.98e-9 | 1/32768 (0.0031%) | 1.0 |
| zdf-per-band/-/both/5 | coupled | 1.729 | 6 | 1.00e-8 | 1/32768 (0.0031%) | 6.0 |
| zdf-per-band/+/both/1 | coupled | 3.270 | 6 | 1.00e-8 | 1/32768 (0.0031%) | 2.0 |
| zdf-per-band/+/both/2 | coupled | 2.636 | 6 | 1.00e-8 | 1/32768 (0.0031%) | 3.0 |
| zdf-per-band/+/both/10 | coupled | 3.103 | 6 | 1.00e-8 | 1101/32768 (3.3600%) | 11.0 |

Resonance 0 und geschlossene Gates: 0 Newton-Iterationen, 0 Residual, 0 Fallbacks
bei Unified/Per-Band, mit exakt erhaltener Filter-/Smoother-State-Entwicklung.
Synthetic Worst bei 44.1/48 kHz erreicht bereits vorher Residual 2.96e-7 /
3.75e-7 und 36487 / 32152 gekoppelte Fallbacks. Nachher identisch; keine
Nonfinite-Resets. Diese Extremwerte werden weder versteckt noch durch
weichere Toleranzen oder geaenderte Solver-DSP repariert.

| 96k signed both/5 | Raw bank peak | Tail energy (sum squares) |
| --- | --- | --- |
| current-common/+/both/5 | 13.463 | 1.0300e+5 |
| current-common/-/both/5 | 10.398 | 6.5540e-3 |
| current-local/+/both/5 | 11.503 | 5.0121e+4 |
| current-local/-/both/5 | 10.468 | 3.9907e-3 |
| zdf/+/both/5 | 13.888 | 9.8801e+4 |
| zdf/-/both/5 | 9.243 | 5.7542e-3 |
| zdf-per-band/+/both/5 | 12.222 | 5.1744e+4 |
| zdf-per-band/-/both/5 | 9.469 | 3.4833e-3 |

Alle gemessenen Output- und untersuchten DSP-States sind finite, beide Versionen
sample-identisch. Hoechster roher Bank-Peak der Impulsmatrix: 15.427669.
Der native Input-Graph hatte maximal 0.210567 am kontrollierten Final-Safety-Analyser.
Positive Self-Oscillation erzeugt bewusst anhaltende Tail-Energie; kein
erzwungener Tail-Vergleich zwischen unterschiedlichen Cores. Bestehende
High-Band-/Tuning-/Self-Oscillation-Tests pruefen deren jeweiligen Vertrag.

### Absolute Diagnose-/Safety-Szenariokosten

| Scenario | Rate | Graph before -> after |
| --- | --- | --- |
| diagnostics-linear | 48000 | 0.574 -> 0.567 |
| diagnostics-nonlinear | 48000 | 0.539 -> 0.534 |
| safety-telemetry | 48000 | 0.353 -> 0.336 |
| diagnostics-linear | 96000 | 1.082 -> 1.095 |
| diagnostics-nonlinear | 96000 | 1.041 -> 1.008 |
| safety-telemetry | 96000 | 0.763 -> 0.748 |

Linear-Diagnose: Common Bus +0.6, fuenf Gates + MAIN. Nonlinear-Diagnose:
isolated TPT +0.6 mit fuenf Gates. Diese absoluten Kosten sind keine saubere
Differenzmessung zwischen unterschiedlichen Topologien. Safety-Telemetrie
misst beide Output-Aggregationen bei ansonsten normalem Bank-Graph.

## Regression und Reproduktion

137 A/B-Szenarien vergleichen vollständige Float32-Ausgabe, RMS-Differenz,
Filter-/Feedback-/Solver-, TUBE-, Transition-, Clock-, LFO-, Envelope- und
Gain-State sowie veröffentlichte Nachrichten. Max difference = 0,
RMS difference = 0, States/Iterations/Residuals/Fallbacks identisch und finite.
Der Impuls-Stresstest verwendet ungleiche Stereo-Signale und anschließende
Stille; rohe Bank-Peaks dürfen höher als der geschützte Graph sein.
Bestehende Tuning-/Self-Oscillation-, Alias-, Latenz-, Warmup-/Fade- und
Start-Mute-Tests behalten ihre bisherigen Assertions.

Neue dauerhafte Dateien: `tests/dsp-performance.spec.js` (fünf Tests),
`tests/helpers/dsp-performance.cjs`. Die fünf Fälle betreffen Kosten/Profile,
nativen Graph, gepaarte CPU/Heap-/Gating-Probe, Audio-/State-/Solver-Parität
und Parameter-/Event-Verträge. Keine Tight-Timing-Gates.

Der erste Standardlauf hatte 245/246 Erfolge: der bestehende reale
Master → Guard → Safety-Test las nach seinem Reduction-Wait ein anderes
15-Hz-Fenster mit leisem Drum-Peak. Guard-Release kann dort noch Reduction
anzeigen. Der unveränderte Test scheiterte in 5/6 Wiederholungen sowohl mit
P2 als auch mit eingefrorenen P1-C-Dateien (Peak etwa 0,021–0,038 statt >0,5).
`tests/output-guard.spec.js` wartet nun auf alle bisherigen Bedingungen und
hält genau diesen Packet-Snapshot für die Assertions fest. Schwellen,
Timeouts, Guard-/Safety-DSP und alle späteren Routing-/Snapshot-Prüfungen
bleiben erhalten. Das stärkt die Beobachtung; es lockert keinen Audiovertrag.
Mit der Korrektur bestehen sechs Wiederholungen auf beiden DSP-Ständen
(12/12); der erneut durchgeführte Standardlauf besteht mit 246/246.

PowerShell; Performance-Messungen jeweils mit einem Worker und ohne parallele
CPU-Last. Alle Ausgaben liegen ausschließlich im ignorierten `tests/artifacts/`:

```powershell
npm.cmd run test:browser -- tests/dsp-performance.spec.js --workers=1 --output=tests/artifacts/p2-survey
$env:P2_NATIVE_BASELINE='1'
npm.cmd run test:browser -- tests/dsp-performance.spec.js --grep 'native production' --workers=1 --output=tests/artifacts/p2-before-new
Remove-Item Env:P2_NATIVE_BASELINE
$env:P2_NATIVE_INPUT='1'
# Diesen Aufruf einmal zusätzlich mit P2_NATIVE_BASELINE=1 ausführen.
npm.cmd run test:browser -- tests/dsp-performance.spec.js --grep 'native production' --workers=1 --output=tests/artifacts/p2-input-new
Remove-Item Env:P2_NATIVE_INPUT
$env:P2_NATIVE_PAIRED='1'
npm.cmd run test:browser -- tests/dsp-performance.spec.js --grep 'native production' --workers=1 --output=tests/artifacts/p2-pairs-new
Remove-Item Env:P2_NATIVE_PAIRED
```

Für neue Läufe frische Output-Verzeichnisse verwenden. Historische
`tests/measurements/`-Fixtures werden nicht überschrieben.

| Abschlussprüfung | Ergebnis |
| --- | --- |
| `npm.cmd run test:node` | 60/60 |
| Fokussierter P0-/P1-A-/DSP-Regressionsblock | 13/13 |
| Erste Stereo-/Streaming-Input-Integration | 3/3 |
| P2 Gating-/Parameter-Strukturblock | 2/2 |
| Guard-Test nach Korrektur, sechs Wiederholungen auf P1-C und P2 | 12/12 |
| Separate Kosten-/Heap-/native Vorher-/Nachher-Surveys | bestanden; Timing nur beobachtend |
| `npm.cmd run test:browser:smoke` | 10/10 |
| `npm.cmd run test:browser` ohne Quarantäne, finaler Wiederholungslauf | 246/246, 72 Specs, 14,9 min |
| Quarantäne | 14 unverändert, nicht ausgeführt |
| Full einschließlich Quarantäne | nicht ausgeführt |

Der finale Standardreport liegt lokal unter
`tests/artifacts/p2-final-standard-v2-report/report.json`. Der erste Standardlauf
(245/246) ist als reproduzierte Test-Race dokumentiert, nicht als DSP-Regression
umgedeutet. Keine Quarantäne wurde gelöst oder neu hinzugefügt.

Geänderte Produktionsdateien: `input-preamp-processor.js`,
`filterbank-processor.js`, `filterbank.js`. Neue Mess-/Paritäts-Helfer:
`tests/dsp-performance.spec.js`, `tests/helpers/dsp-performance.cjs`.
Zusätzlich: `tests/output-guard.spec.js`, `tests/QUARANTINE.md`,
`docs/BACKLOG.md` und dieser Bericht. Historische Mess-Fixtures, App/UI,
AudioEngine, State, Source-Cores, Routing und Output-Safety-Implementierungen
sind unverändert. `git diff --check` ist fehlerfrei; alle generierten Reports,
Traces und Screenshots liegen ausschließlich in ignorierten Artefaktpfaden.
Kein Commit, kein Push.

P1-B MIDI, Cross-Modulation/P2-Modulation und neue Produktfunktionen bleiben
offen. Keine neue Feedback-Topologie, kein anderer Default-Core, keine
Oversampling-Qualitätsreduktion, keine unbegründete Klangänderung, kein UI-
Redesign. Keine gelockerten Assertions und keine zusätzlichen Quarantänefälle.
Performance-Risiken in Heavy/DEV-Extremen sind quantifiziert; eine feste
hardwareunabhängige Reserve wird nicht behauptet.
