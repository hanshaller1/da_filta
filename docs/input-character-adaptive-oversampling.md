# P3B.4 – Sample-Rate-adaptives Input-Character-Oversampling

Datum: 26.09.2026. Prototyp, Messung und Architekturvalidierung; keine dauerhafte Produktionsänderung. Die P3B.3-Berichtsdatei und deren CPU-Datensatz bleiben als historische Vergleichsbasis erhalten. Der gemeinsame Testcontroller wurde um eine explizite Rate-Matrix erweitert; sein Default bleibt P3B.3. Der identische Gesamtpfad-Messer wird jetzt von beiden Tests verwendet.

## Kandidat und Zeitvertrag

| Stage | 44.1 kHz | interne Rate | 48 kHz | interne Rate | 96 kHz | interne Rate |
|---|---:|---:|---:|---:|---:|---:|
| LINEAR | 1× | 44.1 kHz | 1× | 48 kHz | 1× | 96 kHz |
| SILK | 2× | 88.2 kHz | 2× | 96 kHz | 1× | 96 kHz |
| TAPE | 2× | 88.2 kHz | 2× | 96 kHz | 1× | 96 kHz |
| TUBE | 2× | 88.2 kHz | 2× | 96 kHz | 1× | 96 kHz |
| CONSOLE | 2× | 88.2 kHz | 2× | 96 kHz | 1× | 96 kHz |
| CRUNCH | 2× | 88.2 kHz | 2× | 96 kHz | 1× | 96 kHz |
| DESTROY | 4× | 176.4 kHz | 4× | 192 kHz | 2× | 192 kHz |

Die Matrix wird bei der Context-/DSP-Konstruktion festgelegt; keine pegelabhängige oder automatische Stage-Qualitätsumschaltung. Die Messfreigabe betrifft die drei angegebenen Host-Raten. Der Prototyp verwendet für andere Raten den bisherigen 2×-/4×-Default, erteilt dafür aber keine zusätzliche Freigabe.

**Modell A bleibt global 192 Host-Samples**, unabhängig von Stage, Rate und Amount. Das sind 4.3537/4.0000/2.0000 ms bei 44.1/48/96 kHz zusätzlich zur sonstigen Systemlatenz. Resampling-Korrektur und Host-Dry bleiben zeitlich ausgerichtet:

| Faktor im Character-Signalpfad | FIR-Delay in Host-Samples | Padding der Korrektur | Gesamtdelay |
|---:|---:|---:|---:|
| 1× nonlinear | 0 | 192 | 192 |
| 2× nonlinear | 128 | 64 | 192 |
| 4× nonlinear | 192 | 0 | 192 |
| LINEAR | 0 | keine Korrektur; Host-Dry-Ring 192 | 192 |

Bei 96 kHz bleibt der erste 2×-Upsampler im Hintergrund für DESTROY-Historie live. Die fünf 1×-Kennlinien erhalten ausschließlich die originalen Host-Samples; sie durchlaufen diesen Upsampler nicht. TUBE erhält ebenfalls direkt die Host-Samples. Dieser bewusst beibehaltene Hintergrundaufwand ist in den CPU-Messungen enthalten.

## Differenzpfad C und Handover

```text
highDry = upsample(x, factor)            // bei 1×: x
highWet = unchangedCurve(highDry)
correction = downsample(highWet - highDry, factor) // bei 1×: Differenz direkt
correction = delay(192 - resamplerDelay, correction)
output = delay(192, x) + smoothedAmount * correction
```

Amount wird nach Dezimation/Padding auf Host-Rate angewendet, mit der bisherigen 15-ms-Zeitkonstante. 1× bedeutet keine FIR-Bandbegrenzung der Kennlinie; der gemeinsame Zeitbezug wird durch das 192er Korrektur-Padding hergestellt. Das Subtrahieren vor Downsampling bleibt unverändert. Die bekannte C-Eigenschaft `filteredWet + delayedDry - filteredLinear` bei Amount 1 bleibt erhalten.

Alle Zweige/Historien/Arbeitsarrays werden vorab angelegt. Beim Stage-Request nur den neuen Zweig resetten, drei Blöcke / 384 Host-Samples verdeckt vorwärmen und danach mit dem bisherigen exponentiellen 15-ms-Fade überblenden. Gemeinsamen Dry-Ring und TUBE-State nie beim hörbaren Wechsel resetten. Weitere Requests werden bis zum Fade-Ende auf das letzte Ziel zusammengefasst. Bei 96 kHz füllt dieser Vorlauf sowohl 192er Direct-Padding als auch 2×-FIR/64er Padding vollständig.

Geprüft werden LINEAR↔TAPE, TAPE↔DESTROY und DESTROY↔LINEAR in beiden Richtungen sowie TAPE→TUBE und TUBE↔DESTROY: 90 Kombinationen bei 48/96 kHz und 0/25/50/75/100 % Amount. Gegenprobe ist eine Überblendung zwischen durchgehend warmen Referenzzweigen. Sie prüft zusätzliche Delay-/State-Artefakte; eine beabsichtigte Kennlinien- oder RMS-Änderung wird dadurch nicht als Fehler behandelt.

Zusätzlich werden alle sieben Stages bei allen fünf Amounts und 44.1/48/96 kHz gegen den Offline-C-Pfad geprüft: 105 Kombinationen. Eine separate Identity-Kennlinien-Kontrolle muss bei jedem Faktor und Amount exakt den um 192 Samples verschobenen Float32-Eingang liefern. Sie prüft die Latenzgeometrie unabhängig von der gewählten Nichtlinearität. Kein linearer Doppelpfad mit unterschiedlichen Delays wird gemischt.

## TUBE

Der Pole bleibt `pow(0.9987, 48000 / tubeInternalRate)`, einmal beim Anlegen berechnet. Bias 0.18, Drive 1.3 und Kennlinie sind unverändert. Kontinuierlicher Stereo-State läuft bei 44.1 kHz auf 88.2 kHz, bei 48 **und** 96 kHz auf 96 kHz. Wechsel zu/von TUBE und Amount 0 frieren den State nicht ein. Panic erhält den State gemäß bestehender Engine-Semantik; Input-Gain-Rampen werden am tatsächlich eingespeisten Eingang nachvollzogen.

| Host | TUBE intern | Pole | Analoger Cutoff |
|---:|---:|---:|---:|
| 44.1 kHz | 88.2 kHz | 0.9992923072766219 | 9.9377293735 Hz |
| 48 kHz | 96 kHz | 0.9993497886125758 | 9.9377293735 Hz |
| 96 kHz | 96 kHz | 0.9993497886125758 | 9.9377293735 Hz |

Der bestehende 1×-48-kHz-Produktionspol 0.9987 bleibt in diesem Task unangetastet. Der TUBE-Test bei 96 kHz verwendet dieselbe interne Rate und denselben Pole wie die vorhandene P3B.1-96-kHz-Implementierung.

## Klangmessung und Vergleichsband

Direkte Paarung: 48 kHz mit 2×/4× gegenüber 96 kHz mit 1×/2×. Zusätzlich wird bei 96 kHz der bisherige 2×-/4×-Kandidat mitgemessen. Sinusamplituden bzw. Signal-Skalierungen nach Gain 0.03/0.25/0.8, Amount 100 %, Frequenzen 100 Hz, 1/5/10/18/20 kHz. Die letzten beiden Frequenzen erweitern P3B.2 um ein anspruchsvolleres oberes Audioband; Maxima sind deshalb nicht mit der alten maximal 12-kHz-Sinusmatrix gleichzusetzen.

324 stationäre Spektralauswertungen, 162 Sweep-/Multitone-/Transient-Auswertungen, 24 DESTROY-Gain-Auswertungen und 108 gepaarte Normalfälle. Sweep 100 Hz→20 kHz in 300 ms; Multitone 173 Hz, 1/5/8/10/18 kHz mit festen Phasen; Transient mit kurzem kontinuierlichem Gaussian-Puls, abklingendem Tiefton-Körper und 9-kHz-Anteil. Der Puls hat dieselbe Zeitdauer bei beiden Host-Raten. Stationäre Fenster: 100 ms nach 250 ms Einschwingen und kompensiertem Resampling-Delay. Nichtstationäre Fenster: 350 ms ab Signalbeginn, ebenfalls ausgerichtet.

Gespeichert werden RMS, Peak, DC, Referenz-RMS-/Maximalfehler und relativer Referenzfehler für jedes Signal. Bei Sinus zusätzlich Alias/Fundamental, Alias/Total und THD. Bei Sweep/Multitone/Transient bleiben diese drei Sinusgrößen ausdrücklich `null`: ein Referenzfehler ist dort kein separierbarer Aliasanteil. Referenz: 8×, ergänzt durch 8×/16×-Konvergenzproben; für DESTROY-Stress 16× mit 32×-Kontrolle. Diese Referenzen sind endlich, keine ideal aliasfreie Wahrheit.

**Vergleichsmaß ist das gemeinsame Band unter 24 kHz**, dessen Ausgabe beide Host-Raten darstellen können. Volle Spektren bis zur jeweiligen Nyquist-Frequenz werden zusätzlich gespeichert und berichtet. 96 kHz besitzt ein zusätzliches Band von 24–48 kHz. Dessen harmonische und zurückgefaltete Komponenten dürfen weder unterschlagen noch mit dem bei 48 kHz nicht vorhandenen Band gleichgesetzt werden. Der native 1×-Pfad bei 96 kHz entfernt solche oberen Komponenten nicht mit einem Resampling-Downfilter. Die Aussage „vergleichbar“ bezieht sich auf den gemeinsamen Audiobereich und die getesteten Quellen bis 20 kHz, nicht auf identische Vollband-Spektren oder aliasfreien Ultraschall.

Alias ist hier stationäre Leistung außerhalb von Fundamental und zulässigen In-Band-Harmonischen. Rückfaltung auf Fundamental/Harmonische bleibt spektral nicht separierbar; die Angabe ist eine Untergrenze. Alle Prozentwerte für Alias/Fundamental sind Amplitudenverhältnisse. Common-band-Referenzfehler integriert den Fehler unter 24 kHz und wird durch den vollständigen Referenz-RMS normiert.

## CPU-Messverfahren

Unverändert gegenüber P3B.3: tatsächliche Produktionsklassen, 10-Band-FILTERBANK, +3 dB Bandregler, lokale Feedback-Gates 2/4/6 und MAIN auf beiden Kanälen, Resonance 0.55, normale Common-Bus-Topologie, Dynamic EQ CUT an bei −30 dB, Character Amount 50 %, Input Gain +6 dB, global Dry/Wet 30/70, Master −6 dB, normale Guard-/Safety-Defaults. Vier native Analyzer FFT 2048 mit RAF-Abfrage; Dynamic-EQ-Telemetrie normal an, Schutz-Telemetrie normal aus. Dieselbe Stereo-Multitone-/Transient-Quelle und dieselbe serielle Testhülle im tatsächlichen AudioWorklet wie in P3B.3.

Entscheidungsdaten kommen aus nativen Chromium-Trace-Wallzeiten für `RealtimeAudioDestinationHandler::Render`, 128 Frames; erste 250 ms als Warmup getrennt. Je Fall zwei Sekunden Live-Betrieb; separates 0.4–0.8-s-Fenster für den bei 0.5 s angeforderten Stage-Wechsel. Alle sieben Stages plus TUBE↔DESTROY und TAPE↔DESTROY bei 48/96 kHz: 22 Live-Fälle pro Durchlauf. High-resolution Main-Thread-Replay und quantisierte Worklet-Date-Mittelwerte dienen nur als zusätzliche Kontrollen. Die native LINEAR-Gegenprobe mit echten getrennten Filterbank-/Guard-/Safety-Nodes bleibt Teil jedes Durchlaufs.

Komfortziel ist unverändert **≥30 % p99-Reserve**, stationär und im separaten Wechselfenster. Bei 96 kHz bedeutet dies p99 ≤0.933333 ms pro 128 Samples; bei 48 kHz ≤1.866667 ms. Startup-Spitzen, Maxima und Budgetüberschreitungen werden separat ausgewiesen. Der Startvertrag aus P3B.3 bleibt: mindestens 250 ms stumm vorverarbeiten und anschließend 10 ms Master-Gain-Ramp. Der Prototyp implementiert keinen produktiven Startablauf.

## Klangergebnisse

Maxima der normalen Sinusmatrix, 100 % Amount, Peaks bis 0.8, einschließlich 18/20 kHz. Werte: Alias/Fundamental in Prozent. In der letzten Spalte steht das Maximum des Referenz-RMS-Fehlers unter 24 kHz, normiert auf vollständigen Referenz-RMS:

| Stage | 48k 2×/4×, gemeinsames Band | 96k 1×/2×, gemeinsames Band | 96k 1×/2×, volles Band | Referenzfehler 48k / 96k im gemeinsamen Band |
|---|---:|---:|---:|---:|
| SILK | 0.022103 % | 0.022087 % | 1.211159 % | 0.022090 / 0.022089 % |
| TAPE | 0.882007 % | 0.881968 % | 7.055443 % | 0.881999 / 0.881953 % |
| TUBE | 1.274874 % | 1.274828 % | 6.508321 % | 1.275393 / 1.271127 % |
| CONSOLE | 1.098695 % | 1.098667 % | 5.401074 % | 1.117449 / 1.098714 % |
| CRUNCH | 2.342293 % | 2.342182 % | 2.457285 % | 2.240987 / 2.353105 % |
| DESTROY | 0.612123 % | 0.612236 % | 0.626148 % | 0.595802 / 0.615394 % |

Die Maxima einer Stage können aus verschiedenen Frequenzen stammen. Deshalb gibt es zusätzlich alle 108 direkt gepaarten Fälle im Datensatz. Größte positive Alias-Abweichung von 96k adaptiv gegenüber 48k im gemeinsamen Band: **0.00090724 Prozentpunkte**, bei DESTROY; für die normalen fünf Stages höchstens 0.00060774 Prozentpunkte. Diese geringe Abweichung passt zum gleichen internen Rate-Ziel und zu kleinen FIR-/Float32-Unterschieden. Sie bedeutet keine allgemein aliasfreie Stage.

Die direkt ausgerichteten Fundamentals bestätigen auch die Phase: maximale Phasendifferenz **3.54564e-7 rad** (etwa 0.0000203°), maximale Gain-Abweichung **0.00013518 dB**. Der 96k-1×-Pfad hat nach dem 192er Padding denselben Zeitbezug; es gibt keinen versteckten 128-/192-Sample-Sprung.

### Sweep, Multitone und Transient

Jeweils maximaler Common-band-Referenz-RMS-Fehler über Peaks 0.03/0.25/0.8; Prozentwerte sind normiert auf den vollständigen Referenz-RMS. Das sind Gesamtfehler einschließlich FIR-/TUBE-Gain-Unterschieden, keine isolierten Aliasquoten:

| Stage | Sweep 48k / 96k | Multitone 48k / 96k | Transient 48k / 96k |
|---|---:|---:|---:|
| SILK | 0.00468 / 0.00496 % | 0.000103 / 0.001408 % | 0.000020 / 0.000182 % |
| TAPE | 0.19246 / 0.19860 % | 0.007329 / 0.012067 % | 0.000128 / 0.001246 % |
| TUBE | 0.19022 / 0.20537 % | 0.024497 / 0.031211 % | 0.024367 / 0.028429 % |
| CONSOLE | 0.26696 / 0.27539 % | 0.114318 / 0.120284 % | 0.001276 / 0.001727 % |
| CRUNCH | 0.55673 / 0.57681 % | 0.315080 / 0.333956 % | 0.084387 / 0.083780 % |
| DESTROY | 0.09167 / 0.09985 % | 0.004014 / 0.005907 % | 0.006060 / 0.006073 % |

Die Fehler sind in der gleichen Größenordnung; die Multitone-/Transient-Referenzfehler sind bei einigen 1×-Stages relativ größer als die sehr kleinen 48k-Werte. Diese Unterschiede werden nicht durch den Sinusvergleich ersetzt. Alle Ausgaben sind finite; sämtliche RMS-, Peak-, DC-, Alias/Total-, THD- und Referenzfehler-Einzelwerte liegen im JSON. Volle RMS-/Peak-/THD-Werte müssen wegen des zusätzlichen 24–48-kHz-Bands nicht identisch sein. Beispielsweise DESTROY 10 kHz, Peak 0.8: RMS 0.55214 bei 48k gegenüber 0.56361 bei 96k; volle THD nahezu 0 % gegenüber 20.49 %, weil 30-kHz-Harmonische nur im höheren Host-Band ausgegeben werden können.

Die 8×-/16×-Normal-Konvergenzprobe bei 10 kHz, Peak 0.8 hat maximal 0.05114 % relativen RMS-Unterschied. Die 16×-/32×-Stressprobe erreicht maximal 0.34724 %. Referenzfehler unterhalb dieser Grenzen sind keine Aussage über eine ideale Referenzgenauigkeit; die direkt identifizierbaren Aliasleistungen werden unabhängig von dieser Referenz bestimmt.

## DESTROY bis +24 dB

10-kHz-Sinus, 100 % Amount; direkt gepaartes Alias/Fundamental unter 24 kHz:

| Source-Peak | Gain | Character-Peak vor Begrenzung | 48k 4× | 96k 2× |
|---:|---:|---:|---:|---:|
| 0.25 | 0 dB | 0.2500 | 0.00000616 % | 0.00000195 % |
| 0.25 | +6 dB | 0.4988 | 0.00002339 % | 0.00000124 % |
| 0.25 | +12 dB | 0.9953 | 0.320718 % | 0.322010 % |
| 0.25 | +24 dB | 3.9622 | 2.136458 % | 2.149509 % |
| 0.8 | 0 dB | 0.8000 | 0.152494 % | 0.152952 % |
| 0.8 | +6 dB | 1.5962 | 1.581992 % | 1.583525 % |
| 0.8 | +12 dB | 3.1849 | 1.203917 % | 1.204301 % |
| 0.8 | +24 dB | 12.6791 | **26.579435 %** | **26.669117 %** |

**Entscheidung: vergleichbar im gemeinsamen Band, nicht pauschal besser.** Im härtesten Fall ist die adaptive Aliasquote rund 0.34 % relativ höher, eine Änderung von 0.08968 Prozentpunkten. Alias/Total im gemeinsamen Band: 25.68755 % gegenüber 25.76848 %. Die P3B.3-Entscheidung, extreme DESTROY-Verzerrung samt verbleibendem Aliasing als Effektcharakteristik zu akzeptieren, bleibt bestehen.

Volles 96k-Band im selben Extremfall: Alias/Fundamental **41.61085 %**, Alias/Total **37.95135 %**; bei 48k sind es 26.57943/25.68755 %. Damit ist der Kandidat im vollen 0–48-kHz-Ausgabeband ausdrücklich nicht so aliasarm wie ein auf 0–24 kHz begrenzter Vergleich. RMS/Peak/DC: 48k 0.394015 / 0.595866 / 2.63e-13; 96k 0.417351 / 0.647533 / 1.48e-13. Kein 4× bei 96 kHz wird aus diesen unterschiedlich breiten Integrationsbändern automatisch erzwungen; der 192-kHz-Character-Kern bleibt der gewählte Effektkompromiss.

## Mix-/State-Nachweise

- Identity-Kontrolle: **0** maximale Sample-Differenz bei allen 105 Stage-/Rate-/Amount-Kombinationen zum verzögerten Dry. Amount 0 und LINEAR mit echter Kennlinie ebenfalls **0**. Damit ist kein latenzbedingter Kammfilter eingebaut.
- Tatsächlicher Streaming-C-Mix gegen Offline-C einschließlich passendem Padding: maximale Differenz **1.11249e-7**.
- Alle 90 Wechsel: Stereo-Differenz **0**, Amount-0-Dry-Fehler **0**, Zielkorrektur nach Vorlauf gegen dauerhaft warmen Zielzweig **0**. Vollständiger Fade gegen warme Referenzen maximal **5.95646e-8**.
- TUBE: kein wachsender DC-State beim Ein-Sekunden-Test. Interner Rest bei konstantem 0.4-Eingang: rund 2.48e-7 bei 44.1/48k durch Polyphasen-Ripple, **2.39e-28** bei 96k 1× ohne Upsampling. Pole/Cutoff wie oben; Panic erhält State exakt.
- Alle sieben Stages bei 44.1/48/96k, legalem Source-Peak bis 1 plus 24 dB und stereo-identischem Eingang: **21 finite Extremfälle**, Stereo-Differenz **0**. LINEAR bleibt erwartungsgemäß ungesättigt; Schutzstufen wurden nicht in die isolierte Character-Kennlinie hineingezogen.

Die numerischen Kontrollen weisen zusätzliche State-/Delay-Artefakte nach; sie behaupten keine psychoakustische Hörfreigabe oder unveränderte Kennlinienpegel beim Stage-Wechsel.

## CPU-Ergebnisse: zwei vollständige adaptive Läufe

Rechner wie P3B.3: Ryzen 7 5700X / 16 logische CPUs, Windows x64, Chromium 153.0.8010.12, Node v24.20.0. Der erste adaptive Lauf erreicht ≥30 % in allen geprüften stationären und separaten Wechselfenstern. Der zweite wiederholte Lauf unterschreitet das Ziel in drei 96k-Wechselfenstern. Beide Läufe sind gespeichert; der günstigere Lauf ersetzt den ungünstigeren nicht.

Letzter vollständiger Lauf, native 128-Frame-Renderzeit nach Warmup:

| Fall | 48k p99 / Reserve | 96k p99 / Reserve | separates 48k-Wechselfenster | separates 96k-Wechselfenster |
|---|---:|---:|---:|---:|
| LINEAR | 0.670 ms / 74.88 % | 0.657 ms / 50.73 % | — | — |
| SILK | 0.760 ms / 71.50 % | 0.685 ms / 48.63 % | — | — |
| TAPE | 0.775 ms / 70.94 % | 0.677 ms / 49.23 % | — | — |
| TUBE | 0.719 ms / 73.04 % | 0.652 ms / 51.10 % | — | — |
| CONSOLE | 0.784 ms / 70.60 % | 0.654 ms / 50.95 % | — | — |
| CRUNCH | 0.771 ms / 71.09 % | 0.678 ms / 49.15 % | — | — |
| DESTROY | 1.075 ms / 59.69 % | 0.776 ms / **41.80 %** | — | — |
| TUBE→DESTROY | 1.211 ms / 54.59 % | 0.783 ms / 41.28 % | 1.326 ms / 50.28 % | **1.036 ms / 22.30 %** |
| DESTROY→TUBE | 1.208 ms / 54.70 % | 0.758 ms / 43.15 % | 1.350 ms / 49.38 % | 0.850 ms / 36.25 % |
| TAPE→DESTROY | 1.174 ms / 55.98 % | 0.810 ms / 39.25 % | 1.262 ms / 52.68 % | **0.973 ms / 27.03 %** |
| DESTROY→TAPE | 1.115 ms / 58.19 % | 0.843 ms / 36.78 % | 1.216 ms / 54.40 % | **1.003 ms / 24.78 %** |

96k DESTROY stationär verbessert sich von P3B.3 22.9 % auf 54.7 % im ersten und 41.8 % im zweiten adaptiven Lauf. Der 96k-Wechselfenster-Mindestwert war zuerst 42.48 %, im zweiten Lauf **22.30 %**. Bei 48k bleiben beide Läufe oberhalb des Ziels: mindestens 46.19 % bzw. 49.38 % einschließlich aller zusätzlich getesteten Wechselrichtungen. Dass identische 48k-Faktoren ebenfalls unterschiedliche Zeiten haben, zeigt die Laufvariabilität; die Messwerte werden nicht als reine OS-Kosten ausgegeben.

Letzter Lauf: 7.251 nach Warmup ausgewertete 48k-Blöcke ohne Budgetüberschreitung, 14.621 96k-Blöcke mit drei Überschreitungen (zwei TUBE→DESTROY, eine TAPE→DESTROY). Maximum 1.839 ms bei 96k und 1.333333-ms-Budget. Über beide Läufe: 43.674 Blöcke, vier Überschreitungen. Startup-Maximum des letzten Laufs **10.059 ms**, weiterhin Bedarf für den stummen Startvorlauf. Alle Live-Fälle finite, Analyzer und Telemetrie aktiv, kein Processor-Error. `currentFrame`-Kontinuität ist keine Aussage über Geräte-Underruns.

Die native Graph-Gegenprobe bleibt bei beiden Raten innerhalb **5.960464477539063e-8** maximaler Sample-Differenz. Tracing ist mit zusätzlichem Aufwand verbunden; dennoch gibt es bei identischer Messmethodik keine Grundlage, die unter 30 % liegenden Wechselwerte als bestanden zu erklären.

## Vergleich alt / adaptiv

CPU: alter P3B.3-Native-Trace gegenüber letztem adaptiven Durchlauf, stationäre p99-Reserve. Unterschiedliche Läufe, keine gleichzeitig erhobene A/B-Probe. `n.m.` = nicht gemessen; alte SILK-CPU war nicht Teil der P3B.3-Pflichtmatrix. Aliasänderung: gemeinsame Band-Maxima der neuen erweiterten Normalmatrix, Prozent Alias/Fundamental; bei unveränderten Faktoren identischer Signalpfad. Separate Wechselwerte stehen oben.

| HOST RATE | STAGE | OLD OS | ADAPTIVE OS | OLD CPU RESERVE | NEW CPU RESERVE | ALIAS CHANGE |
|---|---|---:|---:|---:|---:|---|
| 44.1k | LINEAR | 1× | 1× | n.m. | n.m. | unverändert |
| 44.1k | SILK | 2× | 2× | n.m. | n.m. | unverändert |
| 44.1k | TAPE | 2× | 2× | n.m. | n.m. | unverändert |
| 44.1k | TUBE | 2× | 2× | n.m. | n.m. | unverändert |
| 44.1k | CONSOLE | 2× | 2× | n.m. | n.m. | unverändert |
| 44.1k | CRUNCH | 2× | 2× | n.m. | n.m. | unverändert |
| 44.1k | DESTROY | 4× | 4× | n.m. | n.m. | unverändert |
| 48k | LINEAR | 1× | 1× | 80.58 % | 74.88 % | unverändert |
| 48k | SILK | 2× | 2× | n.m. | 71.50 % | unverändert |
| 48k | TAPE | 2× | 2× | 75.70 % | 70.94 % | unverändert |
| 48k | TUBE | 2× | 2× | 77.58 % | 73.04 % | unverändert |
| 48k | CONSOLE | 2× | 2× | 75.74 % | 70.60 % | unverändert |
| 48k | CRUNCH | 2× | 2× | 75.36 % | 71.09 % | unverändert |
| 48k | DESTROY | 4× | 4× | 69.21 % | 59.69 % | unverändert |
| 96k | LINEAR | 1× | 1× | 57.25 % | 50.73 % | keine zusätzliche Nichtlinearität |
| 96k | SILK | 2× | 1× | n.m. | 48.63 % | 0.0000118 → 0.022087 % |
| 96k | TAPE | 2× | 1× | 57.03 % | 49.23 % | 0.021593 → 0.881968 % |
| 96k | TUBE | 2× | 1× | 59.20 % | 51.10 % | 0.002265 → 1.274828 % |
| 96k | CONSOLE | 2× | 1× | 56.28 % | 50.95 % | 0.180840 → 1.098667 % |
| 96k | CRUNCH | 2× | 1× | 57.48 % | 49.15 % | 0.756759 → 2.342182 % |
| 96k | DESTROY | 4× | 2× | 22.90 % | 41.80 % | 0.108890 → 0.612236 % |

Die höhere 96k-Aliasquote gegenüber dem teureren alten 96k-Kandidaten wird bewusst ausgewiesen. Der Qualitätsvergleich des Hypothesentests lautet 48k 2×/4× gegenüber 96k 1×/2×: deren gemeinsame Band-Ergebnisse sind vergleichbar. Der adaptive Kandidat erreicht keine Qualitätsidentität mit dem ehemaligen höheren internen 192-/384-kHz-Kern aller 96k-Stages.

## Abschlussfragen und Entscheidung

| Nr. | Frage | Antwort |
|---:|---|---|
| 1 | 96k 1× qualitativ vergleichbar mit 48k 2× für normale Stages? | **YES im gemeinsamen Audioband unter 24 kHz für die getesteten Quellen bis 20 kHz**, einschließlich Sweep/Multitone/Transient; keine identischen Vollband-Spektren. |
| 2 | 96k DESTROY 2× vergleichbar mit 48k DESTROY 4×? | **YES im selben Vergleichsband**, auch bis +24 dB; nicht generell besser und im zusätzlichen 24–48-kHz-Band nicht aliasfrei. |
| 3 | Differenzpfad C korrekt? | **YES**, einschließlich 192er Direct-Padding bei 1×. |
| 4 | Partial Amounts artefaktfrei? | **YES bezüglich zusätzlicher Latenz-/Kammfilterfehler**, alle 0/25/50/75/100-%-Kontrollen grün; gewünschte Nichtlinearität bleibt. |
| 5 | Stage-Wechsel artefaktfrei? | **YES numerisch für Delay/State/Mix**, beide Richtungen und warmer Referenzfade grün. CPU-Ausreißer verhindern dennoch eine uneingeschränkte Echtzeitfreigabe. |
| 6 | TUBE korrekt? | **YES**, interner 96k-Pole 0.9993497886125758, Cutoff 9.9377293735 Hz, kontinuierlicher stabiler State, P3B.1-Regression grün. |
| 7 | Neue p99-Reserve bei 96k? | DESTROY stationär **41.80 %** im letzten Lauf; Worst-Case im separaten Wechselfenster **22.30 %**. Erster Lauf: 54.70 % bzw. mindestens 42.48 %. |
| 8 | ≥30-%-Ziel erreicht? | **YES stationär; NO zuverlässig für Stage-Wechsel.** Drei separate Wechselfenster unterschreiten das Ziel im Wiederholungslauf. |
| 9 | Finale adaptive Matrix? | **Gewählter Kandidat:** 44.1/48k normale Stages 2×, DESTROY 4×; 96k normale Stages 1×, DESTROY 2×; LINEAR immer 1×. Global 192 Samples. Gesamte Produktionsfreigabe bleibt blockiert. |
| 10 | Produktionsimplementierung freigeben? | **NO**, wegen nicht ausreichend stabiler 96k-Wechselreserve. |

### Exakter verbleibender Blocker

Die Adaptive-Matrix löst den stationären DESTROY-CPU-Blocker aus P3B.3, **aber nicht das wiederholt geprüfte ≥30-%-p99-Kriterium beim Stage-Wechsel**. Grenze bei 96k: 0.933333 ms pro Block. TUBE→DESTROY: 1.036 ms (0.102667 ms zu viel); TAPE→DESTROY: 0.973 ms (0.039667 ms zu viel); DESTROY→TAPE: 1.003 ms (0.069667 ms zu viel). Hinzu kommen drei einzelne Budgetüberschreitungen im zweiten Lauf. Die Klang-, Delay-, Amount- und TUBE-Prüfungen sind keine verbleibenden Blocker.

Nächster abgegrenzter Task ist deshalb eine **Testprototyp-Optimierung und native Messung des Stage-Wechsels** mit der jetzt festgelegten adaptiven Matrix. Zunächst den gleichzeitigen alten/neuen Korrekturzweig und dessen Pad-/Mix-Aufwand sowie Render-Laufvariabilität profilieren. Eine spätere direkte Nutzung der unveränderten Shape-Funktionen kann redundante interne Amount-/Stage-Metadaten-Smoothing-Schleifen vermeiden; bestehendes Host-Amount-/Fade-Smoothing muss dabei unverändert bleiben. Kein kürzeres Filter, kein neues Latenzmodell und kein pauschales 4× bei 96k zur Umgehung dieses Befunds. Erforderlich sind wiederholte längere native Gesamtpfad-Läufe mit allen kritischen Wechselrichtungen, p99 ≤0.933333 ms im separaten Wechselfenster und ausdrücklich ausgewerteten Budgetausreißern. In diesem Task wird dafür kein Live-DSP implementiert.

## Dateien, Tests und Reproduzierbarkeit

Messdatei: [input-character-adaptive-oversampling.json](../tests/measurements/input-character-adaptive-oversampling.json). Sie enthält sämtliche angeforderten Einzelmetriken, gemeinsame/volle Bänder, Referenzkonvergenz, direkte Paarungen und Phase/Gain, Mix-/State-/Extremtests, vollständige tatsächliche Filterbank-Optionen, beide nativen CPU-Läufe und unterstützende Replays. Die SHA-256 aller verwendeten Produktions-DSP-Quellen sind gespeichert.

Neu in P3B.4:

- `docs/input-character-adaptive-oversampling.md`
- `tests/helpers/measure-input-character-adaptive.cjs`
- `tests/helpers/measure-input-character-full-graph.cjs`
- `tests/input-character-adaptive-oversampling.spec.js`
- `tests/measurements/input-character-adaptive-oversampling.json`

Erweiterte Testdateien aus P3B.3:

- `tests/helpers/input-character-architecture.cjs`: optionale Rate-Matrix, 1×-Korrekturpfad, dynamisches Padding, TUBE-interne Rate; bisherige Defaultmatrix erhalten.
- `tests/helpers/input-character-full-graph.cjs`: optionale adaptive Matrix an den Testgraph übergeben.
- `tests/input-character-production-architecture.spec.js`: identischen CPU-Messer in gemeinsamen Helfer ausgelagert; bestehende Kontrolltests bleiben erhalten.

`input-character-oversampling.cjs` wurde in diesem Task nicht weiter geändert; dessen bereits vorhandene Stream-Exporte aus P3B.3 werden verwendet. Produktionscode und bestehender Audit-Test sind unverändert. Kein Commit, kein Push.

Ausgeführte Testläufe:

```powershell
npx.cmd playwright test tests/input-character-adaptive-oversampling.spec.js --workers=1 --output "$env:TEMP\da_filta-p3b4-final"
# 5 passed (4.2m), zweiter vollständiger CPU-Lauf

npx.cmd playwright test tests/input-character-production-architecture.spec.js tests/input-character-oversampling.spec.js tests/input-character-tube-dc-rate.spec.js tests/input-character-audit.spec.js --grep-invert "complete production DSP" --workers=1 --output "$env:TEMP\da_filta-p3b4-regression"
# 7 passed (32.9s)
```

Der erste Entwicklungs-/CPU-Lauf bestand mit vier Tests; danach kamen die explizite Phase-/Gain-Paarprüfung, eine über beide Raten zeitgleiche Gaussian-Transient-Quelle sowie Normal-Referenzkonvergenz hinzu. Der finale vollständige Lauf besitzt alle fünf aktuellen Tests. Insgesamt **12 finale Tests grün**, einschließlich P3B.1, P3B.2, der bisherigen P3B.3-A/B/C-Kontrollen und des unveränderten Audits. Funktionale Tests bleiben absichtlich unabhängig vom Performance-GO/NO-GO: die berichteten unter 30 % liegenden Reserven werden dadurch nicht als bestanden gewertet.

Die zwei P3B.3-Kontrollen schreiben ihren Messdatensatz neu; für den Regressionslauf wurde die historische P3B.3-Datei vorher gesichert und danach bytegleich wiederhergestellt. Damit bleiben alter Bericht und CPU-Vergleich konsistent. `node --check` für die neuen JS-Helfer/Tests und `git diff --check` sind sauber. Bytevergleich gegen HEAD bestätigt weiterhin unveränderten Produktions-DSP und unveränderte Engine-/Routing-Dateien.
