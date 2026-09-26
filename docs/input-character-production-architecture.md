# P3B.3 – Input Character: Produktionsarchitektur

Datum: 26.09.2026. Dies ist eine Architekturentscheidung mit ausführbarem Testprototyp. Die Anwendung lädt keinen der neuen Helfer. Produktions-DSP, P3B.1-Korrektur, Kennlinien, Input Gain, Filterbank, Dynamic EQ, Feedback und Schutzstufen wurden nicht geändert. Kein Commit, kein Push.

## Entscheidung: Differenzpfad C und Modell A

Empfohlen wird **globale feste Character-Latenz von 192 Host-Samples**, einschließlich LINEAR und Amount 0. Das ist eine bewusste Produktentscheidung zugunsten zeitlich stabiler Stage-Wechsel. Die zusätzliche Latenz beträgt 4.3537 ms bei 44.1 kHz, 4.0000 ms bei 48 kHz und 2.0000 ms bei 96 kHz. Bestehende Context-, Geräte-, MediaStream- und sonstige DSP-Latenzen kommen dazu. Die Entscheidung betrifft den gesamten Ausgang des Input-Character-Blocks, bevor sich der globale Dry-/Filterbank-Wet-Pfad aufteilt.

192 Samples sind bei den gewählten FIRs der gemeinsame kleinste unveränderte feste Delay für 2× und 4×. Oversampling allgemein erfordert nicht zwangsläufig genau diese Latenz; andere Filter würden eine neue Qualitäts- und Phasenentscheidung verlangen. Eine zeitlich direkte LINEAR-Route wäre mit diesem Vertrag unvereinbar. Sample-Transparenz bedeutet deshalb: **identische Float32-Werte nach Verschiebung um 192 Samples**, nicht Identität am ursprünglichen Sampleindex. Beim Start stehen 192 Nullen vor den Daten.

### Differenzpfad C, exakt

Mit Host-Eingang `x`, Upsampler `U_r`, Stage `N_r`, Downsampler `D_r`, Resampling-Delay `d_r` und Host-Padding `p_r = 192 - d_r` gilt:

```text
highDry = U_r(x)
highWet = N_r(highDry)
highCorrection = highWet - highDry
correction = delay(p_r, D_r(highCorrection))
dry = delay(192, x)
output = dry + smoothedAmount * correction
```

Die Differenz wird vor der Dezimation gebildet. `highDry` und `highWet` haben dieselbe Rate und denselben Zeitbezug. Sowohl der nichtlineare Anteil als auch der zu subtrahierende lineare Anteil durchlaufen denselben Downsampler. Amount wird einmal pro Host-Sample nach Downsampling und Padding angewendet; seine bestehende Zeitkonstante bleibt 15 ms.

2×: ein Up- und ein Down-FIR, `d_r = 128`, anschließend 64 Samples Padding ausschließlich auf der Korrektur. 4×: zwei Up- und zwei Down-FIRs, `d_r = 192`, kein zusätzliches Padding. LINEAR: keine Korrektur, direkte Ausgabe des gemeinsamen Dry-Delays. Die interne 2×-Historie läuft für TUBE-Handover auch bei LINEAR weiter, ist aber kein zusätzlicher LINEAR-Signalpfad.

Bei Amount 0 ist `output = dry`; eine identische Kennlinie liefert bei jedem Amount ebenfalls `dry`. Es werden keine zeitlich versetzten Dry- und Wet-Kopien desselben linearen Signals gegeneinander gemischt. Dadurch entfällt der latenzbedingte Kammfilter aus P3B.2. Die beabsichtigte Kennlinien-, TUBE-Hochpass- und FIR-Frequenzwirkung bleibt erhalten. C ist bewusst nicht exakt identisch mit ausschließlich gefiltertem Wet bei Amount 1: `output = filteredWet + delayedDry - filteredLinear`. Diese bekannte Eigenschaft des P3B.2-Pfads wird beibehalten.

## Vergleich der Latenzmodelle

| Kriterium | A: alle 192 | B: LINEAR 0, nonlinear 192 | C: LINEAR 0, 2× 128, 4× 192 |
|---|---|---|---|
| Stationärer Klang | C-Mix, LINEAR und Amount 0 wertneutral mit Delay | Gleicher C-Mix je nonlinear Stage; LINEAR direkt | Gleicher C-Mix je Stage mit jeweiligem Delay |
| Phase/Zeit | Gemeinsamer Zeitbezug; gewünschte Stage-Phase bleibt | LINEAR-Wechsel ändern Zeitbezug um 192 | Wechsel ändern Zeitbezug um 64, 128 oder 192 |
| Stage-Wechsel | Ausgerichteter Crossfade | Nonlinear↔nonlinear stabil; LINEAR↔nonlinear problematisch | TAPE↔TUBE stabil; alle Rate-Wechsel problematisch |
| Amount | 0–100 % ohne zusätzlichen Delaywechsel | Im festen nonlinear Zweig sauber; amountabhängiger Direkt-Bypass würde erneut springen | Im einzelnen Zweig sauber; Stage-Wechsel auch bei Amount 0 problematisch |
| Aufwand | Gemeinsamer Delay, Padding, branch warming | Zusätzlich Zeitbasiswechsel oder verdeckte globale Verzögerung | Zusätzlich dynamische Delay-/Resampling-Übergänge |
| CPU | Gemeinsame 2×-Historie und TUBE-State; active + target beim Wechsel | Gleiche wesentlichen FIR-Kosten; 192er Dry-Delay zu sparen bringt wenig | Gleiche wesentlichen FIR-Kosten; 64er Padding zu sparen bringt wenig |
| Wartbarkeit | Ein Zeitvertrag und ein State-Vertrag | Sonderfall LINEAR an allen Routing-/Wechselstellen | Drei Zeitverträge und zusätzliche Übergangsregeln |
| Entscheidung | **Empfohlen** | **Abgelehnt** | **Abgelehnt** |

Ein gewöhnlicher Crossfade zwischen zwei Verzögerungen hat bei halber Überblendung den Betragsgang `abs(cos(π f Δd / fs))`. Erste Nullstellen bei 48 kHz: Δd 192 → 125 Hz, 128 → 187.5 Hz, 64 → 375 Hz; bei 96 kHz jeweils doppelt. Die Nullstellen bestehen bereits bei Amount 0. Ein schrittweiser Delaywechsel erzeugt einen Zeitsprung; eine kontinuierliche Delayänderung verändert vorübergehend die Wiedergabegeschwindigkeit. B/C lassen sich somit nicht durch eine andere Fade-Kurve mit konstantem Zeitbezug versehen. Ein verstecktes durchgehendes 192er Alignment würde faktisch A realisieren.

## Filterentscheidung

Das P3B.2-Filter wird beibehalten: symmetrisches Kaiser-FIR, 257 Taps / Ordnung 256, Beta 8.6; Cutoff 0.2375, Passband-Ende 0.225 und Stopband-Beginn 0.25, jeweils bezogen auf die höhere Rate. Gemessene Ripple 0.000631 dB, Stopband mindestens 87.67 dB. 2×-Upsampling nutzt zwei Polyphasen und Faktor-2-Skalierung; Downsampling filtert vor jeder Halbierung. 4× besteht aus zwei 2×-Kaskaden. Keine automatische 8×-Stufe, kein anderer Filter als Teil dieses Tasks.

## Stage-Wechsel und Speicher

1. Gemeinsamer 192er Dry-Ring und erster 2×-Upsampler laufen durchgehend. Pro Stage liegen FIR-Ringe, Float32-Blöcke und Padding vorab im Pool. Ankommende Requests werden auf Render-Block-Grenzen übernommen.
2. Neuer stateless Korrekturzweig: nur dessen eigene FIR-/Padding-Historie leeren und **384 Host-Samples / drei 128er Blöcke** mit dem realen aktuellen Eingang vorlaufen lassen. Der alte Zweig bleibt hörbar. Vorlaufzeit: 8 ms bei 48 kHz, 4 ms bei 96 kHz. Der Vorlauf füllt die endlichen Zweighistorien vollständig.
3. Danach beide bereits ausgerichteten Ausgaben linear überblenden: `old + w * (new - old)`, `w = 1 + exp(-1/(fs*0.015)) * (w - 1)`. Die bisherige 15-ms-Zeitkonstante und Schwelle `w > 0.9999` bleiben erhalten. Der praktische Fade dauert etwa 138 ms; Abschluss und Freigabe des alten Zweigs erfolgen an der nächsten Blockgrenze.
4. Keine Equal-Power-Kurve und keine Gain-Normalisierung hinzufügen: lineare Gewichte summieren sich zu eins. Unterschiedliche RMS/Peaks verschiedener Kennlinien sind beabsichtigter Klang. Bei gleichphasigen identischen Ausgaben gibt es keinen Fade-Pegelverlust.
5. Weitere Requests während Vorlauf/Fade: nur das zuletzt gewünschte Ziel merken. Nach Abschluss beginnt dessen eigener Vorlauf/Fade. Nie einen halb überblendeten Zweig hart ersetzen. Ein Stage-Request setzt weder Amount noch Gain noch den gemeinsamen Delay zurück.

| Wechsel | Modell A | Problem in B/C |
|---|---|---|
| LINEAR → TAPE | Beide 192; TAPE vorwärmen | B: 192er Sprung; C: 128er Sprung |
| TAPE → TUBE | Beide 192; TUBE-FIR vorwärmen, DC-State live | Kein Delayproblem; kalter/gefrierender TUBE-State wäre ein separates Artefakt |
| TUBE → DESTROY | Beide 192; 4×-Zweig vorwärmen, TUBE weiterführen | C: 64er Sprung |
| DESTROY → SILK | Beide 192; SILK vorwärmen | C: 64er Sprung |
| DESTROY → LINEAR | Beide 192; Korrektur ausblenden | B/C: 192er Sprung |

Die Proof-Tests prüfen diese fünf Wechsel bei 44.1/48/96 kHz, allen drei Modellen und 0/50/100 % Amount: 135 Kombinationen. Stereo bleibt exakt identisch und alle Ausgaben sind finite. Im empfohlenen Modell ist Amount 0 über sämtliche Wechsel exakt der 192 Samples verzögerte Eingang. Bei Amount 50 % wird zusätzlich der gesamte Fade gegen durchgehend warme alte/neue Referenzzweige geprüft; dies trennt Zustands-/Warmup-Artefakte vom beabsichtigten Kennlinienwechsel. Der erste Sample-Sprung im Datensatz enthält auch die normale Signalsteigung und ist keine isolierte Klickmessung. Eine psychoakustische Hörfreigabe wird daraus nicht behauptet.

Der Testprototyp legt alle DSP-Arrays beim Konstruktor an. Seine Reset-Hilfslisten entstehen noch beim Stage-Request; die spätere Produktionsimplementierung soll auch diese Listen vorab halten. Keine Speicherallokation, Filterkonstruktion, Modul-Ladung oder State-Kopie im Audio-Sample-Loop. Filterkoeffizienten werden geteilt, Historien pro Kanal und Zweig getrennt gehalten.

## TUBE-State-Vertrag

**Eine durchgehend gespeiste TUBE-Instanz bei 2× Host-Rate**, auch wenn eine andere Stage oder Amount 0 aktiv ist. Ihr DC-State wird einmal pro internem Sample fortgeschrieben. Beim Eintritt wird kein alter 1×-State kopiert und kein kalter State sichtbar gemacht; der aktuelle 2×-TUBE-Ausgang wird nur in den neu vorgewärmten Korrektur-Downsampler geleitet. Beim Austritt bleibt die TUBE-Instanz erhalten und wird weiter gespeist. Das zusätzliche Upsampling-/tanh-Budget ist im Lasttest enthalten, einschließlich LINEAR.

`tubeDcPole = pow(0.9987, 48000 / internalSampleRate)` wird einmal beim Anlegen berechnet. Kennlinie, Bias 0.18 und Drive 1.3 bleiben unverändert. Der analoge Pol entspricht immer `-48000 * ln(0.9987)/(2π) = 9.937729373500819 Hz`.

| Host-Rate | TUBE-Rate | DC-Pol | Analoger Referenz-Cutoff |
|---:|---:|---:|---:|
| 44.1 kHz | 88.2 kHz | 0.9992923072766219 | 9.937729373500819 Hz |
| 48 kHz | 96 kHz | 0.9993497886125758 | 9.937729373500819 Hz |
| 96 kHz | 192 kHz | 0.9996748414422440 | 9.937729373500819 Hz |

Der bestehende 1×-48-kHz-Pol bleibt exakt 0.9987. Höhere interne Rate verändert diskrete Abtastung und Kennlinienbandbreite, bewahrt aber das analoge DC-Zeitverhalten. Ein eingefrorener State müsste sonst nach Rückkehr einen veralteten Offset abklingen lassen. Ein harter Reset beim hörbaren Wechsel könnte einen neuen Hochpass-Einschwingvorgang auslösen.

Panic folgt dem bestehenden `AudioEngine.panic()`: Feedback/Resonanz zurücknehmen, global Dry/Wet und Input Gain rampen; Character-Stage/-Amount werden derzeit nicht zurückgesetzt. **TUBE-State, Upsampler und gemeinsamer Delay bleiben beim Panic erhalten** und erhalten weiter den tatsächlich gerampten Eingang. Eine Stop-/Context-Neuanlage oder Sample-Rate-Änderung erstellt alle Historien neu bei stummgeschaltetem Ausgang, füllt sie vor und blendet anschließend ein. Kein Reset im laufenden hörbaren Pfad. Der Ein-Sekunden-Test mit konstantem Eingang prüft einen kontinuierlich inaktiven TUBE-State; kleine interne Alternation durch Polyphasen-Ripple darf nicht als wachsender DC-Offset interpretiert werden.

**Startvertrag:** Bei Context-Neuanlage den bestehenden Master-Gain zunächst auf 0 halten, die gesamte DSP-Kette mindestens 250 ms mit dem vorhandenen Eingang verarbeiten und den Master danach über 10 ms auf den gewünschten Pegel rampen. Bei fehlendem Eingang werden Nullen weiterverarbeitet. Dies deckt FIR-Füllung und den im Trace sichtbaren anfänglichen JIT-Aufwand ab; 250 ms sind ein einmaliger stummer Startvorlauf, keine weitere stationäre Signallatenz. Ein Stage-Wechsel im bereits laufenden Context verwendet ausschließlich den 384-Sample-Zweigvorlauf. Keine kalte Initialisierung beim hörbaren Wechsel.

## Finaler Stage-Vertrag

| STAGE | RATE | LATENCY MODEL | STATE STRATEGY |
|---|---|---|---|
| LINEAR | 1× | A, 192 Host-Samples | Gemeinsamer Dry-Ring; keine Korrektur; 2×-TUBE-Historie bleibt live |
| SILK | 2× | A, 128 + 64 = 192 | Stateless Kennlinie; Korrektur-FIR/64er Pad bei Eintritt 384 Samples vorwärmen |
| TAPE | 2× | A, 128 + 64 = 192 | Stateless Kennlinie; Korrektur-FIR/64er Pad vorwärmen |
| TUBE | 2× | A, 128 + 64 = 192 | Kontinuierlicher separater Stereo-DC-State; nur Korrektur-FIR/Pad vorwärmen |
| CONSOLE | 2× | A, 128 + 64 = 192 | Stateless Kennlinie; Korrektur-FIR/64er Pad vorwärmen |
| CRUNCH | 2× | A, 128 + 64 = 192 | Stateless Kennlinie; Korrektur-FIR/64er Pad vorwärmen |
| DESTROY | 4× | A, 192 | Zweite Up-Stufe + beide Down-Stufen bei Eintritt 384 Samples vorwärmen |

Diese Tabelle ist der Architekturvorschlag; eine CPU-Freigabe muss zusätzlich den folgenden Mess- und Budgetabschnitt erfüllen.

## Klangbudget und DESTROY-Entscheidung

**YES: verbleibendes Aliasing bei extremer DESTROY-Ansteuerung wird als Teil des Effekts akzeptiert.** DESTROY ist der harte Clip-/Fold-Effekt des Produkts. Es erhält keinen Anspruch auf aliasfreie Sättigung bei maximalem Input Gain. Das ist die festgelegte Produktcharakteristik; 4× bleibt konstant. Weder Input Gain begrenzen noch die Kennlinie glätten oder einen automatischen 8×-Modus hinzufügen.

Die normale P3B.2-Matrix deckt Post-Gain-Peaks 0.03/0.25/0.8, sechs Testfrequenzen und 44.1/48/96 kHz ab. Maximal identifizierbares Alias/Fundamental bei 100 % Amount: SILK 2× 0.000448 %, TAPE 2× 0.1340 %, TUBE 2× 0.1447 %, CONSOLE 2× 0.4381 %, CRUNCH 2× 1.0943 %, DESTROY 4× 0.2847 %. Damit werden die fünf 2×-Stages als Produktkompromiss freigegeben; besonders CRUNCH ist ein härterer Effekt mit messbarem Rest-Aliasing. Eine identische Qualitätszusage für beliebige +24-dB-Ansteuerung wird daraus nicht abgeleitet.

Zusatzmessung P3B.3: 10-kHz-Sinus, Source-Peak 0.25, 100 % Amount, 100-ms-kohärentes Fenster nach 250 ms Einschwingen. Werte sind `100 * sqrt(identifizierbare Aliasleistung / Fundamentalleistung)`; wegen Rückfaltung auf bestehende Harmonische/Fundamental eine Untergrenze. Ein schwaches Fundamental bei Fold-Verzerrung kann das Verhältnis über 100 % treiben; es ist keine Prozentangabe der gesamten Ausgangsleistung.

| Input Gain | Post-Gain-Peak | 4× Alias/Fundamental 44.1 kHz | 48 kHz | 96 kHz |
|---:|---:|---:|---:|---:|
| 0 dB | 0.2500 | 0.0000125 % | 0.0000062 % | 0.0000017 % |
| +6 dB | 0.4988 | 0.0000493 % | 0.0000234 % | 0.0000027 % |
| +12 dB | 0.9953 | 0.2778 % | 0.3207 % | 0.0849 % |
| +24 dB | 3.9622 | 2.3112 % | 2.1365 % | 0.6565 % |

Das moderate +6-/+12-dB-Profil bleibt damit im vorgesehenen Klangbereich. Entscheidend ist der Pegel nach Gain, nicht allein die Reglerstellung. Der bereits gemessene härtere P3B.2-Stress mit Source-Peak 0.8 plus 24 dB erreicht 12.679 Peak vor der Kennlinienbegrenzung und maximal **33.40 %** identifizierbares Alias/Fundamental bei 4×. Dies wird ausdrücklich akzeptiert. Die dortigen 16×-/32×-Vergleiche waren ebenfalls keine perfekte aliasfreie Referenz. Die neue Entscheidung setzt keine automatische Qualitätsumschaltung voraus.

## Gesamter DSP-Lastfall und Messverfahren

Gemessen wird Stereo mit der tatsächlichen Produktionsklasse der 10-Band-Filterbank, deren echten `tpt-svf.js`-/Dynamic-EQ-Abhängigkeiten sowie den unveränderten Output-Guard-/Final-Safety-Klassen. Filterbank-Optionen werden aus `Filterbank.create()` mit einem echten `AudioEngine.getFilterbankState()` übernommen und vollständig im JSON gespeichert; keine vereinfachte Ersatzfilterbank.

Last: FILTERBANK aktiv, alle zehn Bandregler 25 (= +3 dB), Feedback an Bändern 2/4/6 (nullbasiert) und MAIN auf beiden Kanälen, Resonance 0.55; normale `common-bus`-Topologie mit `current`-Core und TPT-Resonanz. Dynamic EQ CUT aktiv, Threshold −30 dB, übrige normalisierte Defaults. Character Amount 50 %, Input Gain +6 dB, globales lineares Dry/Wet 30/70, Master −6 dB. Quelle ist ein Stereo-Multitone mit periodischem abklingendem 7-kHz-Transient. Guard ist an, Threshold 0.8, Attack 2 ms, Release 250 ms; Final Safety ist an, Threshold 0.8, Softness 1. Schutz-Telemetrie bleibt wie im normalen Engine-Default aus. Dynamic-EQ-Telemetrie bleibt mit normaler Publikationsrate aktiv.

Alle sechs verlangten Stages werden bei 48 und 96 kHz gemessen, außerdem TUBE→DESTROY mit gleichzeitigem altem/neuem Zweig. Der Prototyp nutzt eine serielle testinterne Graph-Hülle im echten AudioWorklet. Die DSP-Klassen selbst werden unverändert eingebettet; ihre internen Port-Stubs werden für Dynamic EQ an den realen Harness-Port weitergereicht. Beide Stereo-Analyzer-Taps (Character und Filterbank-Wet) besitzen jeweils zwei native Analyzer mit FFT 2048 und werden per requestAnimationFrame abgefragt. Für den CPU-Test wird der Gerätausgang stummgeschaltet; die gesamte DSP-Verarbeitung läuft davor weiter.

Gegenprobe: Die serielle LINEAR-Graph-Ausgabe wird bei beiden Raten über 8192 Samples mit echten getrennten Worklet-Nodes für Filterbank/Guard/Safety sowie nativen GainNodes verglichen. Die maximale Differenz beträgt 5.960464477539063e-8. Der zusätzliche Character-Delay ist in der nativen Vergleichsquelle berücksichtigt. Die P3B.2-Gegenprobe sichert separat die unveränderten Stage-Klassen gegenüber dem Browser-Worklet ab.

Drei Messschichten werden getrennt gespeichert:

- **Entscheidungsmaß: nativer Chromium-Audio-Trace**, `RealtimeAudioDestinationHandler::Render` mit `frames=128`. Hochauflösende Wall-Dauer des realen Renderaufrufs einschließlich Harness und nativer Graph-Zweige. Pro Fall zwei Sekunden echter AudioContext-Betrieb, erste 250 ms als Warmup getrennt. Die Trace-Zeitstempel ordnen die Fälle anhand `AudioDestination::StartWithWorkletTaskRunner` zu. Tracing verursacht zusätzlichen Messaufwand.
- **Zusätzliche Browser-Replays:** vollständige DSP-Kette mit `performance.now()`, drei Versuche pro Fall, jeweils 256 Warmup- und 384 Messblöcke. Native Analyzer fehlen hier; Port-Nachrichten werden gezählt. Diese Main-Thread-Zeiten reagieren anders auf JIT und Scheduling und sind keine AudioWorklet-Deadline-Messung. Klassen werden pro Rate wiederverwendet wie im Worklet, nicht pro Versuch neu definiert.
- **Worklet-interne Kontrolle:** aufsummiertes `Date.now()` um die DSP-Kette, reale Telemetrie, Finite-/Peak-Prüfung und `currentFrame`-Kontinuität. Im verwendeten AudioWorklet fehlt `performance.now()`; die Date-Dauer ist millisekundenquantisiert. Mittelwert und State-Kontrollen unterstützen den Trace, ersetzen ihn aber nicht. Kontinuierliches `currentFrame` beweist keine fehlerfreie Geräteausgabe.

Die CPU-Freigabe verwendet hier als explizites Komfortkriterium mindestens **30 % Reserve am p99**, einschließlich des gemessenen Stage-Wechsels, und berichtet zusätzlich jede Budgetüberschreitung sowie Maxima. `budgetMs = 128000 / sampleRate`; `reservePercent = 100 * (1 - p99Ms / budgetMs)`. Zwei-Sekunden-Fenster sind eine Architekturprüfung auf diesem Rechner, kein Nachweis für alle Geräte oder lange Sessions. Die unveränderte App-Graph-Organisation mit mehreren Worklet-Nodes kann beim späteren Einbau zusätzlichen Scheduling-Aufwand besitzen; die Freigabe ist an eine gleichwertige Gesamtpfad-Messung des tatsächlichen Einbaus gebunden.

### Native Audio-Thread-Ergebnisse

Rechner: AMD Ryzen 7 5700X, 16 logische CPUs, Windows x64, Headless Chromium 153.0.8010.12 / Playwright; Node v24.20.0. Blockbudget: 2.666667 ms bei 48 kHz, 1.333333 ms bei 96 kHz. Letzter vollständiger Lauf, Werte nach 250 ms Warmup:

| Stage | 48 kHz p99 | Reserve | 96 kHz p99 | Reserve |
|---|---:|---:|---:|---:|
| LINEAR | 0.518 ms | 80.58 % | 0.570 ms | 57.25 % |
| TAPE 2× | 0.648 ms | 75.70 % | 0.573 ms | 57.03 % |
| TUBE 2× | 0.598 ms | 77.58 % | 0.544 ms | 59.20 % |
| CONSOLE 2× | 0.647 ms | 75.74 % | 0.583 ms | 56.28 % |
| CRUNCH 2× | 0.657 ms | 75.36 % | 0.567 ms | 57.48 % |
| DESTROY 4× | 0.821 ms | 69.21 % | 1.028 ms | **22.90 %** |
| TUBE→DESTROY, gesamtes Messfenster | 0.848 ms | 68.20 % | 0.873 ms | 34.53 % |
| TUBE→DESTROY, separates 0.4–0.8-s-Wechselfenster | 0.993 ms | **62.76 %** | 0.937 ms | **29.73 %** |

Das separate Fenster umfasst Vorlauf, vollständigen Fade und benachbarte Render-Bursts. Damit wird der Wechsel nicht durch lange stationäre Abschnitte verdünnt. Der frühere Trace-Lauf hatte bei DESTROY 96 kHz 36.85 % Reserve und beim gesamten Wechsel 34.53 %; die Wiederholung zeigt relevante Laufvariabilität. Es wird der letzte vollständige Datensatz berichtet und kein günstiger Einzelversuch zur Freigabe ausgewählt.

In 13.885 nach Warmup ausgewerteten Renderblöcken gab es eine Budgetüberschreitung: DESTROY 96 kHz, Maximum 1.438 ms bei 1.333333 ms Budget (1 von 1.330 Blöcken dieses Falls). Die übrigen Fälle hatten keine Überschreitung. Das Wechselfenster hatte ebenfalls keine; Maxima 1.228 ms bei 48 kHz und 1.200 ms bei 96 kHz. Alle 14 Live-Fälle blieben finite, ohne Processor-Error und ohne `currentFrame`-Lücke; jeweils 30 Dynamic-EQ-Telemetrienachrichten und aktive Analyzer-Abfragen. Größter Ausgangspeak 0.6128906. Dies beweist keine Abwesenheit von Geräte-Underruns.

**Startverhalten:** erste Renderaufrufe bis 7.855 ms, deutlich oberhalb des Blockbudgets. Sie dürfen nicht als stationärer CPU-Wert unterschlagen werden. Der oben festgelegte 250-ms-Mute-/10-ms-Ramp-Startvertrag ist deshalb Teil der notwendigen Produktionsarchitektur. Der Prototyp misst diese Startspitzen, implementiert aber keinen produktiven Startablauf.

**CPU-Entscheidung:** 48 kHz **YES** auf dem gemessenen Rechner nach Startvorlauf; kleinste p99-Reserve einschließlich Wechselfenster 62.76 %. 96 kHz **NO** für das vollständige vorgeschlagene Stage-Set nach dem festgelegten Komfortkriterium: DESTROY 22.90 %, Wechselfenster 29.73 %. Die getesteten 2×-Stages sind bei 96 kHz einzeln komfortabel; daraus folgt keine Freigabe für den erforderlichen 4×-Gesamtbetrieb. Main-Thread-Replay oder quantisierte Date-Mittelwerte dürfen diese Entscheidung nicht überstimmen.

## GO / NO-GO: alle elf Antworten

| Nr. | Frage | Entscheidung |
|---:|---|---|
| 1 | Differenzpfad C produktionsreif? | **YES als Signal-/Mix-Architektur.** FIR-Streaming, Neutralität und ausgerichteter Fade sind nachgewiesen; der testinterne Controller ist kein ausgeliefertes Produktionsmodul. |
| 2 | Empfohlenes Latenzmodell? | **A: global fixed 192 Host-Samples.** |
| 3 | 192 Samples global akzeptabel/technisch notwendig? | **YES akzeptiert.** Für unveränderte 2×-/4×-FIRs mit gemeinsamem Zeitbezug sind 192 der erforderliche gemeinsame Delay; kein universelles Oversampling-Minimum. |
| 4 | LINEAR sample-transparent möglich? | **YES, wert-/Float32-transparent nach 192 Samples Delay**, bei allen getesteten Amounts; keine direkte zeitgleiche Transparenz. |
| 5 | Amount 0 sample-transparent möglich? | **YES nach gleichem Delay**, auch durch alle fünf Stage-Wechsel. |
| 6 | Stage-Wechsel ohne Artefakte lösbar? | **YES für zusätzliche Delay-, Warmup- und State-Artefakte in A.** Vorlauf und warmer Referenzfade sind numerisch nachgewiesen; beabsichtigte Kennlinien-Pegel-/Phasenänderungen bleiben. |
| 7 | 2× für SILK/TAPE/TUBE/CONSOLE/CRUNCH ausreichend? | **YES im festgelegten Effektkontext und normalen/moderaten Pegelbereich.** CRUNCH-Rest-Aliasing wird als harter Effekt akzeptiert; keine pauschale Clean-Zusage bei Extrem-Drive. |
| 8 | 4× für DESTROY ausreichend? | **YES klanglich im vorgesehenen Produktkontext**, einschließlich bewusst akzeptiertem extremem Aliasing. Keine automatische 8×-Stufe. |
| 9 | CPU-Budget 48 kHz ausreichend? | **YES nach stummem Startvorlauf auf dem gemessenen Rechner**, mindestens 62.76 % p99-Reserve einschließlich Wechselfenster. |
| 10 | CPU-Budget 96 kHz ausreichend? | **NO für das Gesamt-Stage-Set**, DESTROY und Wechselfenster unterschreiten 30 % Komfortreserve. |
| 11 | Produktionsimplementierung freigeben? | **NO.** Die Klang-, Latenz-, Mix-, Switching- und State-Entscheidungen sind festgelegt; der 96-kHz-CPU-Blocker bleibt. |

### Präziser verbleibender Blocker und Freigabekriterium

Der **96-kHz-Gesamtpfad mit 4× DESTROY** besitzt im wiederholten nativen Lasttest keine belastbare ≥30-%-p99-Reserve. Stationär werden dafür höchstens 0.933333 ms p99 benötigt; gemessen wurden 1.028 ms. Im getrennten Wechselfenster wurden 0.937 ms gemessen. Dazu kommt ein einzelner stationärer Budget-Ausreißer. Die kurze Messdauer und die unterschiedliche Reserve zwischen Läufen erlauben keine komfortable Produktionsfreigabe.

Nächster abgegrenzter Task: CPU des gleichwertigen FIR-/Graph-Prototyps optimieren und den nativen Gesamtpfad bei 96 kHz wiederholt länger messen, jeweils einschließlich aller sechs verlangten Stages und des getrennten Wechselfensters. Mögliche Kostenoptimierung ist das Ausnutzen der FIR-Symmetrie bei unveränderten Koeffizienten; keine Kennlinienänderung, Filterverkürzung oder Herabsetzung von DESTROY auf 2× als stillschweigender Ersatz. Erforderlich: beide 96-kHz-p99-Werte ≤0.933333 ms mit stabiler Reserve über die Wiederholungen sowie ausdrücklich ausgewertete Maxima/Budget-Ausreißer. Anschließend den geplanten stummen Start und die tatsächliche Produktions-Graph-Organisation mitmessen. Ein Geräte-/Langzeittest bleibt Teil der späteren Releaseprüfung.

Es bestehen keine offenen Produktentscheidungen zu globaler Latenz oder extremem DESTROY-Aliasing. Die Startup-Mute-Strategie ist entschieden und beim späteren Einbau umzusetzen. Der aktuelle Task optimiert oder implementiert diesen Produktionspfad ausdrücklich nicht.

## Nachweise, Dateien und Tests

Neue Messdaten: [input-character-production-architecture.json](../tests/measurements/input-character-production-architecture.json). Der Datensatz enthält die 135 Wechselkombinationen, TUBE-Pole, LINEAR-Neutralität, inaktiven DC-State, moderate DESTROY-Gains, vollständige Filterbank-Optionen, drei Replay-Versuche je Fall, Live-Worklet-Kontrollen, native Render-Statistik inklusive Startup und separates Wechselfenster.

Nachgewiesene numerische Ergebnisse: Amount 0 in Modell A und LINEAR bei 0/25/50/75/100 % Amount haben maximale Float32-Differenz **0** zum verzögerten Eingang. Stereo-Differenz **0** in allen 135 Fällen. Zielzweig nach Vorlauf gegen durchgehend warmen Zielzweig: Differenz **0**. Maximaler Fehler des gesamten 50-%-Fades gegen warme Referenzen **5.9542488051178566e-8**; nach vollständigem Fade Fehler **0**. Inaktiver TUBE-State bei konstantem 0.4-Eingang: keine Zunahme nach FIR-Warmup; nach einer Sekunde interner phasenabhängiger Rest etwa 2.48e-7, begrenzt durch Polyphasen-Ripple. Panic behält State exakt; neu angelegter Kontext mit Null-Eingang bleibt Null.

Geänderte Dateien:

- `docs/input-character-production-architecture.md` – dieser Entscheidungsbericht.
- `tests/helpers/input-character-architecture.cjs` – ausschließlich Testcontroller für A/B/C, Handover und Vorlauf.
- `tests/helpers/input-character-full-graph.cjs` – Testbundle aus tatsächlichen Produktionsklassen und native Worklet-Hülle.
- `tests/helpers/input-character-oversampling.cjs` – zusätzlich `Up2Stream` und `Down2Stream` exportiert; bestehende Implementierung unverändert.
- `tests/input-character-production-architecture.spec.js` – drei neue Architektur-/Mess-Tests.
- `tests/measurements/input-character-production-architecture.json` – reproduzierbarer finaler Datensatz.

Ausgeführte finale Testläufe:

```powershell
npx.cmd playwright test tests/input-character-production-architecture.spec.js --workers=1 --output "$env:TEMP\da_filta-p3b3-final"
# 3 passed (1.3m)

npx.cmd playwright test tests/input-character-oversampling.spec.js tests/input-character-tube-dc-rate.spec.js tests/input-character-audit.spec.js --workers=1 --output "$env:TEMP\da_filta-p3b3-regression"
# 5 passed (16.5s)
```

Zusätzlicher nativer Trace-Messlauf: 1 passed. Frühe Entwicklungsläufe dienten der Messvalidierung; eine ursprünglich zu strenge Null-State-Grenze von 1e-12 wurde nach Nachweis des etwa 2.48e-7 großen Polyphasen-Restes auf die begründete 1e-6-Bounded-State-Prüfung angepasst. Die finalen Tests sind vollständig grün. Das ist eine funktionale Testfreigabe und hebt den berichteten CPU-NO-GO nicht auf.

`tests/input-character-audit.spec.js` blieb unverändert und besteht weiter. Bytevergleich gegen HEAD bestätigt unveränderte Dateien: `input-preamp-processor.js`, `filterbank-processor.js`, `dynamic-eq-core.mjs`, `tpt-svf.js`, `output-guard-processor.js`, `output-protection-processor.js`, `audio-engine.js`, `filterbank.js`. `git diff --check` ist sauber. Kein Commit, kein Push.
