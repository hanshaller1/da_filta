# da_filta Backlog

Stand: 2026-10-07

Diese Datei sammelt offene Produkt-, DSP-, Modulations-, MIDI- und Wartungsthemen. Erledigte Punkte sollen aus dem offenen Backlog entfernt oder in einen kurzen Abschnitt „Erledigt“ verschoben werden. Neue bestätigte Aufgaben sollen hier ergänzt werden.

## Priorisierte offene Punkte – Review 2026-10-07

Ergebnis der Review-Sitzung vom 2026-10-07 (Code, UI, Hardware-Handbuch). Die
Liste ist nach Dringlichkeit geordnet; Details stehen in den verlinkten Dateien.

### 1. Abschließen (liegt bereit)

- [ ] `feature/shared-bus-band-sat-core` committen: DEV-Core SHARED BUS · BAND SAT,
  Test `tests/filterbank-shared-band-sat.spec.js`, Nachtrag in
  [resonator-production.md](resonator-production.md).
- [ ] Paritätstest `tests/dsp-performance.spec.js:164` ist auf
  `fix/feedback-loop-modulation` rot (Diagnosefeld `feedbackTapModulation` aus
  `2d3fd24`). Korrektur liegt uncommittet auf dem Feature-Branch und gehört vor
  dem PR auf den Fix-Branch.
- [ ] Hörtest für `fix/feedback-loop-modulation` (LFO auf Band-Gain bei hoher
  Resonance), dann Push und PR nach `main`. Danach Feature-Branch nachziehen.

### 2. Echte Fehler (klein)

- [ ] Modus-Navigation unter 1200 px Breite ist ungestylt (außer in MOD/PRESETS).
  Entweder Tabs für schmale Fenster stylen oder Mindestbreite 1200 px festlegen
  und den halben schmalen Modus entfernen.
- [ ] `feedbackAllLevel`: ungültiger Wert fällt auf `raw` statt `sqrt10`
  (`filterbank.js`, `filterbank-processor.js` `readFeedbackAllLevel`), rund
  +10 dB MAIN-Gain. Vorher prüfen, ob Tests `raw` erwarten.
- [ ] CRUNCH-Kennlinie (`input-preamp-processor.js` `shape`, Stufe 5): Steigung
  springt am Knie von 1,0 auf 1,71. Für einen stetigen Übergang müsste der
  Exponent 1/0,52 ≈ 1,92 statt 3,3 sein. Ändert den Klang der Stufe.

### 3. Richtungsentscheidung (vor weiterem DSP-Umbau)

- [ ] Ziel klären: möglichst genaue Nachbildung der Hardware oder eigenes
  Instrument in deren Geist. Davon hängen die folgenden Punkte ab.
- [ ] Feedback-Core: Das Handbuch-Schaltbild und zwei Hörproben am Gerät sprechen
  für gemeinsamen Rückweg mit Begrenzung je Band (SHARED BUS · BAND SAT), nicht
  für den Produktstandard PER-BAND ZDF. Am Gerät prüfen: Sättigung ohne Feedback,
  Sägezahn-Anteil (Asymmetrie), Verstimmung bei zwei aktiven Bändern. Danach
  entscheiden, ob der Core Produktstandard wird.
- [ ] FB ALL: Laut Handbuch „output of all bands“ (so implementiert). Im neuen
  Core vorläufig ohne eigene Sättigung; noch nicht gegen das Gerät geprüft.
- [ ] Eingangsstufe: Standard ist LINEAR, das Original übersteuert in der
  Gain-Stufe. Offen: originalnahe Standardstufe, Pegelabgleich der sieben Stufen
  (bis 25 dB Unterschied bei +24 dB), Gain als Drive statt Parallelmischung.
- [ ] Resonance-Kennlinie: Hardware bietet sechs wählbare Kurven, die App eine
  feste quadratische.
- [ ] Rausch-Seed für Selbstoszillation ohne Eingangssignal.
- [ ] Feedback je Stereokanal in der UI (DSP kann es, UI fest auf beide Kanäle).

### 4. Performance und Latenz

- [ ] Eingangsstufe rechnet im Leerlauf: Upsampler und TUBE-Kennlinie laufen
  auch bei LINEAR (rund 10 % des Blockbudgets bei 48 kHz).
- [ ] 192 Samples Latenz der Eingangsstufe auch bei LINEAR; Bypass umgeht sie
  (Zeitsprung beim Umschalten).
- [ ] 96 kHz: Morph überzieht das Callback-Budget (230 von 2860 Blöcken im
  Preset-Morph-Test). 96 kHz entweder absichern oder nicht anbieten.
- [ ] Ausgabe über `MediaStreamDestination` plus `<audio>`-Element; direkte
  Ausgabe mit `AudioContext.setSinkId()` prüfen.
- [ ] Aliasing: Eingangsstufen mit 2-fach-Oversampling erreichen bei +24 dB und
  hellem Material nur −22 bis −25 dB; `tanh` im Feedback ohne Oversampling.
- [ ] Toter Parameter: Eingangs-Gain wird im Preamp-Worklet empfangen und
  geglättet, aber nicht verwendet. Toter Code `channelSelection` in `app.js`.

### 5. Wartbarkeit (nur vor größeren neuen Funktionen)

- [ ] `app.js` (rund 4900 Zeilen, ein Geltungsbereich) in Module je Bereich
  zerlegen: DEV LAB, Theme, MIDI, Analyzer, je Modus.
- [ ] Nicht genutzte Feedback-Architekturen aus `processChannelFrame` auslagern
  oder entfernen, sobald der Produkt-Core feststeht. Verliert A/B-Vergleiche im
  DEV LAB.
- [ ] `syncLegacyLfoAliases` und weitere Legacy-Spiegelungen abbauen.

### 6. UI-Vereinheitlichung (eigener Branch, bricht Layout-Tests)

- [ ] Drei feste Button-Größen an die `ui-role-*`-Klassen binden (derzeit 28
  Varianten aus Höhe, Schrift und Gewicht außerhalb von DEV LAB).
- [ ] Eine gemeinsame Parameter-Komponente (Label, Wert, Slider) mit gleichen
  Schriftgrößen in allen Modi; Panel-Kopf vereinheitlichen.
- [ ] Feste Pixelwerte durch die vorhandenen `--text-*`-Tokens ersetzen,
  `font: inherit` für Buttons, Mindestschrift 9 px.
- [ ] Zweckentfremdete Klassen umbenennen (`dynamic-eq-view-toggle` als
  allgemeiner Button, `filter-parameter-control`, `lfo-*` in fremden Modi).
- [ ] Abgeschnittene Texte: Clock-Mod-Bandbeschriftung und HOLD-Feld, „NO
  TARGET“ in LFO/Envelope, Status-Chips der Filterbank. Leerer MOD-Tab.
- [ ] 36 Media-Query-Blöcke in `styles.css` zusammenführen.

### Größere Funktionslücken zum Original

- MIDI-CC-Mapping/Learn (P1-B, siehe Abschnitt MIDI).
- 20 LFOs und 20 Envelope Follower (App: je 4), Clock-synchrones Morphing,
  Snapshot-Pools, Fußschalter, Lissajous-Anzeige.

## Offenes Backlog – Post-1.0

- DEV/LAB-SNAPSHOTS: bestehende experimentelle Snapshots separat prüfen und pflegen.
- MACRO VALUE ALS META-TARGET (nicht Teil von 1.0):
  - `macro.1.value` … `macro.4.value`
  - LFO → Macro Value, Envelope → Macro Value, Clock Mod → Macro Value
  - Macro Nodes in bestehende DAG/Cycle Detection integrieren
  - Macro → Macro separat bewerten

## Featureblöcke vor 1.0

- Macros im gemeinsamen PRESETS / SNAPSHOTS Workspace: vier manuelle Quellen, gemeinsamer Assignment Core,
  Meta-Targets, Lost Target/Reaktivierung und bestehender State-/Snapshot-Roundtrip.
- PRESETS / SNAPSHOTS ist erledigt: versionierter Produkt-Base-State, read-only
  INIT, User-Library mit JSON-Austausch, persistente A/B-Snapshots und semantisches
  Morph aus unveränderlichen Endpunkten. [Vertrag](presets-snapshots.md).
- FEATURE SET FOR 1.0 COMPLETE: kein „coming later“-Hauptmodus mehr; MOD bleibt leer.
- P1-B MIDI inklusive Mapping/Learn/Relative Encoder bleibt separat offen.

## Nächste Phase – Cleanup / Release-Härtung

1. Backlog-/Status-Cleanup
2. Bestehende Quarantäne bereinigen
3. Architektur-/Doku-Konsistenz
4. UI/UX Cleanup
5. Regression / Performance, einschließlich 96-kHz-Morph-Callback-Reserve
6. Release-Härtung
7. 1.0.0

Feature Freeze bedeutet noch keinen Release. Keine V2-Arbeit in dieser Phase.

## LFO / Modulation

- Kontinuierliche LFO-Phase erst mit eigenem Smoothing-/Cycle-Vertrag bewerten;
  der bestehende Offset kann Waveform-Sprünge erzeugen und ist kein P2-Target.
- Weitere kontinuierliche Modulator-Parameter nur nach fachlicher Prüfung.
- LFO UI V2 bleibt offen; die kompakte P1-A-Bedienung bleibt maßgeblich.

## Envelope Follower / Modulation

- Envelope UI V2 bleibt offen. P2 ergänzt das vorhandene Assignment-Layout.
- Clock Mod Stereo Delay / Spread Delay bleibt ein späteres V2-Thema.

## MIDI

- Globale MIDI-Infrastruktur weiter ausbauen:
  - CONNECTIONS
  - CLOCK
  - MAPPINGS
- MIDI Device Manager:
  - enable/disable
  - refresh
  - device selection
  - dispose/cleanup
  - sauberes Re-Enable
- MIDI Mapping / MIDI Learn mit semantischen Parameter-IDs statt DOM-IDs.
- Hardware-Regler ändern standardmäßig Base Values, nicht Effective Values.
- Mapping-Felder:
  - Device
  - Channel
  - CC/Message
  - Target
  - Input-/Output-Range
  - Curve
  - Invert
  - Pickup/Soft Takeover
- MIDI Learn Workflow:
  - UI-Control auswählen
  - Learn starten
  - Hardware-Regler bewegen
  - Mapping erstellen
- Zentrale Mapping-Übersicht zum Bearbeiten, Löschen und Erkennen von Konflikten.
- Relative Encoder später optional.
- MIDI-Clock BPM-Anzeige stabilisieren, ohne die Clock-Synchronisation träger zu machen:
  - interne Clock-BPM und Display-BPM trennen
  - Historienfenster / robuste Mittelung / Ausreißerbehandlung / Hysterese prüfen

## DSP / Audio

- Legacy PHASE-2 bleibt LAB-Vergleich: spätere Promotion/Entfernung nur mit finalem Klang-/Kalibriervertrag und Audio-/CPU-Vergleich der bestehenden Cores entscheiden.
- Resonator-Hardwarekalibrierung nach der LOCAL/MAIN-Topologiekorrektur:
  - Q/Bandbreite gegen echte Hardwaremessung
  - genaue LOCAL-/MAIN-Loop-Gains und MAIN-Normalisierung
  - Sättigungskennlinie und tatsächlicher Feedback-Tap
  - Self-Oscillation-Schwellen gegen Hardware abgleichen
  - analoge Bauteiltoleranzen nur nach Referenzmessung modellieren
  - CURRENT/Common Bus als eigenen da_filta-Charakter und Unified ZDF als DEV/LAB-Vergleich erhalten

## Erledigt – Feedback-Tap / Input (2026-10-07)

- Band-Modulation (LFO, Envelope, Clock Mod, FILTER, Spread) wirkt in UNIFIED und
  PER-BAND ZDF auf LOCAL- und MAIN-POST-GAIN-Taps wie der Fader; DEV LAB
  `DEV FB TAP MOD` erhält das alte FADER-ONLY-Verhalten. Dynamic EQ bleibt außerhalb.
- Mono-Eingänge (Gerät oder Sample) werden vor Input Character auf L/R verteilt;
  vorher blieb der rechte Kanal still.
- PER-BAND ZDF + ISOLATED TPT (DEV): Fader- und Gate-Änderungen werden wieder geglättet
  und hörbar.

## Erledigt – Erica-style Resonator (2026-10-02)

- Product LOCAL verwendet den vorhandenen Per-Band-ZDF-Core mit privaten impliziten Returns je Band.
- MAIN/FB ALL bleibt eine separate Summenschleife am gemeinsamen Eingang, gekoppelt im vorhandenen ZDF-Solver; LOCAL und MAIN funktionieren gleichzeitig.
- Signed Resonance steuert Stärke und Polarität beider Loops; null liefert keinen Feedbackbeitrag.
- Defaults, Restore, Panic und DEV/LAB-Vergleiche sind konsistent. Messvertrag und Grenzen: [Resonator-Produktpfad](resonator-production.md).

## Code / Architektur / Wartbarkeit

- CSS für zentrale Layoutflächen konsolidieren und überlappende Media Queries bereinigen, wenn eine passende Layoutänderung ansteht.
- State-/Parametervertrag klar halten:
  - Base
  - Modulation
  - Effective
  - DSP
- Modulation Core weiter als allgemeines `Source → Assignment → Target → Effective Value`-System ausbauen.
- AudioWorklet-/Parameterverwaltung bei passenden Umbauten weiter aufräumen.

## Erledigt – P0 Quality (2026-10-02)

- Negative Resonanz über UI, State, AudioEngine, Wrapper, Worklet und geschützten
  Output geprüft. Audiovergleiche für CURRENT, Common Bus, Local Loop, Unified ZDF
  und Per-Band ZDF bei 44,1/48/96 kHz belegen signed DSP-Wirkung. Geschlossene Gates
  und FILTERBANK OFF bleiben neutral; kein bestätigter DSP-Bug, keine Klangänderung.
- Core-Switch-Quarantäne aufgelöst: positive Pre-ZDF- und bewusst geänderte negative
  CURRENT-Verträge behalten jeweils exakte historische Sample-Identität.
- Feedback-Quarantäne aufgelöst: produktiver CURRENT-Bus, gepaarte Audiovergleiche
  und Tail-Energie in vier Zeitfenstern ersetzen Annahmen des alten Resonatorpfads.
- LFO-Visualisierung: Achse, Nulllinie, Preview und finaler Live-Marker verwenden
  bipolar −1…+1, unipolar 0…+1 und mit INVERT −1…0. LFO-DSP unverändert.

## Erledigt – P1-C DSP / Legacy (2026-10-02)

- Produktiver Input-Character-FIR-Differenzpfad mit adaptiver 1×/2×/4×-Matrix,
  festen 192 Samples Latenz, warmem Stage-Handover und stummem Start integriert.
  Native 96-kHz-Gesamtgraph-Reserve ist im P2-Bericht unten quantifiziert;
  auch der alte 1×-Pfad zeigt im aktuellen Gesamtlastvergleich Budgetausreißer.
- PHASE-2 fachlich eingeordnet: vorhandenen isolierten LOCAL-LAB-Vergleich
  behalten; keine zusätzliche, unkalibrierte Resonatorarchitektur erfinden.
  Bereits implementierter Per-Band-ZDF-Phase-2-MAIN bleibt unabhängig erhalten.
- `spreadCurve` / `spreadMode` ausdrücklich interne Kompatibilitätsfelder;
  inaktiven Curve-Selector entfernt, vorhandene Audio-/Restore-Semantik bewahrt.
- Obsoleten MOD-Platzhalter entfernt; alte `modulated`-Werte bleiben beim Laden
  folgenlos. Aktive LFO-/Envelope-Assignments und Clock Mod sind unverändert.
- P1-B MIDI bleibt vollständig offen; keine Mapping-/Learn-/Encoder-Arbeit.

## Erledigt – P2 DSP / Performance (2026-10-02)

- 48-/96-kHz-Input-Character-, Stage-Transition-, AudioWorklet-, Telemetrie-
  und Feedback-Core-Kosten gegen den gemergten P1-C-Stand gemessen.
  FIR-History, leere Assignment-Auswertung, MAIN-Ergebnisobjekte und redundante
  reine Parameter-Targets verhaltensneutral optimiert; Audio-/State-Parität
  bleibt samplegenau. Messmethodik und Grenzen: [P2-Bericht](p2-dsp-performance.md).
- CURRENT Common/Local, Unified und Per-Band ZDF einschließlich Solver-
  Iterationen/Fallbacks, positiver/negativer Resonanz und Band-Skalierung verglichen.
  Bestehende Defaults und Klangverträge bleiben erhalten.
- `feedbackAllEngine = legacy` geprüft und bewusst behalten: erreichbarer LAB-,
  Snapshot- und eigener verzögerter MAIN-Klangvertrag. Eine spätere Entfernung
  braucht eine ausdrückliche Produkt-/Kompatibilitätsentscheidung.
- Native Heavy-/Worst-Case-Reserve quantifiziert. Browser-/Host-Ausreißer und
  96-kHz-Heavy-/DEV-Budgetrisiken bleiben dokumentiert; keine allgemeine
  Realtime-Garantie und keine Qualitätsreduktion eingeführt.
- Im unveränderten P1-C-Stand reproduzierte Guard-Test-Race behoben: bestehende
  Bedingungen an ein gemeinsames Telemetrie-Packet gebunden, alle Grenzwerte
  und Guard-/Safety-DSP erhalten.
- P1-B MIDI, allgemeiner Architektur-Ausbau
  und die langfristige Klangentscheidung zwischen den Cores bleiben offen.

## Erledigt – P2 Modulation (2026-10-02)

- Envelope-Single-Routing durch mehrere generische Assignments ersetzt; Clock
  Mod hält weiterhin zehn unabhängige Werte und routet sie über dasselbe System.
  Legacy-Snapshots, leere Arrays, stabile IDs und Lost-Target-Reaktivierung bleiben
  erhalten. Bestehende LFO-Multi-Assignments sind weiter aktiv.
- 20 Meta-Targets: viermal LFO Free Rate/Output Amount und Envelope
  Attack/Release/Output Amount. LFO↔LFO, LFO↔Envelope, Envelope→Envelope sowie
  Clock Mod→LFO/Envelope umgesetzt; log Rate/Zeiten, getrennte Base/Effective
  Values, Summierung und abschließendes Clamping.
- Self-, direkte und Multi-Hop-Zyklen werden strukturell erkannt und blockiert;
  Restore erhält gesperrte Rows. Vorbereitete topologische Auswertung nutzt den
  bestehenden 32-Sample-Control-Takt ohne neue Sample-Loop-Allokationen.
- Kompakte gemeinsame Assignment-Listen und gruppierter Target-Picker statt
  UI-Redesign. Phase bleibt wegen fehlendem kontinuierlichem Phase-Vertrag
  bewusst außerhalb der P2-Registry.
- Audio-/State-Parität, native Routing-/Meta-Kosten und Testprofile:
  [P2-Modulation-Bericht](p2-modulation.md). Keine neue Quarantäne.
- P1-B MIDI inklusive Mapping, Learn und Relative Encoder bleibt offen;
  LFO/Envelope UI V2 bleibt offen.

## Status prüfen / möglicherweise bereits erledigt oder überholt

Diese Punkte nicht blind als offene Arbeit behandeln; vor Umsetzung gegen den aktuellen Stand prüfen:

- 8/10-Band-Modus
- FILTERBANK-Response für 8/10-Band-Modus
- LCXL3 MIDI-Mapping
- LCXL3 Shift-Layer
- Feedback-Pegelsprung untersuchen
- Resonance-Smoothing verbessern
- AudioWorklet-Refactoring
- Audio-Signalweg / Mermaid-Dokumentation
- ältere Keyboard-/MIDI-/Layout-Bugs

## Backlog-Pflegeregeln

- Eine implementierte und verifizierte Funktion aus dem offenen Abschnitt entfernen oder kurz unter „Erledigt“ dokumentieren.
- Bei nur teilweiser Umsetzung den Eintrag präzisieren statt komplett entfernen.
- Neue bestätigte Aufgaben hinzufügen, wenn sie während Entwicklung, Review oder Tests entdeckt und bewusst als spätere Arbeit eingeordnet werden.
- Reine Hypothesen, einmalige Debug-Ideen und temporäre Testnotizen nicht automatisch als Backlog aufnehmen.
- Vor Änderungen am Backlog immer gegen den aktuellen Projektstand prüfen, ob der Punkt noch offen ist.
- Bestehende Designentscheidungen und Komponenten als maßgeblich behandeln; keine neue UI-Sprache nur für einen Backlog-Punkt erfinden.
