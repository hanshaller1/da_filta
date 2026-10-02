# da_filta Backlog

Stand: 2026-10-02

Diese Datei sammelt offene Produkt-, DSP-, Modulations-, MIDI- und Wartungsthemen. Erledigte Punkte sollen aus dem offenen Backlog entfernt oder in einen kurzen Abschnitt „Erledigt“ verschoben werden. Neue bestätigte Aufgaben sollen hier ergänzt werden.

## LFO / Modulation

- Andere LFO-Parameter als Modulations-Targets verfügbar machen, z. B.:
  - LFO Rate
  - LFO Amount
  - LFO Phase
  - weitere kontinuierliche Parameter nach Prüfung
- LFO ↔ LFO Cross-Modulation ermöglichen.
  - Selbstmodulation zunächst nicht erlauben.
  - Modulationszyklen erkennen und für V1 blockieren.

## Envelope Follower / Modulation

Nach Implementierung von Envelope Follower V1:

- LFO kann Envelope-Follower-Parameter als Targets verwenden, z. B. Attack, Release, Amount.
- Envelope Follower kann LFO-Parameter als Targets verwenden, z. B. Rate, Amount.
- LFO ↔ Envelope Follower Cross-Modulation unterstützen.
- Zyklische Modulationsrouten erkennen und für V1 blockieren.

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

- Produktives Input-Character-Oversampling integrieren.
- Optional später: 96-kHz Input-Character-Transition-Performance untersuchen/optimieren.
- PHASE-2 Resonatorpfad fachlich entscheiden.
- `feedbackAllEngine = legacy` prüfen und entfernen, falls endgültig unnötig.
- `spreadCurve` / `spreadMode` sinnvoll implementieren, migrieren oder entfernen.
- Alten `MOD`-Button-State sinnvoll mit dem neuen Modulation Core verbinden oder entfernen.
- Feedback-/Resonanzarchitektur langfristig weiter bewerten:
  - Common Bus als eigener da_filta-Charakter
  - lokale / Per-Band / ZDF-Varianten gezielt vergleichen

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

## Status prüfen / möglicherweise bereits erledigt oder überholt

Diese Punkte nicht blind als offene Arbeit behandeln; vor Umsetzung gegen den aktuellen Stand prüfen:

- 8/10-Band-Modus
- FILTERBANK-Response für 8/10-Band-Modus
- LCXL3 MIDI-Mapping
- LCXL3 Shift-Layer
- Presets
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
