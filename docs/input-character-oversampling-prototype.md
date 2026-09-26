# P3B.2 — Input Character Oversampling: Prototyp und Messung

Datum: 26.09.2026. Der Produktionspfad und die P3B.1-TUBE-Korrektur wurden unverändert gelassen. Der Prototyp befindet sich ausschließlich unter `tests`. Es wurden weder Kennlinien noch Gain-Kompensation eingeführt.

## Aufbau und Reproduzierbarkeit

`tests/helpers/input-character-oversampling.cjs` lädt die unveränderte Produktionsklasse aus `input-preamp-processor.js` in einen isolierten JS-Kontext. `process()` und sämtliche Character-Kennlinien stammen aus dieser Datei. Für die internen Raten wird der Worklet-Globalwert `sampleRate` entsprechend gesetzt; ein Browser-AudioContext mit 384/768 kHz ist dafür nicht erforderlich. Die Browser-Gegenprobe reproduziert den echten 1×-Worklet bei allen sieben Stages und 44.1/48/96 kHz innerhalb von 2e-7 Sample-Differenz.

Upsampling: Null-Einfügung, Rekonstruktions-FIR und Faktor-2-Skalierung. Downsampling: Anti-Aliasing-FIR vor jeder Halbierung der Rate. 4× und höhere Faktoren bestehen aus kaskadierten 2×-Stufen. Die schnelle Offline-Faltung verwendet FFTs; ein kausaler Streaming-Prototyp mit vorab angelegten Ringspeichern und 128-Frame-Blöcken verwendet dieselben Koeffizienten. Seine Ausgabe stimmt mit der Offline-Version in den TUBE/DESTROY-Prüfungen innerhalb von 5.8e-8 überein. Der Streaming-Pfad benötigt keine FFT, Dateizugriffe oder Block-Allokationen.

Die vollständigen Messungen liegen in [input-character-oversampling.json](../tests/measurements/input-character-oversampling.json), die kompakte Tabelle in [summary-input-character-oversampling.json](../tests/measurements/summary-input-character-oversampling.json). Die Dateien enthalten Fundamental, harmonische Leistung, identifizierbare Alias-Leistung, Alias/Fundamental, Alias/Total, THD, RMS, Peak und DC für die Sinusmatrix. Der SHA-256 des Produktionscodes ist im Datensatz gespeichert und wird im Test überprüft.

Regeneration:

```powershell
node tests/helpers/measure-input-character-oversampling.cjs
npm.cmd run test:browser -- tests/input-character-oversampling.spec.js tests/input-character-audit.spec.js tests/input-character-tube-dc-rate.spec.js --output "$env:TEMP\da_filta-p3b2-regression"
```

Die Messdateien stehen unter `tests/measurements`, weil Dateizugriffe zum vorhandenen `tests/artifacts`-Verzeichnis in dieser Sitzung abgewiesen wurden. Dies erforderte keine Änderung der Playwright-Konfiguration.

## Filterqualität

| Eigenschaft | Prototyp |
|---|---|
| Struktur | Symmetrisches Kaiser-FIR, 257 Taps / Ordnung 256 je 2×-Resampling-Filter |
| Kaiser-Beta | 8.6 |
| Cutoff | 0.2375 Zyklen je Sample der höheren Rate |
| Passband-Ende | 0.225 der höheren Rate = 0.45 der niedrigeren Rate |
| Stopband-Beginn | 0.25 der höheren Rate = Nyquist der niedrigeren Rate |
| Übergangsband | 0.45–0.50 der niedrigeren Rate; 2.4 kHz Breite bei 48 kHz |
| Gemessene Passband-Ripple | 0.000631 dB |
| Gemessene Stopband-Unterdrückung | mindestens 87.67 dB |
| Phase | Linear; konstante Gruppenlaufzeit im Passband |

Das FIR verhindert Imaging vor der Kennlinie und entfernt erzeugte obere Frequenzen vor der Dezimation. Aliasing, das bereits innerhalb der oversampelten Nichtlinearität entsteht, kann dieses Downsampling-FIR nicht entfernen. Der +24-dB-DESTROY-Test zeigt diesen Unterschied besonders deutlich.

## Signale und Auswertung

Gemessen wurden 100 Hz, 1/5/8/10/12 kHz; alle Frequenzen liegen bei den drei Host-Raten unter Nyquist. Post-Input-Gain-Peaks: 0.03, 0.25 und 0.8. Amount: 25/50/75/100 %. Host-Raten: 44.1/48/96 kHz. Dazu kommen ein logarithmischer 100-Hz-bis-18-kHz-Sweep über 300 ms mit abschließendem Hold, ein Sechston-Signal und ein synthetischer Drum-Transient mit Impuls, abklingendem tieffrequentem Körper und kurzem 9-kHz-Anteil. Ein separater Extremtest nutzt einen 10-kHz-Sinus mit 0.8 Peak vor +24 dB Gain, entsprechend 12.679 Peak am Character-Eingang.

Die Sinusauswertung nutzt 100-ms-Fenster nach 250 ms Einschwingen, nach Kompensation der bekannten FIR-Verzögerung. Eine Bluestein-DFT erlaubt exakt kohärente Fenster auch bei 44.1 kHz. Insgesamt wurden 3.942 Sinus-/Amount-/Faktor-Auswertungen und 1.944 Sweep-/Multitone-/Drum-Auswertungen gespeichert; die 8×-/16×-/32×-Referenzrenders kommen hinzu.

**Alias-Messgrenze:** Leistung außerhalb von Fundamental und zulässigen ganzzahligen In-Band-Harmonischen ist bei einem stationären Sinus direkt identifizierbares Aliasing. Zurückgefaltete Produkte können auch auf bestehende Harmonische oder das Fundamental treffen. Diese Anteile lassen sich aus einem einzigen Host-Spektrum nicht separat bestimmen; die Alias-Spalte ist deshalb eine Untergrenze. Der zusätzliche komplexe, zeitlich ausgerichtete Fehler zur Referenz erfasst auch diese Änderungen, enthält aber ebenso Filterripple und kleine TUBE-Gain-Unterschiede. Für Sweep und Multitone wird dieser Gesamtfehler angegeben, nicht fälschlich als reine Alias-Energie bezeichnet.

## Ergebnistabelle

Alle Aliaswerte sind `100 × sqrt(Aliasleistung/Fundamentalleistung)`, also Amplitudenverhältnisse in Prozent. Die folgende Tabelle enthält je Faktor das Maximum der normalen Sinusmatrix bei 100 % Amount und bis 0.8 Peak. Die Verbesserungen vergleichen diese Maxima; sie müssen nicht aus demselben Einzelrender stammen. CPU ist die relative gemessene Stereo-Rechenzeit bei 48 kHz gegenüber derselben Stage bei 1×.

| Stage | 1× Alias | 2× Alias | 4× Alias | 2× Verbesserung | 4× Verbesserung | CPU 1× / 2× / 4× | Empfehlung |
|---|---:|---:|---:|---:|---:|---|---|
| SILK | 1.2112 % | 0.000448 % | 0.0000119 % | 68.63 dB | 100.17 dB | 1 / 3.44 / 7.57 | 2×; 1× ist nur eine bewusste Kostenoption bei geringer Ansteuerung |
| TAPE | 7.0554 % | 0.1340 % | 0.000645 % | 34.43 dB | 80.77 dB | 1 / 3.13 / 7.32 | 2×, deutlicher Nutzen; 4× für höhere Qualitätsansprüche |
| TUBE | 12.6413 % | 0.1447 % | 0.000232 % | 38.83 dB | 94.73 dB | 1 / 2.80 / 6.42 | 2×, DC-Blocker auf interner Rate |
| CONSOLE | 5.4159 % | 0.4381 % | 0.06948 % | 21.84 dB | 37.84 dB | 1 / 3.24 / 7.60 | 2×; 4× reduziert den verbleibenden Anteil weiter |
| CRUNCH | 2.4573 % | 1.0943 % | 0.3976 % | 7.03 dB | 15.82 dB | 1 / 2.93 / 6.83 | 2× als Kostenkompromiss, 4× bei strengerem Alias-Ziel |
| DESTROY | 20.5166 % | 0.7072 % | 0.2847 % | 29.25 dB | 37.16 dB | 1 / 2.68 / 6.02 | 4×; keine Garantie bei hoher Drive-Ansteuerung |

Die sehr kleinen SILK/TAPE/TUBE-Werte sollten nicht als Genauigkeit der hochwertigen Referenz oder als allgemeine Wahrnehmungsschwelle gelesen werden. Es sind identifizierbare spektrale Komponenten im jeweiligen Test.

Ein direkt gepaarter DESTROY-Vergleich bei 44.1 kHz, 10 kHz, 0.8 Peak und 100 % Amount ergibt 20.5166 % → 0.6646 % → 0.1653 % Alias/Fundamental. Die Verbesserungen sind etwa 29.79 dB für 2× und 41.88 dB für 4× gegenüber 1×. RMS: 0.56367 / 0.55219 / 0.55218; Peaks: 0.69702 / 0.78951 / 0.78279. Die Peak-Anhebung zeigt, dass Oversampling keinen zusätzlichen Headroom garantiert.

### Legaler +24-dB-Stress

Maxima über 44.1/48/96 kHz, 10 kHz, 100 % Amount, 12.679 Peak am Character-Eingang:

| Stage | 1× Alias/Fundamental | 2× | 4× |
|---|---:|---:|---:|
| SILK | 31.43 % | 7.94 % | 0.694 % |
| TAPE | 37.23 % | 13.07 % | 3.53 % |
| TUBE | 43.53 % | 17.49 % | 5.66 % |
| CONSOLE | 27.45 % | 7.31 % | 1.38 % |
| CRUNCH | 43.84 % | 17.77 % | 6.26 % |
| DESTROY | 66.68 % | 42.22 % | 33.40 % |

Damit ist die frühere Annahme „SILK/CRUNCH bei 1× ausreichend“ nicht für den gesamten legalen Input-Gain-Bereich belastbar. 4× verbessert DESTROY hier gegenüber 2× nur um etwa 2 dB und lässt starke Produkte übrig. Die begrenzte Bandbreite der internen Nichtlinearität ist der Hauptgrund; die FIR-Stopband-Unterdrückung allein löst ihn nicht.

## Referenzvergleich und Transienten

Die normale Matrix verwendet eine 8×-Referenz mit denselben FIR-Stufen und derselben Produktionskennlinie. Der Stressvergleich verwendet 16×. DESTROY wurde zusätzlich bei 8× gegen 16× bzw. beim Stress bei 16× gegen 32× verglichen. Bei 0.8 Peak unterscheiden sich 8×/16× um 0.0128–0.0380 % RMS relativ zur Referenz; beim Stress unterscheiden sich 16×/32× noch um 0.162–0.347 %. Die Referenz ist daher kein analytisch aliasfreies Ideal, insbesondere nicht für hartes Clipping und extreme Fold-Ansteuerung.

Maximaler relativer Gesamtfehler zur 8×-Referenz über Sweep/Multitone/Drum, alle normalen Pegel und Amounts:

| Stage | 1× | 2× | 4× |
|---|---:|---:|---:|
| SILK | 0.4664 % | 0.00439 % | 0.000064 % |
| TAPE | 2.7014 % | 0.1808 % | 0.00138 % |
| TUBE | 3.6740 % | 0.1576 % | 0.00884 % |
| CONSOLE | 2.2103 % | 0.2550 % | 0.02575 % |
| CRUNCH | 1.4628 % | 0.5421 % | 0.1117 % |
| DESTROY | 7.6779 % | 0.2592 % | 0.07933 % |

Die Filter verändern Peaks und die Form kurzer Transienten. Beispiel DESTROY-Drum bei 48 kHz, 0.8 Peak und 100 %: Output-Peak 0.6895 / 0.8302 / 0.8284 bei 1×/2×/4×, bei nahezu gleichem RMS der beiden oversampelten Varianten. Die symmetrischen FIRs besitzen Vor- und Nachschwingen um ihren verzögerten Impulspeak. Der neutrale Differenzpfad C entfernt dieses Ringing für LINEAR vollständig, nicht für die nonlinear erzeugte Korrektur. Alle Messsamples waren finite; maximaler stationärer Sinus-DC im gesamten Datensatz war unter 1e-8.

## Amount-Mischung, Phase und Latenz

| Faktor | Host-Samples | 44.1 kHz | 48 kHz | 96 kHz |
|---|---:|---:|---:|---:|
| 1× | 0 | 0 ms | 0 ms | 0 ms |
| 2× | 128 | 2.902 ms | 2.667 ms | 1.333 ms |
| 4× | 192 | 4.354 ms | 4.000 ms | 2.000 ms |

Diese Werte sind Filterlatenz, ohne zusätzliche Browser-/Gerätelatenz. Gruppenlaufzeit und Peakposition wurden mit der Impulsantwort überprüft.

**A — Dry unverzögert + gefiltertes Wet:** Bei LINEAR und Amount 25/75 % liegen die Kammfilter-Minima nahe −6.02 dB; bei 50 % wurden bei 48 kHz Auslöschungen von etwa −148 dB (2×) bzw. −132 dB (4×) aus den gemessenen Impulsantworten berechnet. Der relative Phasenfehler ist `−2πf × Delay/Fs` und wächst mit Frequenz. Architektur A wird verworfen.

**B — Dry um exakt die FIR-Latenz verzögert:** Die zusätzliche Phasendifferenz entfällt. Bei 48 kHz und LINEAR beträgt die maximale Passband-Abweichung für 50 % nur etwa 0.00016 dB (2×) bzw. 0.00020 dB (4×); sie stammt aus der verbleibenden FIR-Ripple. LINEAR ist aber gefiltert und Amount 0 ist verzögert, nicht sample-identisch zum aktuellen Eingang.

**C — verzögertes Host-Dry + oversampelte Nichtlinearitätsdifferenz:**

```text
highDry = upsample(input)
highCorrection = productionShape(highDry) - highDry
output = delay(input, FIR latency) + amount * downsample(highCorrection)
```

C verwendet denselben linearen Übertragungsweg für die subtrahierten Anteile. LINEAR ergibt exakt null Korrektur; Amount 0 und LINEAR bleiben nach Zeitverschiebung sample-identisch. Die direkte LINEAR-Impulsprüfung ergab Fehler 0. Der Pfad ist spektral neutral, hat jedoch die ausgewiesene Verzögerung. C vermeidet eine zweite Downsampling-Kette und ist deshalb der bevorzugte Prototyp. Es wurde keine Loudness-Normalisierung eingeführt.

Im zusätzlichen Streaming-Vergleich für DESTROY, Stereo, 50 % Amount benötigten A/B/C bei 48 kHz und 4× ungefähr 92.26 / 93.74 / 94.03 ms für dieselben 16.384 Host-Frames. Die Unterschiede sind klein gegenüber den Resampling-Kosten und nicht größer als etwaige Laufzeitstreuung. Das Ergebnis spricht nicht für das fehlerhafte A als CPU-Lösung.

**Neutralitätsentscheidung:** Der aktuelle 1×-Produktionspfad bleibt bei LINEAR/Amount 0 ohne Verzögerung sample-identisch. Für einen künftigen stabilen Oversampling-Pfad wäre ein gemeinsames Delay nötig. „Verzögert, aber sample-identisch“ ist eine Produktentscheidung und wurde hier nicht automatisch eingeführt. Eine Architektur ohne hinzugefügte Latenz wurde mit diesem FIR-Prototyp nicht nachgewiesen. Ob 2–4 ms hörbar oder spielbar akzeptabel sind, lässt sich nicht aus den Spektren allein entscheiden.

## Stateful TUBE

Bevorzugt läuft der bestehende DC-Blocker auf der internen Rate, mit `pole = 0.9987^(48000/(hostRate × factor))`. Damit bleibt die analoge Polfrequenz exakt ungefähr 9.937729 Hz. Der vorhandene Produktionscode wird dafür unverändert auf der internen Rate ausgewertet.

Eine zweite Variante nutzt die aus der Produktionsfunktion gewonnenen Bias-/tanh-Samples und blockiert DC nach Downsampling mit dem Host-Pol. Beide Varianten halten denselben analogen Cutoff; gemessen bei 5/10/100/1000 Hz lagen ihre RMS-Differenzen relativ zum internen Pfad unter 0.0532 %. Der kleine Unterschied entsteht unter anderem durch die unnormalisierte digitale Highpass-Passband-Verstärkung. Diese wurde ausdrücklich nicht kompensiert. Host-Blocking ist als günstigere Variante technisch möglich, entspricht aber nicht ganz demselben digitalen Filterverhalten. Der interne DC-Blocker wird für die weitere Planung bevorzugt.

## Stage-Wechsel

Die vorhandene Crossfade-Logik nähert sich über eine 15-ms-Zeitkonstante exponentiell an die neue Stage an und beendet den Übergang nach rund 138 ms. Sie kompensiert keine unterschiedlichen Signallaufzeiten. Unabhängig verzögerte 1×/2×/4×-Pfade lassen beim Wechsel zwei verschiedene Zeitpunkte desselben Eingangssignals zusammentreffen. Ein weicher Crossfade verhindert den harten Gewichtssprung, nicht die dabei entstehenden Auslöschungen oder die Änderung der effektiven Verzögerung.

Getestet wurden LINEAR→DESTROY, TAPE→TUBE und DESTROY→SILK mit warmen Pfaden bei 1.373 und 10 kHz und allen Host-Raten. Die 36 Übergänge blieben finite. Bei 48 kHz/1.373 Hz lag z.B. das RMS während DESTROY→SILK ohne gemeinsames Delay bei 0.1582, mit gemeinsamem Delay bei 0.1812. Der Unterschied ist keine andere Kennlinie, sondern zeitliche Fehlanpassung. Die maximale Anfangsabweichung war im ungematchten Beispiel 0.000479 gegenüber 0.000058 mit Matching.

Vorschlag: ein **konstantes Delay von 192 Host-Samples** für sämtliche Input-Character-Stages einschließlich LINEAR/Amount 0. 1× und 2× bekommen entsprechend 192 bzw. 64 zusätzliche Samples; 4× benötigt kein zusätzliches Padding. Erst die ausgerichteten Ausgaben werden überblendet. Zielzustände müssen vor dem Überblenden gültig sein; der Test nutzte bereits warme Pfade. Kalte FIR-/TUBE-Zustände, Live-Handover, Callback-Spitzen und eine begrenzte Vorwärmstrategie sind vor Produktionsfreigabe noch gesondert zu prüfen. Ein Live-Nachweis vollständiger Click-Freiheit wird aus diesen Offline-Renders nicht abgeleitet.

## Gemessene Stereo-Kosten

Warmed Node-JS-Streaming-Prototyp; Median von drei Durchläufen mit jeweils 128 Blöcken à 128 Frames. Die Werte sind Wandzeit/Audiozeit auf diesem Rechner, keine garantierten AudioWorklet-CPU-Werte. Andere DSP-Module sind nicht enthalten.

| Stage | 48 kHz 1× / 2× / 4× | 96 kHz 1× / 2× / 4× |
|---|---|---|
| SILK | 2.71 / 9.34 / 20.53 % | 5.55 / 17.54 / 40.76 % |
| TAPE | 2.83 / 8.85 / 20.73 % | 5.59 / 17.55 / 41.48 % |
| TUBE | 4.06 / 11.37 / 26.06 % | 8.17 / 22.82 / 52.01 % |
| CONSOLE | 2.67 / 8.66 / 20.33 % | 5.32 / 17.08 / 40.55 % |
| CRUNCH | 3.31 / 9.68 / 22.57 % | 6.47 / 19.42 / 44.90 % |
| DESTROY | 4.59 / 12.29 / 27.64 % | 9.10 / 24.36 / 54.56 % |

Bei 96 kHz/4× wird tatsächlich mit 384 kHz interner Rate gerechnet. Ein einzelner Pfad kann im Prototyp den Echtzeitdurchsatz erreichen; das beweist kein ausreichendes Budget zusammen mit Filterbank und zwei parallelen Pfaden während eines Wechsels. Die langen FIRs sollten vor Live-Einsatz optimiert und im Browser mit dem gesamten Audiographen profiliert werden. Die CPU-Tabellen sind eine gemessene Planungsgrundlage dieses konkreten JS-Prototyps, keine universelle Hardware-Zusage.

## Produktionsvorschlag und Abschlussfragen

Als konkreter Kandidat für die nächste Planung wird **LINEAR 1×, SILK 2×, TAPE 2×, TUBE 2×, CONSOLE 2×, CRUNCH 2×, DESTROY 4×** empfohlen. Die Stages wurden einzeln bewertet: SILK 2× deckt den hohen Gain-Bereich deutlich besser ab; CRUNCH 2× ist ein Kostenkompromiss; bei DESTROY rechtfertigt die normale Matrix 4×. Für TAPE/TUBE/CONSOLE können strengere Qualitätsziele oder häufiger hoher Input-Gain 4× rechtfertigen. Für extremen DESTROY-Drive liefert diese Matrix weiterhin keine Aliasfreiheit.

Vorgeschlagener Filter: die hier gemessene Kaiser-FIR-Kaskade als Qualitätsreferenz, anschließend eine kostenoptimierte Implementierung mit denselben nachgewiesenen Passband-/Stopband-Zielen. Vorgeschlagene Mischung: C mit konstant 192 Host-Samples Gesamtlatenz. Stage-Switch: ausgerichteter, zustandswarm vorbereiteter Parallelpfad und der bestehende 15-ms-Crossfade. Keine globale Gain-Kompensation.

1. **2× TAPE relevant? YES.** 34.43 dB Reduktion des normalen Worst-Case-Aliasverhältnisses; auch Nicht-Sinus-Referenzfehler sinken deutlich.
2. **2× TUBE relevant? YES.** 38.83 dB Reduktion; der interne DC-Pol erhält den P3B.1-Cutoff.
3. **2× CONSOLE relevant? YES.** 21.84 dB Reduktion; Restprodukte bleiben messbar.
4. **2× DESTROY ausreichend? Nicht pauschal.** Normal bis 0.707 % identifizierbares Alias/Fundamental; bei +24-dB-Stress bis 42.22 %.
5. **4× DESTROY deutlich besser? YES bei normaler Ansteuerung.** Rund 8 dB zusätzlich im Maxima-Vergleich; im Extremtest nur rund 2 dB zusätzlich und weiterhin 33.40 %.
6. **SILK/CRUNCH bei 1× ausreichend? NO als Aussage über den gesamten legalen Bereich.** Bei kleinen Pegeln ist 1× eine mögliche bewusste CPU-Option; der +24-dB-Test widerlegt eine allgemeine Freigabe.
7. **Probleme bei Partial Amount?** Unmatched Dry/Wet erzeugt Kammfilter, bei 50 % nahezu vollständige Nullstellen. B/C beseitigen die zusätzliche relative FIR-Phase; die beabsichtigte TUBE-DC-Filterphase bleibt Bestandteil ihrer Kennlinie.
8. **Erforderliche Kompensation?** Mindestens 128 Samples für 2× und 192 für 4×; für stabile Stage-Wechsel gemeinsam 192 Samples.
9. **Oversampling-Matrix?** Der oben genannte Kandidat 1/2/2/2/2/2/4. Eine endgültige Freigabe hängt vom festgelegten Alias-Ziel im extremen Gain-Bereich und der Latenzentscheidung ab.
10. **CPU-Aufwand?** Grob 2.7–3.4× bei 2×, 6.0–7.6× bei 4× gegenüber derselben Stage; Stereo-DESTROY/4× benötigt in diesem Prototyp rund 27.6 % des Audiozeitbudgets bei 48 kHz und 54.6 % bei 96 kHz.
11. **Produktionsimplementierung bereits sicher planbar: NO.** Die DSP-Richtung ist konkret, aber unverzögerte Neutralität gegenüber konstantem Delay ist noch zu entscheiden. Zusätzlich fehlen Browser-Gesamtbudget und Live-State-Handover-Nachweis; für extremen DESTROY-Drive muss ein Qualitätsziel festgelegt werden. Diese Fragen wurden nicht durch eine automatische Produktentscheidung ersetzt.

## Tests und geänderte Dateien

- Browser-Gegenprobe, FIR-Rejection/Impulsdelay/Neutralität, Streaming-vs-Offline-Vergleich einschließlich A/B/C und Stereo sowie Messmatrix-/Stage-Switch-Prüfung: **3 Tests bestanden**.
- Gemeinsam mit bestehendem `input-character-audit.spec.js` und `input-character-tube-dc-rate.spec.js`: **5 Tests bestanden**; die P3B.1-Korrektur bleibt intakt.
- Neu: `tests/helpers/input-character-oversampling.cjs`, `tests/helpers/measure-input-character-oversampling.cjs`, `tests/input-character-oversampling.spec.js`, beide JSON-Dateien unter `tests/measurements` und dieser Bericht.
- Produktionsdateien und bestehende Tests wurden nicht geändert. Kein Commit, kein Push. Nach diesem Bericht wird gestoppt.
