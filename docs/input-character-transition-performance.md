# P3B.5 – Stage-Transition-Performance

## Profiling vor der ersten Optimierung

Die unveränderte P3B.4 wurde am 26.09.2026 zuerst gemessen und bytegleich
als `tests/helpers/input-character-architecture-p3b4.cjs` eingefroren.
SHA-256: `b2696a8a7a69b8219ac8ccca1f6bfdd968cd63d5343389cbe1e46511bca03230`.
Rohdaten: `tests/measurements/input-character-transition-performance.json`.
Diese Sektion wurde vor dem Optimierungsprototyp angelegt.

Native Chromium-Render-Messung, 96 kHz, vollständiger Graph mit zehn Bändern,
Feedback, Dynamic EQ, Guard, Safety, Analyzern und Telemetrie:

| Wechsel | p99 im Fenster 400–800 ms | Reserve | Überschreitungen im Fenster |
|---|---:|---:|---:|
| TUBE → DESTROY | 0.943 ms | 29.275 % | 1 |
| TAPE → DESTROY | 1.011 ms | 24.175 % | 1 |
| DESTROY → TAPE | 1.073 ms | 19.525 % | 1 |
| DESTROY → TUBE | 0.926 ms | 30.550 % | 0 |

### Aufteilung A–F

Ergänzende isolierte Mikroprofile: fünf Durchläufe je Wechsel, 512 Blöcke
Vorbereitung, 32 stationär, drei Warmup-Blöcke, 104 Fade-Blöcke, 53 danach.
Zahlen unten sind Mediane der mittleren Zeit pro Fade-Block, inklusive
Timer-Instrumentierung; sie erklären die Arbeit, nicht einzelne native p99-Ausreißer.
Die Kategorien überlappen: A umfasst z. B. Shape, FIR und Padding.

| Beitrag | Messung und Einordnung |
|---|---|
| A: alte/neue Verarbeitung | TAPE kostet während des Fades zusätzlich ca. 0.023–0.024 ms; TUBE-Korrektur aus dem kontinuierlichen Cache ca. 0.002–0.004 ms. Gesamtgraph TAPE→DESTROY: vorher 0.380, Fade 0.473, danach 0.446 ms. DESTROY→TAPE: vorher 0.457, Fade 0.480, danach 0.385 ms. Beide Korrekturzweige werden benötigt. |
| B: Resampling | Geteiltes Up2: 0.042–0.043 ms; DESTROY-Down2: 0.045–0.046 ms. Bei 96 kHz gibt es keinen zusätzlichen zweiten Up2 und keinen zweiten Down2 für TAPE/TUBE. Diese FIR-Arbeit ist auch stationär vorhanden. Unterschiedliche Korrektursignale dürfen keine Downsample-State-Historie teilen. |
| C: Warmup/Reset | Drei verdeckte Blöcke kosten Gesamtgraph-Median 0.457–0.583 ms/Block. Reset einmal pro Wechsel; keine TUBE-Initialisierung. Warmup und Fade verarbeiten dieselben zwei Zweige. Die kleinen Stichproben zeigen keine verlässlich zurechenbare native Tail-Ursache. |
| D: Fade/Amount/Dry | Gesamter Host-Loop im Fade ca. 0.0026–0.0028 ms. Isoliert: Amount und Fade-Gewicht je ca. 0.00031 ms; Dry-Ring 0.0010–0.0013 ms; Mix 0.0011–0.0012 ms. Die isolierten Zeiten sind nicht additiv. |
| E: redundante Parameter | Original-`process()` gegenüber unverändertem `shape()` mit gleicher Rundung: TUBE 0.02327→0.01041 ms, TAPE 0.02080→0.00797 ms, DESTROY 0.04591→0.01992 ms. Median paarweiser Einsparung: 0.01360/0.01270/0.02588 ms. Interne Amount-, Gain- und Stage-Metadaten-Schleifen laufen trotz konstant 1/0/fester Stage; Host-Amount und Host-Fade bleiben notwendig. |
| F: Speicher/Arrays | Input-Kopien ca. 0.00014–0.00024 ms/Zweig, 1×-Correction-Kopie ca. 0.00029–0.00053 ms; Correction 0.00058–0.00245 ms, Padding 0.00082–0.00207 ms/Zweig. Reset erzeugt zwei temporäre Array-Listen. Normaler Blockpfad verwendet bereits vorallokierte TypedArrays. |

Stage- und Gain-Smoothing sind im bestehenden `process()` gemeinsam gemessen;
ihre individuellen Anteile werden nicht aus den Daten erfunden. Branching ist
Teil der gemessenen Schleifen. Der native Trace löst deren einzelne JS-Funktionen
nicht auf. Der Wechsel-Peak ist daher nicht vollständig kausal aufgeteilt:
zusätzliche Zweigarbeit ist messbar, die hohen nativen Ausreißer können auch
JIT/Thread-Scheduling enthalten. Eine reine Crossfade-Rechenkosten-Erklärung
wird durch die Mikroprofile nicht gestützt.

### Konsequenzen vor Implementierung

1. Zuerst konstante interne Parameter-Verarbeitung durch direkte, unveränderte
   Shape-Aufrufe ersetzen; die Float32-Zwischenrundung bleibt erhalten.
2. Danach gezielt gemessene Input-/Correction-Kopien, doppelte identische Dry-Lesezugriffe,
   Modulo und Reset-Array-Listen reduzieren. Unabhängige FIR-States bleiben bestehen.
3. Warmup bleibt 384 Host-Samples: bereits kontinuierlich gepflegt sind Up2 und
   TUBE. Gefüllt werden neue branch-private FIR- und Padding-Historien. Die
   Historienprobe findet nach 384 Samples bei 48/96 kHz exakt gleiche Korrektur
   wie beim vorgefüllten Zweig. 384 ist der bestehende Drei-Block-Vertrag, keine
   nachgewiesene minimale FIR-Länge; eine Verkürzung würde den Handover ändern.
   Die Arbeit ist bereits auf drei 128er-Blöcke verteilt. Alle Stages dauerhaft
   zu rendern würde den stationären Aufwand erhöhen.

Reset-Mediane je Wechsel: TUBE→DESTROY 0.025 ms, TAPE→DESTROY 0.010 ms,
DESTROY→TAPE/TUBE jeweils 0.005 ms. Diese einmaligen Kosten sind keine
Erklärung für sämtliche langsamen Render-Blöcke im 400-ms-Fenster.

## Implementierte Optimierungen – ausschließlich Testprototyp

**Schritt 1 (`shape`):** direkte Aufrufe der originalen `shape()`-Funktionen
anstelle der vollständigen internen `process()`-Schleife. Bias, Drive, Clamp,
Kennlinien und TUBE-DC-Verarbeitung kommen unverändert aus der Produktionsquelle.
Entfallen sind interne Gain-Metadaten-, Amount- und Stage-Fade-Updates sowie
die Prüfung eines intern bereits abgeschlossenen Fades. Deren Werte sind in
diesem Kern konstant 0/1/1; die wirklichen Host-Updates bleiben unverändert.
Beide originalen arithmetischen Schritte bis zur Float32-Ausgabe bleiben stehen,
auch `oldShaped + 1 * (oldShaped - oldShaped)` und
`sample + 1 * (shaped - sample)`. Der erste Schritt ist separat eingefroren in
`input-character-architecture-shape.cjs`, damit die Ablation reproduzierbar ist.

**Schritt 2 (`lean`):** zusätzlich Input-Kopien für 1×/2× entfernt, nur lesend
auf vorhandene Float32-Host-/Up2-Daten zugegriffen. Bei 1× wird der vorallokierte
Shaped-Buffer auch als Correction-Buffer verwendet, ohne zusätzliche Kopie.
Padding und Dry-Ring verwenden Inkrement/Wrap statt Modulo. Beide Stages lesen
denselben 192er Dry-Sample einmal. Blockweit konstante Fade-/Target-Bedingungen
werden einmal ermittelt. Die Reihenfolge `first`, `second`, `first+w*(second-first)`
bleibt unverändert; keine algebraische Fusion, keine Änderung der Rundung.
Reset-Listen werden im Constructor vorbereitet und beim Wechsel indiziert
durchlaufen. Keine neue Stage-Instanz und keine neuen TypedArrays beim Wechsel.

Die TUBE-Cache-Kopie bleibt erforderlich: Korrektur-Subtraktion darf dessen
kontinuierlich gespeiste Samples nicht verändern. Jeder Downsampler behält seine
eigene Historie. Up2 war bereits gemeinsam; die Optimierung behauptet keine
zusätzliche FIR-Einsparung. FIR-Kernel und ursprüngliche Stream-Klassen wurden
in P3B.5 nicht geändert: 257 Taps, Kaiser β=8.6, dieselben Koeffizienten.

### State, Warmup und Allokationen

Alle Stage-Objekte existierten schon in P3B.4 dauerhaft. Neu ist nur, dass die
Listen der zu löschenden branch-privaten Speicher ebenfalls vorgehalten werden.
Reset betrifft ausschließlich den neuen Zweig; alter Zweig, geteilter Up2 und
TUBE-State bleiben bestehen. Panic und Request-Coalescing sind erhalten.
TUBE läuft einmal pro Block kontinuierlich weiter, auch in LINEAR und bei Amount 0.

Bei 96k braucht der 1×-Zweig seinen 192er Padding-Ring; DESTROY braucht Down2
und 64er Padding. Bei 48k hat der neue 4×-Zweig zusätzlich private Up4-/Down4-
Historien. Die vorhandenen drei Warmup-Blöcke bleiben unverändert. Bei allen
sechs Historienproben enthält der zweite gemessene Block noch Unterschiede,
der dritte ist vollständig identisch zur warmen Referenz. Daraus folgt keine
Behauptung, 384 sei die mathematisch kürzeste mögliche Wartezeit. Verkürzung
oder Vorziehen des Fades würde den bestehenden Audio-Vertrag ändern.

Quellprüfung des optimierten Character-Pfads: keine `new Array`, `Array.from`,
`map/filter/reduce`, Objekt-Literale, Spread, TypedArray-Erzeugung, Slice oder
dynamischen Closures in `process`, `runBranch`, `resetBranch`, `fixedProcess`
oder dem übernommenen `request`. Constructor-Listen und Buffer werden einmal
angelegt. Die Profilierungsinstrumentierung und die Testauswertung erzeugen
Objekte; sie laufen nicht im gemessenen optimierten AudioWorklet-Kern.
Das ist eine Quellprüfung, keine Aussage, dass Chromium/Telemetrie nie allokiert.

## Numerische Regression nach jedem Schritt

Je Schritt: **240 Render-Fälle**, 44.1/48/96 kHz, sieben stationäre Stages,
neun Übergänge, jeweils Amount 0/25/50/75/100 %. Darunter alle vier kritischen
Wechsel, LINEAR-Wechsel und TAPE→TUBE. Pro Übergang 20.480 Frames, einschließlich
Warmup und abgeschlossenem Fade. Asymmetrische Stereo-Signale mit DC, drei
Frequenzen und Transienten; zusätzliche +24-dB-Extrem-, Automation-, Request-
Coalescing- und Panic-Proben. Referenz ist ausschließlich die eingefrorene P3B.4.

| Vergleich | max Sample-Differenz | RMS-Differenz | Peak-Differenz | Float32-Bit-Differenzen |
|---|---:|---:|---:|---:|
| Schritt 1, alle 240 Fälle | 0 | 0 | 0 | 0 |
| Schritt 2, alle 240 Fälle | 0 | 0 | 0 | 0 |
| TUBE → DESTROY, alle Raten/Amounts, beide Schritte | 0 | 0 | 0 | 0 |
| TAPE → DESTROY, alle Raten/Amounts, beide Schritte | 0 | 0 | 0 | 0 |
| DESTROY → TAPE, alle Raten/Amounts, beide Schritte | 0 | 0 | 0 | 0 |
| DESTROY → TUBE, alle Raten/Amounts, beide Schritte | 0 | 0 | 0 | 0 |

Host-Amount, Fade-Gewicht, aktive/angeforderte/queued Stage, Warmup-Zähler und
Dry-Position wurden blockweise exakt verglichen. TUBE PreviousInput/PreviousOutput
bleiben auch in Float64 exakt identisch (maximale State-Differenz 0).
21 Identitätsimpuls-Proben pro Schritt: einzige Ausgabe bei Sample 192, kein
weiterer Impuls, Stereo-Differenz 0. Amount 0 und LINEAR sind exakt delayed-dry.
Damit entstehen keine neuen Delay-/Phasen- oder Kammfilterfehler; für die übrige
Klangantwort gilt zusätzlich die bitidentische Ausgabe gegenüber P3B.4.
Die bestehende Paarprüfung für Phase/Gain bei 48/96k wurde erneut bestanden.

21 nichtlineare Stereo-/Extremproben je Schritt: keine NaN/Infinity, identische
Kanäle bei identischem Eingang. DC-Zustand wächst unter konstantem Eingang
nicht (0 Anstiege nach Einschwingen) und klingt unter 1e-8 ab.
Adaptive Matrix exakt erhalten: 44.1/48k normal 2×, DESTROY 4×; 96k normal 1×,
DESTROY 2×; LINEAR immer 1×. Interne TUBE-Rate = Host-Rate × TUBE-Faktor,
Pol `pow(0.9987,48000/internalRate)`, effektiver Cutoff **9.9377293735 Hz**.
Kein 8×, keine Änderung an Input Gain, globalem Dry/Wet oder anderen DSP-Modulen.

## Native Performance nach Optimierung

Windows x64, Ryzen 7 5700X / 16 logische CPUs, Chromium 153.0.8010.12,
Node 24.20.0. Identischer vollständiger P3B.4-Graph mit tatsächlichen
Filterbank-Optionen; native Analyzer und Telemetrie aktiv. CDP zeichnet die
vollständigen Render-Ereignisse auf, ausgewertet wird
`RealtimeAudioDestinationHandler::Render` mit 128 Frames.
Main-Thread-Replays und `Date.now()` im Worklet entscheiden nicht über GO.

Baseline und Schritt-1-Ablation: je acht Fälle à 2 Sekunden. Finaler `lean`-
Prototyp: **drei vollständige unabhängige Läufe**, je acht Fälle à 4 Sekunden.
Erste 250 ms separat behandelt; Wechsel bei ca. 500 ms, konservatives
Wechselfenster 400–800 ms, jeweils 300 native Blöcke. Es wurden keine Läufe
verworfen und keine günstigen einzelnen Fenster ausgewählt.

### Vorher / nachher – kritische Wechsel

OLD ist der neue unveränderte P3B.4-Baseline-Lauf, NEW der jeweils schlechteste
Fenster-p99 aus allen drei finalen Läufen. Überschreitungen OLD: ein Lauf;
NEW: Summe aller drei Läufe. Das sind unterschiedliche Laufumfänge.

| CASE | OLD p99 ms | OLD Reserve % | NEW p99 ms | NEW Reserve % | Budgetüberschreitungen OLD / NEW |
|---|---:|---:|---:|---:|---:|
| TUBE → DESTROY | 0.943 | 29.275 | 0.943 | 29.275 | 1 / 3 |
| TAPE → DESTROY | 1.011 | 24.175 | 0.967 | 27.475 | 1 / 3 |
| DESTROY → TAPE | 1.073 | 19.525 | 1.027 | 22.975 | 1 / 0 |
| DESTROY → TUBE | 0.926 | 30.550 | 1.078 | 19.150 | 0 / 0 |

Zum historischen P3B.4-Lauf: 1.036/0.973/1.003/0.850 ms für dieselbe
Tabellenreihenfolge. Auch dessen Rohdaten bleiben im neuen Datensatz erhalten.
Die Unterschiede zwischen historischem und frischem Baseline-Lauf zeigen,
warum ein günstiger Einzelvergleich keine reproduzierbare Freigabe begründet.

### Sämtliche Wiederholungsläufe – Fenster-p99 / Reserve / Überschreitungen

| Wechsel | Lauf 1 | Lauf 2 | Lauf 3 |
|---|---|---|---|
| TUBE → DESTROY | 0.937 ms / 29.725 % / 1 | 0.943 ms / 29.275 % / 1 | 0.917 ms / 31.225 % / 1 |
| TAPE → DESTROY | 0.967 ms / 27.475 % / 1 | 0.938 ms / 29.650 % / 1 | 0.929 ms / 30.325 % / 1 |
| DESTROY → TAPE | 0.960 ms / 28.000 % / 0 | 1.027 ms / 22.975 % / 0 | 1.000 ms / 25.000 % / 0 |
| DESTROY → TUBE | 1.078 ms / 19.150 % / 0 | 0.949 ms / 28.825 % / 0 | 0.955 ms / 28.375 % / 0 |

Stationär, schlechtester p99 über alle drei Läufe:

| Stage | OLD p99 / Reserve | NEW p99 / Reserve | NEW Überschreitungen |
|---|---|---|---:|
| LINEAR | 0.659 ms / 50.575 % | 0.699 ms / 47.575 % | 0 |
| TAPE | 0.679 ms / 49.075 % | 0.666 ms / 50.050 % | 0 |
| TUBE | 0.665 ms / 50.125 % | 0.737 ms / 44.725 % | 0 |
| DESTROY | 0.775 ms / 41.875 % | 0.773 ms / 42.025 % | 0 |

Finale Läufe: 22.612 + 22.612 + 22.628 = **67.852 ausgewertete Blöcke**, insgesamt
**6 Budgetüberschreitungen**, alle in den Wechseln zu DESTROY. Maximaler
Render-Block nach dem Startvorlauf **1.788 ms** bei 1.333333-ms-Budget.
Startup-Maxima 8.921/8.919/8.338 ms; der Startvorlauf ist ausdrücklich nicht in
den sechs Überschreitungen oder dem p99 enthalten. Die Anzahl von Startup-
Überschreitungen wurde vom übernommenen Messer nicht erfasst. Daher sind die
sechs keine Gesamtzahl einschließlich Startup und kein Beleg für sicheren
Gerätestart. Alle Live-Ausgaben finite, kein Processor-Error, Analyzer/Telemetrie
aktiv. Native Graph-Gegenprobe maximal 5.960464477539063e-8 Sample-Differenz.
`currentFrame`-Kontinuität beweist keine Abwesenheit von Geräte-Underruns.

Der schlechteste **Gesamtfall-p99 nach Startup** ist nur 0.838 ms / 37.150 %;
er verdeckt die schlechteren Wechselwerte. Deshalb entscheidet das separat
ausgewertete Fenster. Keiner der drei Läufe erfüllt alle vier Wechsel-Gates.

### Wie viel brachte welcher Schritt?

Schritt 1 spart im isolierten paarweisen Mikroprofil ca. 13.60 µs TUBE,
12.70 µs TAPE und 25.88 µs DESTROY je Host-Block. Im ergänzenden Gesamtgraph-
Replay sinkt stationärer DESTROY-p50 von 0.455 auf 0.420 ms, TAPE von 0.380
auf 0.350 ms. Native stationäre DESTROY-p99 sinkt zunächst 0.775→0.731 ms.
Das sind getrennte Läufe; keine reine kausale p99-Prozentrechnung.

| Wechsel | Baseline p99 ms | nur Schritt 1 p99 ms | Änderung |
|---|---:|---:|---:|
| TUBE → DESTROY | 0.943 | 1.001 | +0.058 ms |
| TAPE → DESTROY | 1.011 | 0.930 | −0.081 ms |
| DESTROY → TAPE | 1.073 | 0.913 | −0.160 ms |
| DESTROY → TUBE | 0.926 | 0.867 | −0.059 ms |

Schritt 2 entfernt nachgewiesene kleine Speicher-/Ringkosten, bringt aber
**keine belegte zusätzliche p99-Verbesserung**. Mediane der drei finalen
Fenster-p99 gegenüber Schritt 1: TUBE→DESTROY −0.064 ms,
TAPE→DESTROY +0.008 ms, DESTROY→TAPE +0.087 ms,
DESTROY→TUBE +0.088 ms. Im ergänzenden Replay bleibt DESTROY-p50 ungefähr
0.420 ms. Die Ablation zeigt deshalb keinen belastbaren Grund, die zusätzliche
`lean`-Variante bereits für Produktion zu wählen. Beide Varianten bleiben
als überprüfbare Testprototypen erhalten.

## Abschlussfragen

| Nr. | Antwort |
|---:|---|
| 1 | Messbare Mehrarbeit: zweiter Korrekturzweig, besonders TAPE mit nochmals voller interner Parameter-/Shape-Schleife. Hauptursache der großen **nativen Tail-Peaks noch nicht eindeutig aufgelöst**; die kleinen Host-Mix-Zeiten erklären sie nicht. |
| 2 | Konstante interne Gain-/Amount-/Stage-Updates entfernt; anschließend Input-/1×-Correction-Kopien, identische Dry-Doppellesungen, Modulo und temporäre Reset-Listen. |
| 3 | DSP-Ausgabe unverändert: in allen gemessenen Fällen Float32-bitidentisch, max/RMS/Peak-Differenz 0. |
| 4 | Differenzpfad C identisch, einschließlich Float32-Zwischenrundung. |
| 5 | Global 192 Host-Samples identisch; auch LINEAR und Amount 0. |
| 6 | TUBE-State exakt identisch in Float64; kontinuierlich gespeist, unveränderter Cutoff, kein wachsender DC-State. |
| 7 | Worst-Case p99 bei 96k: **1.078 ms**, DESTROY→TUBE, Lauf 1, separates Wechselfenster. |
| 8 | Worst-Case Reserve **19.150 %**. |
| 9 | **6** Überschreitungen in 67.852 Blöcken nach Startup; Startup-Maximum separat 8.921 ms, Startup-Anzahl nicht erfasst. |
| 10 | **NO**, ≥30 % nicht reproduzierbar; ≥35 % ebenfalls nicht erreicht. |
| 11 | Produktionsimplementierung freigeben: **NO**. |

### Exakter nächster Blocker

Alle vier finalen Worst-Case-Wechsel überschreiten das 0.933333-ms-p99-Ziel:
TUBE→DESTROY um 0.009667 ms, TAPE→DESTROY um 0.033667 ms,
DESTROY→TAPE um 0.093667 ms, DESTROY→TUBE um **0.144667 ms**.
Hinzu kommen reproduzierte einzelne Deadline-Verletzungen bei beiden Wechseln
zu DESTROY, Maximum 1.788 ms. Klang, Matrix, FIR, Delay und State sind keine
verbleibenden Blocker.

Nächster abgegrenzter Schritt: die langsamen **nativen** Blöcke exakt an
Request, Reset, die drei Warmup-Blöcke und den Fade binden und dort die
Restkosten auflösen. Die aktuellen Mikroprofile rechtfertigen keine weitere
blind gewählte Shape-, FIR- oder Warmup-Vereinfachung. Scheduling, JIT und GC
sind mit diesen Daten keine bewiesenen Ursachen. Ein zusätzlicher Beleg für
kleinere durchschnittliche JS-Kosten genügt nicht; benötigt werden die vier
wiederholt bestandenen Fenster-Gates und explizite Deadline-Zähler.

## Geänderte Dateien und ausgeführte Tests

Neu in P3B.5:

- `docs/input-character-transition-performance.md`
- `tests/helpers/input-character-architecture-p3b4.cjs` – unveränderte Referenz
- `tests/helpers/input-character-architecture-shape.cjs` – eingefrorener Schritt 1
- `tests/helpers/input-character-architecture-optimized.cjs` – Schritt 2
- `tests/helpers/compare-input-character-transition.cjs`
- `tests/helpers/profile-input-character-transition.cjs`
- `tests/input-character-transition-performance.spec.js`
- `tests/measurements/input-character-transition-performance.json`

Erweitert: `tests/helpers/input-character-full-graph.cjs` und
`tests/helpers/measure-input-character-full-graph.cjs` um wählbare Prototypen,
Raten, Cases und Messdauer. Default-Verhalten der alten Tests bleibt erhalten.
Die Produktionsquellen, Engine-/Routing-Dateien und der Audit-Test sind
bytegleich zu HEAD. Frühere uncommittete P3B.3/P3B.4-Dateien bleiben bestehen.

Ausgeführt, jeweils ein Worker und Ausgabe im temporären Verzeichnis:

```powershell
npx.cmd playwright test tests/input-character-transition-performance.spec.js --workers=1 --output "$env:TEMP\da_filta-p3b5-profile"
# 1 passed: Datei enthielt zu diesem Zeitpunkt nur den Baseline-Profiltest.
# Für dessen gezielte Wiederholung heute: --grep 'profile unchanged'

npx.cmd playwright test tests/input-character-transition-performance.spec.js --grep 'shape:' --workers=1 --output "$env:TEMP\da_filta-p3b5-shape"
# 2 passed: numerische Regression nach Schritt 1 und native Ablation

npx.cmd playwright test tests/input-character-transition-performance.spec.js --grep 'lean:' --workers=1 --output "$env:TEMP\da_filta-p3b5-lean"
# 4 passed: numerische Regression nach Schritt 2 und drei native Wiederholungen

npx.cmd playwright test tests/input-character-transition-performance.spec.js tests/input-character-adaptive-oversampling.spec.js tests/input-character-production-architecture.spec.js tests/input-character-oversampling.spec.js tests/input-character-tube-dc-rate.spec.js tests/input-character-audit.spec.js --grep-invert 'profile unchanged|native complete|adaptive alias|adaptive full DSP|complete production DSP' --workers=1 --output "$env:TEMP\da_filta-p3b5-regression"
# 12 passed: beide Optimierungen und bestehende Regressionen einschließlich Audit

npx.cmd playwright test tests/input-character-transition-performance.spec.js --grep 'shape: numeric' --workers=1 --output "$env:TEMP\da_filta-p3b5-frozen-shape"
# 1 passed: Gegenprobe des eingefrorenen Schritt-1-Snapshots
```

Damit sind 17 unterschiedliche funktionale/Messablauf-Tests abgedeckt; ein
bestandener Messablauf behauptet ausdrücklich nicht, das Performance-Gate sei
bestanden. Die alten P3B.3/P3B.4-JSON-Dateien wurden für deren schreibende
Regressionstests gesichert und anschließend bytegleich wiederhergestellt.
Syntaxprüfungen der neuen/erweiterten Helfer und `git diff --check` sind sauber.
Kein Commit, kein Push, keine Produktionsintegration.
