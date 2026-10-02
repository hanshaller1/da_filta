# P2 Modulation / Multi-Target / Cross-Modulation

Stand: 2026-10-02. Branch: `feature/p2-modulation-crossmod`.
Sauberer Ausgangspunkt: gemergter P2-DSP/Performance-Stand
`4f59aa9ded7d9e90d3674d464f58012ae6e636b3` auf `main`.
Kein Commit und kein Push durch den Agenten.

## Ergebnis und Architektur

Envelope hatte vier unabhängige Detektoren, aber nur eine Route je Source.
Clock Mod schrieb zehn gehaltene dB-Werte über einen separaten Band-Layer.
Jetzt nutzen beide das vorhandene P1-A-System:

`Source → Assignment → Target Registry → Mapping → Effective → DSP`.

Meta-Targets ergänzen `Modulator Target → validierter Graph → topologische
Auswertung`. Es gibt weiterhin vier LFOs, vier Envelope Followers und einen
Clock-Mod-Generator; dessen zehn Hold-Taps sind vorhandene Ausgänge, keine
zusätzlichen Modulatoren. Die native dB-Komponente wird beim Band-Apply getrennt
akkumuliert, um die bisherige Summierungsreihenfolge und Clock-Parität zu erhalten.
Sie durchläuft dieselben Assignment-Links und denselben finalen Band-Clamp.

| Bereich | Verhalten |
| --- | --- |
| Envelope Multi-Target | Beliebig viele unabhängige Rows, auch gleiche Targets mehrfach; Source-Detektor/Zeiten/Sensitivity/Delay bleiben getrennt. |
| Clock Multi-Target | LATEST oder BAND 1..10 pro Assignment; alte Zustände ergeben zehn originale Band-Routen. Holds, Clock und MIDI-Transport bleiben unverändert. |
| Gemeinsame Rows | Stabile IDs, Amount, BOTH/LEFT/RIGHT/SPREAD, Invert, Enable, Remove, Availability und Lost Target. Mono-Targets ausschließlich BOTH. |
| Meta-Registry | 20 neue kontinuierliche Mono-Targets, insgesamt 47. LFO Free Rate 0.01..20 Hz und Output Amount 0..100%; Envelope Attack 1..500 ms, Release 10..3000 ms, Output Amount 0..100%. |
| Mapping | Rate und Zeiten logarithmisch; Output Amount linear/normalized. Alle Beiträge summieren vor dem abschließenden Target-Clamp. |
| Cross-Richtungen | LFO→LFO, LFO→Envelope, Envelope→LFO, Envelope→Envelope und Clock Mod→LFO/Envelope implementiert. |
| Base/Effective | UI und Snapshots halten Base; eigene Effective-Felder wirken nur im DSP. Remove/Disable/Unavailable ergibt exakt Base. |
| Graph | Self, direkte 2-Node-, 3-Node- und längere Multi-Hop-Zyklen werden blockiert. Audio-Targets bilden keine Graph-Edge. |
| Evaluation | Stabile topologische Reihenfolge; Quelle veröffentlicht am Control-Tick vor ihrem Ziel. Graphvalidierung nur bei Struktur-/Registry-Änderungen, kein Solver. |
| Restore | Zyklische/unknown Rows bleiben gespeichert und werden sichtbar gesperrt. Enabled unavailable/source-off Edges reservieren den Graph; Reaktivierung erzeugt keinen Zyklus. |
| Availability | Modulator-Modul/Source OFF bzw. LFO Sync-Rate deaktiviert den Beitrag. Automatische Reaktivierung mit gleicher ID. Gründe unterscheiden Invalid, Unavailable, Cycle, Source OFF und Assignment OFF. |
| Migration | LFO/Envelope-Single-Routing wird einmalig zu einer Row, Clock zu zehn Rows. Explizite Arrays einschließlich `[]` bleiben maßgeblich. Snapshot-Version 1 bleibt erhalten; Runtime-Pointer/Graph/Holds werden nicht gespeichert. |
| UI | Bestehende kompakte P1-A-Liste in allen drei Workspaces, gruppierter Picker mit CYCLE-Optionen, Source Output Amount, Clock-HOLD-Auswahl und vorhandene Status-/Slot-Indikatoren. Kein Redesign. |
| Echtzeit | Direkte mutable Source-Handles, aggregierte Links, vorbereitete Target-Records/Clock-Masks/Node-Order. Keine neuen Array-/Objekt-/ID-Allokationen, Graphvalidierung oder Assignment-Scans im Sample-/Control-Loop. |

Die Kontrollrate bleibt 32 Samples. Bestehendes Band-/Parameter-Smoothing,
Routing, Gain Staging und Output Protection bleiben erhalten. Freie LFO-Rate
ändert nur den Phasen-Inkrementpfad ohne Phase-/Random-Reset. Envelope-Zeiten
aktualisieren Koeffizienten ohne Detector-, RMS-, Delay- oder Envelope-Reset.
Die bisherigen Rate-/Zeit-Base-Setter hatten kein zusätzliches Parameter-Smoothing.

Phase ist nach der ausdrücklich bedingten Task-Vorgabe nicht registriert:
der vorhandene Offset wirkt unmittelbar auf die Waveform, besitzt keinen
kontinuierlichen Smoothing-Vertrag und führt Random-Cycle-State getrennt.
Eine Phase-Modulation könnte Sprünge oder widersprüchliche Cycle-Semantik
erzeugen. Sync-Divisionen bleiben diskret. Diese Entscheidungen begrenzen die
freigegebenen Targets; kein erforderlicher P2-Routing-Punkt ist deferred.

## Audio- und Performance-Evidenz

- Zwölf Cross-Modulationsszenarien je 48/96 kHz rendern das tatsächliche
  `filterbank-processor.js` in jeweils eigenen OfflineAudioContexts:
  aktive Route gegen deaktivierte Route sowie identische Wiederholung.
  Alle 24 Szenarien sind endlich, wiederholen samplegenau, haben messbaren
  Audioeffekt und melden keinen Processor Error.
- Gewöhnliche Mehrfachrouten und alte Clock-Konfiguration gegen den eingefrorenen
  Ausgangscommit bei 48/96 kHz: maximale/RMS-Sample-Differenz 0, gleiche Holds.
- Der unveränderte P2-P1-C-Paritätsgate prüft 137 Konfigurationen bei allen
  vorhandenen Raten: Sample-Differenz 0 und gleicher kontinuierlicher State,
  einschließlich Input Character/FIR, MAIN, Feedback/Resonanz und Solver-State.
- P2 Parameter-Dedup bleibt erhalten: 5.300→2.100 Nachrichten im bestehenden
  gezielten Test, ohne Änderung seiner Assertions.

Separate native Chromium-Worklet-Messung mit vier LFOs, zwei Envelope Followers,
zwölf LFO-Audio-Routen, einer Envelope-Audio-Route und zehn Clock-Holds.
Meta fügt sechs azyklische Parameter-Routen hinzu. 1,5 s je Konfiguration;
die ersten 250 ms sind aus den folgenden Render-Statistiken ausgenommen.
Gemessen wird der native 128-Frame-Filterbank-Callback, **nicht der komplette
AudioEngine-Graph**. Der unveränderte DSP-Baseline-Worklet wird aus Git-Modulen
unter dem ignorierten Artefaktpfad geladen, ohne Checkout/Branchwechsel.

| Rate | Stand | Mittel ms | p99 ms | Budget ms | p99-Reserve | Ausreißer über Budget |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 48 kHz | Ausgangspunkt | 0.500 | 0.788 | 2.667 | 70.45% | 0 |
| 48 kHz | gemeinsames Routing | 0.528 | 0.949 | 2.667 | 64.41% | 0 |
| 48 kHz | Routing + 6 Meta-Routen | 0.575 | 0.993 | 2.667 | 62.76% | 0 |
| 96 kHz | Ausgangspunkt | 0.525 | 0.888 | 1.333 | 33.40% | 0 |
| 96 kHz | gemeinsames Routing | 0.551 | 0.981 | 1.333 | 26.43% | 0 |
| 96 kHz | Routing + 6 Meta-Routen | 0.627 | 1.077 | 1.333 | 19.23% | 0 |

Diese isolierte Messung entspricht rund +5–6% Routing-Aufwand und weiteren
+9–14% durch sechs Meta-Routen. Ein zweiter Lauf streut sichtbar, bleibt aber
in diesen gewählten Fällen nach dem Anlauf innerhalb des Budgets. Startup-Maxima
liegen bei ca. 6–9 ms und überschreiten das Render-Budget; sie sind ausdrücklich
kein Beleg für glitchfreien Anlauf. Der Factory-Benchmark auf dem Main Thread
zeigt in gemischten Meta/JIT-Läufen bis etwa doppelte 96-kHz-Kosten; er bildet
keine native Worklet-Reserve ab. Wall-Clock-Assertions sind deshalb grobe
Guardrails; strukturelle Wiederverwendung und Audio-Parität sind die harten Gates.

Es gibt keine allgemeine Realtime-Garantie oder Garantie für beliebig viele
Assignments. Die bestehenden Heavy-/Worst-/Gesamtgraph-Grenzen des
[P2-DSP-Berichts](p2-dsp-performance.md) bleiben relevant. Kein Oversampling,
Solver-Limit, Qualitätsparameter oder Klang-Default wurde reduziert.
Ignorierte lokale Evidenz: `tests/artifacts/p2-crossmod-native-v3/`,
`p2-crossmod-focused-final/` und `p2-crossmod-dsp-parity-v2/`.

## Tests und Git-Hygiene

Neue Tests:

- `tests/modulation-crossmod.test.mjs`: elf Core-/Graph-/Mapping-/Migration-/State-
  Tests, inklusive Multi-Source-Summierung, exakter Base-Rückkehr und Clock-SPREAD.
- `tests/modulation-crossmod.spec.js`: fünf Worklet-/Audio-/Native-/Order-/Parity-
  Tests, einschließlich realer Meta-Effekte, Restore, Sync-Reaktivierung und
  vorbereiteter Handles ohne Sample-Loop-Kompilierung.
- `tests/modulation-crossmod-ui.spec.js`: vier UI-/Snapshot-/Cycle-/Clock-Tests,
  davon einer im Smoke-Profil; Responsive-Checks bei 1914/1440/1024/560 px.
- `tests/helpers/modulation-crossmod.cjs`: eingefrorene Referenz und Messhelfer.

Bestehende Tests passen ausschließlich erwartete Registry-/Assignment-Formen
und Fixtures an den neuen Vertrag an: `clock-mod-core.test.mjs`,
`clock-mod-worklet.spec.js`, `envelope-core.test.js`, `envelope-follower.spec.js`,
`lfo-core.test.mjs`, `modulation-assignments.spec.js`, `modulation-core.test.mjs`
und `modulation-lfo.spec.js`. Keine DSP-Assertion oder Toleranz wurde gelockert.

Abschlussvalidierung:

| Profil / Prüfung | Ergebnis |
| --- | --- |
| `npm.cmd run test:node` | 71/71 bestanden |
| Neue Cross-Modulation, Audio/Graph/Restore/UI, gezielt | 9/9 bestanden |
| Bestehende Envelope/Assignment/Clock-Worklet-Fälle, gezielt | 13/13 bestanden |
| P2 Parität und Parameter-Dedup, gezielt | beide bestanden; 137 Paritätskonfigurationen, Differenz 0, State identisch |
| `npm.cmd run test:browser:smoke` | 11/11 bestanden |
| `npm.cmd run test:browser` | 255/255 bestanden, 15,9 min |
| Abschließende Envelope-Geometriekorrektur | danach 9/9 Envelope-/Cross-UI-Fälle und erneut 11/11 Smoke bestanden |
| `git diff --check` | bestanden |

Die Sichtprüfung mit vier Envelope-Rows zeigte nach dem Standard-Lauf einen
CSS-Kaskadenkonflikt: die Parameterfläche schrumpfte unter die eigenen drei
Grid-Rows und überlagerte Assignments. Die betroffene bestehende Regel reserviert
jetzt die Parameterhöhe und lässt die Assignment-Liste scrollen; neue
Geometrie-Assertions prüfen 1914/1440/1024/560 px. Nur diese CSS-/UI-Testkorrektur
folgte auf den vollständigen Standard-Lauf; die betroffenen alten und neuen
Envelope-/UI-Tests sowie Smoke wurden danach erneut ausgeführt. Der DSP-Code
blieb dabei unverändert. Artefakte nutzen explizite ignorierte Ausgabepfade,
weil der vorhandene Smoke-Ausgabeordner einen EPERM beim Löschen meldete.

Aktive Browser-Fälle: 255; Smoke: 11; Quarantäne: unverändert 14.
Full/Quarantäne werden nicht ausgeführt; keine Retirements oder neuen Tags.

Produktionsdateien: `app.js`, `audio-engine.js`, `modulation-core.mjs`,
`lfo-core.mjs`, `envelope-core.mjs`, `clock-mod-core.mjs`,
`filterbank-processor.js`, `index.html`, `styles.css`.
Dokumentation: dieses Dokument, `docs/modulation-core.md`,
`docs/clock-mod-v1.md`, `docs/BACKLOG.md`, `tests/QUARANTINE.md`.
Die elf neuen Node- und neun Browser-Fälle ersetzen keine vorhandenen Tests.
Screenshots/Traces/Messdaten verbleiben ausschließlich unter ignorierten
Artefaktpfaden; historische Fixtures bleiben unverändert.

P1-B MIDI, Mapping, Learn, Relative Encoder und LFO/Envelope UI V2 bleiben offen.
P1-A LFO-Multi-Assignments, mehrere Envelope-/Clock-Targets, unveränderte Bases,
Multi-Source-Summierung, aktive DAGs ohne Self-/Cycle-Modulation und bestehende
DSP-/Klangverträge bleiben verbindlich.

Status: **P2 MODULATION COMPLETE**. Keine offenen erforderlichen P2-Punkte;
Phase bleibt entsprechend der bedingten Target-Freigabe ein späteres Thema.
