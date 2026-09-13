# Resonant Filterbank Webapp
## Prototype 0.1 – Spezifikation

## 1. Ziel des Prototyps

Dieser Prototyp bildet zunächst nur die allgemeine Bedienoberfläche und den FB-Modus der Erica Synths Resonant Filterbank Desktop Version als eigenständige Webapplikation nach.

Der Prototyp soll nicht das physische Gerät 1:1 kopieren, sondern dessen Bedienlogik auf eine Desktop-Webapp übertragen und für Maus- und Tastaturbedienung optimieren.

Der Fokus von Prototype 0.1 liegt auf:

- UI-Struktur
- visueller Umsetzung gemäß Mockup
- Keyboard-Bedienung
- State-Management
- FB-Modus
- Feedback-Zuständen
- Stereo-/Spread-Zuständen

Noch nicht Teil von Prototype 0.1 sind:

- finaler DSP
- klanglich originalgetreue Filtermodellierung
- Filter-Modus
- Clocked Modulation
- Dynamic EQ
- Macro
- Envelope Follower
- LFO-Modulation
- Snapshot-System
- vollständige MIDI-Unterstützung
- vollständiger Analyzer-DSP

## 2. Verbindliche Referenzen

### Funktionale Referenz

Die Datei:

`docs/PROTOTYPE_0.1_SPEC.md`

ist die verbindliche funktionale Spezifikation für Prototype 0.1.

### Visuelle Referenz

Das Mockup:

`docs/PROTOTYPE_0.1_SPEC.png`

ist die verbindliche visuelle Referenz für:

- Layout
- Hierarchie
- Abstände
- Grundstil
- Anordnung der Bedienelemente
- dunkles Interface
- neonartige Akzente
- Gesamtcharakter der Oberfläche

Falls Spezifikation und Mockup voneinander abweichen:

- Funktion und Verhalten richten sich nach der Spezifikation.
- Optik und Layout richten sich nach dem Mockup.

Keine zusätzlichen UI-Elemente oder Funktionen erfinden, solange sie nicht ausdrücklich beauftragt wurden.

## 3. Technische Basis

### Frontend

- HTML5
- CSS3
- Vanilla JavaScript

### Runtime / Server

- Node.js
- einfacher lokaler HTTP-Server über `server.js`
- Start über:

```bash
npm start
```

- `npm start` startet:

```bash
node server.js
```

### Lokale Entwicklungsumgebung

Unter Windows PowerShell kann `npm` aufgrund der lokalen PowerShell Execution Policy blockiert sein, weil `npm.ps1` nicht ausgeführt werden darf.

Das ist kein Projektfehler.

Für Start- und npm-Befehle gilt:

- in PowerShell: `npm.cmd ...`
- in Git Bash oder CMD: `npm ...`

Die Anwendung, `package.json` oder npm-Skripte dürfen nicht verändert werden, nur um diese lokale PowerShell-Einschränkung zu umgehen.

### Browser- und UI-Tests

Für automatisierte Browserprüfungen darf Playwright als reine Entwicklungsabhängigkeit (`devDependency`) verwendet werden.

Playwright ist kein Bestandteil der produktiven Frontend-Anwendung und stellt keine Ausnahme von der Vorgabe „keine externen Frontend-Libraries“ dar.

### Browser- und Playwright-Prüfung

Fehlende interaktive `apps`/`browsers` der Agentenumgebung gelten **nicht** als Nachweis, dass Browser-Tests unmöglich sind. Zuerst vorhandene lokale Playwright-Installation, Browser-Binaries und Tests prüfen und headless ausführen.

Für Browser-Prüfungen ist zuerst der vorhandene lokale Testweg zu verwenden:

1. `package.json` und Playwright-Konfiguration prüfen.
2. Vorhandene Tests unter `tests/` prüfen.
3. Vorhandene lokale Browser-Binaries prüfen.
4. Playwright headless ausführen.
5. Browser-Konsole und Page-Errors prüfen.
6. Falls für die Aufgabe relevant, Screenshot in der geforderten Desktop-Auflösung erzeugen.

Erst wenn dieser Weg konkret fehlgeschlagen ist, darf berichtet werden, dass eine Browser-Prüfung nicht möglich war. Dabei ist die konkrete technische Ursache bzw. Fehlermeldung anzugeben.

Zweck:

- lokale Browser-Smoke-Tests
- Prüfung von DOM und CSS
- Simulation von Maus- und Tastatureingaben
- Prüfung der Browser-Konsole
- Erzeugung von Screenshots für UI-Reviews
- spätere Regressionstests

Bevorzugter Testbrowser: Chromium.

Browserprüfungen sollen nach Möglichkeit gegen die lokal laufende Anwendung unter `http://localhost:3000` erfolgen.

### Zielbrowser

- Google Chrome unter Windows 11

### Nicht verwenden

Für Prototype 0.1 ausdrücklich nicht verwenden:

- Vite
- React
- Angular
- Vue
- TypeScript
- jQuery
- CSS-Frameworks
- UI-Frameworks
- externe Frontend-Libraries
- zusätzliche Build-Systeme

Externe Libraries dürfen nur verwendet werden, wenn sie später ausdrücklich freigegeben werden.

## 4. Projektstruktur

Die Grundstruktur soll einfach und transparent bleiben.

Aktuell:

```text
resonant-filterbank-webapp/
│
├─ index.html
├─ styles.css
├─ app.js
├─ server.js
├─ package.json
├─ .gitignore
│
└─ docs/
   ├─ PROTOTYPE_0.1_SPEC.md
   └─ PROTOTYPE_0.1_SPEC.png
```

Die Struktur darf später modular erweitert werden.

Bei wachsender Komplexität sollen insbesondere folgende Bereiche getrennt werden:

- UI
- State
- Keyboard Input
- Audio Engine
- DSP
- Utilities

Keine unnötige Architektur oder Abstraktion einführen, solange sie für den aktuellen Scope nicht benötigt wird.

## 5. Architekturregeln

### Allgemein

- klare Trennung zwischen UI-State und späterem Audio-State
- keine DSP-Logik direkt in UI-Eventhandler einbauen
- UI darf den Audio-State nur über definierte State-Updates verändern
- Zustände sollen zentral und nachvollziehbar verwaltet werden
- keine versteckten Seiteneffekte
- keine unnötigen globalen Variablen
- keine unnötigen Framework-Patterns

### Audio – später

Für spätere Audio-Versionen:

- Web Audio API
- komplexer DSP bevorzugt über AudioWorklet
- DSP nicht im UI-Thread ausführen
- modulare Audioarchitektur
- Feedbackpfade müssen numerisch stabil ausgelegt werden
- Schutz vor unkontrollierter Pegel-Explosion vorsehen
- Klangmodellierung und UI müssen getrennt bleiben

Prototype 0.1 benötigt noch keinen finalen DSP.

## 6. Grundprinzip der Webapp-Bedienung

Die Webapp übernimmt nicht die Navigation des Hardware-Geräts 1:1.

Die Hardware verwendet dieselben zehn Taster sowohl zur Moduswahl als auch für modusspezifische Funktionen.

Die Webapp trennt diese Funktionen bewusst auf zwei sichtbare Ebenen.

### Ebene A – permanente Modusleiste

Die Modusleiste ist jederzeit sichtbar.

Sie dient ausschließlich zur Auswahl von Modi bzw. Hauptfunktionen.

### Ebene B – modusspezifische Band-/Funktionsbuttons

Über den zehn Band-Fadern befindet sich eine separate Reihe von zehn Buttons.

Diese Buttons führen die Funktion aus, die beim Hardware-Gerät die zehn Funktionstaster innerhalb des aktuell aktiven Modus haben.

Dadurch ist kein Wechsel zurück auf einen Main Screen notwendig.

## 7. Modusleiste

Die permanente Modusleiste enthält zehn Buttons.

Reihenfolge:

1. FB
2. FILTER
3. CLK MOD
4. DYNAMIC EQ
5. MACRO
6. ENV MOD
7. LFO MOD
8. PLAY / LOAD
9. SPECTR
0. CONFIG

### Prototype 0.1

Nur FB ist funktional implementiert.

Die übrigen Buttons dürfen:

- sichtbar sein
- visuell deaktiviert sein
- einen „noch nicht implementiert“-Status zeigen

Sie dürfen noch keine erfundene Funktion besitzen.

### Tastatur

Die Modusleiste wird über die deutsche Zahlenreihe gesteuert:

```text
1 2 3 4 5 6 7 8 9 0
```

Zuordnung:

```text
1 = FB
2 = FILTER
3 = CLK MOD
4 = DYNAMIC EQ
5 = MACRO
6 = ENV MOD
7 = LFO MOD
8 = PLAY / LOAD
9 = SPECTR
0 = CONFIG
```

## 8. Globale Bedienelemente

Die folgenden globalen Bedienelemente bleiben dauerhaft sichtbar.

Sie werden im UI als Slider dargestellt, nicht als virtuelle Drehregler.

### INPUT GAIN

- normaler Slider
- späterer Wertebereich: 0 dB bis +24 dB
- Prototype 0.1 zunächst UI-/State-Funktion

### RESONANCE

- bipolarer Slider
- neutrale Stellung in der Mitte
- links: negatives / invertiertes Feedback
- Mitte: kein Feedback
- rechts: positives Feedback

### DRY / WET

- normaler Slider
- links: Dry
- rechts: Wet

### SPREAD

- bipolarer bzw. mittig referenzierter Slider
- Bedeutung im FB-Modus abhängig vom Stereo-Modus
- Mitte klar sichtbar markieren

### VOLUME

- normaler Slider
- Ausgangslautstärke

## 9. DATA / SHIFT / BACK

### DATA

Prototype 0.1 benötigt noch keinen vollständig originalgetreuen DATA-Encoder.

Falls dargestellt:

- als UI-Steuerelement
- keine erfundene Funktion
- spätere Feinsteuerung vorbereiten

### SHIFT

SHIFT bleibt als Modifier-Konzept erhalten.

Prototype 0.1:

- Shift-Taste der Tastatur darf für Sekundärfunktionen verwendet werden
- Verhalten nur dort implementieren, wo es ausdrücklich spezifiziert ist

### BACK

Da die Webapp keine Main-Screen-Navigation wie die Hardware benötigt, ist BACK nicht zum Moduswechsel erforderlich.

Falls BACK dargestellt wird:

- nur für sinnvolle Menü-/Overlay-Navigation
- keine künstliche Hardware-Navigation nachbauen

## 10. FB-Modus

FB ist der einzige vollständig funktionale Modus in Prototype 0.1.

Der FB-Modus arbeitet mit zehn Frequenzbändern:

```text
Band 1  = 29 Hz
Band 2  = 61 Hz
Band 3  = 115 Hz
Band 4  = 218 Hz
Band 5  = 411 Hz
Band 6  = 777 Hz
Band 7  = 1.5 kHz
Band 8  = 2.8 kHz
Band 9  = 5.2 kHz
Band 10 = 11 kHz
```

## 11. Band-Fader

Es gibt zehn vertikale Fader.

Jeder Fader besitzt:

- negativen Bereich
- Mittel-/Neutralstellung
- positiven Bereich

Die neutrale Stellung muss visuell eindeutig erkennbar sein.

### Bedeutung

- oberhalb der Mitte: Boost
- Mitte: Neutral / Flat
- unterhalb der Mitte: Cut

Prototype 0.1 benötigt zunächst keinen final festgelegten dB-Bereich.

Keine erfundenen dB-Werte verwenden.

## 12. Keyboard-Steuerung – deutsches Tastaturlayout

Die Anwendung wird ausdrücklich für ein deutsches QWERTZ-Tastaturlayout entwickelt.

Die Tastaturbelegung soll über physische Tastenpositionen robust umgesetzt werden.

Bei der Implementierung bevorzugt `KeyboardEvent.code` verwenden, wenn dadurch das deutsche Layout konsistenter abgebildet werden kann.

Nicht davon ausgehen, dass ein US-QWERTY-Layout verwendet wird.

## 13. Band-Fader – positive Bewegung

Positive Faderbewegung für Band 1 bis 10:

```text
Q W E R T Z U I O P
```

Zuordnung:

```text
Q = Band 1 hoch
W = Band 2 hoch
E = Band 3 hoch
R = Band 4 hoch
T = Band 5 hoch
Z = Band 6 hoch
U = Band 7 hoch
I = Band 8 hoch
O = Band 9 hoch
P = Band 10 hoch
```

## 14. Band-Fader – negative Bewegung

Negative Faderbewegung für Band 1 bis 10:

```text
A S D F G H J K L Ö
```

Zuordnung:

```text
A = Band 1 runter
S = Band 2 runter
D = Band 3 runter
F = Band 4 runter
G = Band 5 runter
H = Band 6 runter
J = Band 7 runter
K = Band 8 runter
L = Band 9 runter
Ö = Band 10 runter
```

## 15. Band-Fader – Neutralstellung

Die dritte Tastenreihe setzt das jeweilige Band direkt auf Neutral / Flat.

Deutsches Tastaturlayout:

```text
Y X C V B N M , . -
```

Zuordnung:

```text
Y = Band 1 neutral
X = Band 2 neutral
C = Band 3 neutral
V = Band 4 neutral
B = Band 5 neutral
N = Band 6 neutral
M = Band 7 neutral
, = Band 8 neutral
. = Band 9 neutral
- = Band 10 neutral
```

Diese Zuordnung ist als physische deutsche Tastenreihe zu verstehen.

Bei Browser-Keyboard-Events sicherstellen, dass Komma, Punkt und Minus zuverlässig erkannt werden.

## 16. Verhalten bei Tastendruck

Prototype 0.1:

### Einzelner Tastendruck

Ein Tastendruck verändert den jeweiligen Fader um einen kleinen festen Schritt.

Die exakte Schrittweite darf zunächst zentral als Konstante definiert werden.

Empfehlung für den ersten Prototyp:

```text
5 % des gesamten Fader-Regelwegs
```

### Gedrückt halten

Gedrückt halten darf Auto-Repeat nutzen.

Das Verhalten muss kontrolliert und gleichmäßig sein.

Keine unkontrollierte Beschleunigung.

### Neutral-Taste

Die Neutral-Taste setzt den jeweiligen Fader sofort exakt auf Mittelstellung.

## 17. Modusspezifische Buttons über den Fadern

Über jedem der zehn Band-Fader befindet sich ein eigener Button.

Diese Buttons repräsentieren die modusspezifische Funktion der Hardware-Funktionstaster.

Sie sind keine Bypass-Buttons.

Die bisherige Bezeichnung `BYPASS` ist vollständig zu entfernen.

### Im FB-Modus

Die Buttons führen die FB-spezifische Aktion für das jeweilige Band aus.

Grundlage aus dem Manual:

- temporäre Modulation des jeweiligen Bandes
- Sinus-Modulation
- interne Clock-Frequenz
- 10 % des maximalen Band-Gains

Prototype 0.1 darf diese Funktion zunächst als State-/UI-Funktion vorbereiten.

Falls noch kein Audio-DSP vorhanden ist:

- Button-State sichtbar machen
- gedrückten Zustand darstellen
- keine falsche Audiofunktion simulieren

## 18. Feedback-Konfiguration

Der FB-Modus besitzt elf Feedback-Zustände:

```text
10 individuelle Band-Feedbacks
1 Main / Feedback All
```

### Band-Feedback

Für jedes Band existiert ein eigener Feedback-Status:

```text
feedbackBand[0..9]
```

### Feedback All

Zusätzlich existiert:

```text
feedbackAll
```

Feedback All entspricht dem Main-Feedback-Loop der Hardware.

Er führt die kombinierte Summe aller Bänder zurück.

Band-Feedback und Feedback All dürfen gleichzeitig aktiv sein.

## 19. Darstellung der Feedback-Zustände

Feedback-Zustände müssen im UI sichtbar sein.

Noch nicht festgelegt ist die endgültige visuelle Darstellung.

Mögliche spätere Varianten:

- LED
- Glow
- Button-State
- Outline
- Overlay
- Status im zentralen Display

Keine endgültige Darstellung erfinden, wenn sie noch nicht beauftragt wurde.

## 20. Stereo-State

Intern soll Prototype 0.1 bereits getrennte Zustände für links und rechts vorbereiten.

Auch wenn die UI zunächst gekoppelt arbeitet.

Empfohlene State-Struktur:

```text
bandGainLeft[10]
bandGainRight[10]
```

Nicht nur einen gemeinsamen `bandGain[10]` verwenden, wenn dadurch später Stereo-Funktionalität unnötig erschwert wird.

## 21. Spread-Modi

Für den FB-Modus sind mindestens zwei Spread-Konzepte vorzubereiten:

```text
CLASSIC
FB_CH_SELECT
```

### CLASSIC

- L und R grundsätzlich gekoppelt
- Spread kann Stereo-Offset erzeugen

### FB_CH_SELECT

Spread dient zur Auswahl des bearbeiteten Kanals:

```text
links   = LEFT
Mitte   = LEFT + RIGHT
rechts  = RIGHT
```

Prototype 0.1 muss die Zustände sauber abbilden.

Die exakte Audio-Wirkung von CLASSIC SPREAD ist noch nicht Teil des finalen DSP.

## 22. Zentrale Anzeige / Displaybereich

Der zentrale Displaybereich darf größer und übersichtlicher sein als beim Hardware-Gerät.

Er soll mindestens anzeigen können:

- aktiver Modus
- FB aktiv
- Bandwerte
- Left / Right
- Stereo-Zustand
- Spread-Zustand
- Feedback-Zustände
- Feedback All
- relevante Statusinformationen

Der Displaybereich soll die visuelle Sprache des Mockups übernehmen.

Kein Versuch, das kleine OLED der Hardware pixelgenau zu kopieren.

## 23. Analyzer / Visualisierung

Prototype 0.1 darf einen visuellen Analyzer-/Spectrum-Bereich gemäß Mockup enthalten.

Solange noch kein echter Audio-DSP vorhanden ist:

- kein Fake-Audio vortäuschen
- kein zufälliges Spektrum als echtes Signal darstellen
- statische oder klar als Demo erkennbare Visualisierung ist erlaubt

Später kann dieser Bereich an echten Audio-Input gekoppelt werden.

## 24. Keyboard-Mapping im UI

Das Keyboard-Mapping wird nicht dauerhaft auf der Hauptoberfläche angezeigt.

Kein großer Keyboard-Mapping-Bereich im Hauptlayout.

Später optional:

- Hilfe-Menü
- Hilfe-Overlay
- Shortcut-Dialog

Prototype 0.1 benötigt noch kein Hilfe-Menü.

## 25. Mausbedienung

Alle sichtbaren Slider und Fader müssen zusätzlich mit der Maus bedienbar sein.

Tastatur und Maus verändern denselben zentralen State.

Keine getrennten Werte für Maus und Tastatur.

Die UI muss nach Tastaturänderungen sofort aktualisiert werden.

## 26. Visuelle Anforderungen

Grundstil entsprechend Mockup:

- dunkler Hintergrund
- klare Panel-Struktur
- moderne Studio-/Audio-Optik
- dezente Neon-Akzente
- gute Kontraste
- keine übertriebene Animation
- keine verspielten UI-Elemente
- klare Frequenzbeschriftungen
- symmetrische 10-Band-Struktur

Das UI soll professionell, funktional und ruhig wirken.

## 27. Responsive Verhalten

Primärziel ist Desktop-Nutzung.

Optimierung zunächst für:

- Windows-PC
- Chrome
- normaler Desktop-Monitor

Prototype 0.1 muss nicht mobil optimiert sein.

Die Oberfläche darf bei kleinen Viewports horizontal oder proportional angepasst werden, solange die 10-Band-Struktur klar bleibt.

Keine aufwendige Mobile-Navigation entwickeln.

## 28. State-Modell

Prototype 0.1 soll einen klaren zentralen State besitzen.

Minimal:

```js
{
  activeMode: "FB",

  inputGain: 0,
  resonance: 0,
  dryWet: 0,
  spread: 0,
  volume: 0,

  spreadMode: "CLASSIC",
  channelSelection: "LR",

  bandGainLeft: [0,0,0,0,0,0,0,0,0,0],
  bandGainRight: [0,0,0,0,0,0,0,0,0,0],

  feedbackBandLeft: [false,false,false,false,false,false,false,false,false,false],
  feedbackBandRight: [false,false,false,false,false,false,false,false,false,false],

  feedbackAllLeft: false,
  feedbackAllRight: false
}
```

Die konkrete Implementierung darf davon abweichen, wenn sie klarer und wartbarer ist.

Die fachliche Trennung muss erhalten bleiben.

## 29. Keine impliziten Zusatzfunktionen

Der Agent darf nicht selbstständig zusätzliche Funktionen ergänzen.

Insbesondere nicht ohne Auftrag:

- Presets
- MIDI
- Audio Recording
- Drag-and-drop
- Settings-Menüs
- Theme-System
- Animation Framework
- Web Components
- React
- TypeScript
- Backend-API
- Datenbank
- Cloud-Funktion
- Benutzerkonto
- automatische Speicherung
- komplexe Analyzer-Funktionen

## 30. Änderungen und Scope

Bei jedem Entwicklungsauftrag gilt:

- nur den explizit genannten Scope ändern
- bestehende funktionierende Bereiche nicht unnötig anfassen
- keine großflächigen Refactorings ohne Auftrag
- keine versteckten Architekturwechsel
- keine zusätzlichen Dependencies ohne Freigabe
- keine Änderungen nur aus persönlicher Agentenpräferenz

## 31. Git- und Branch-Workflow

### Grundsatz

Ab einem stabilen Basisstand wird nicht mehr direkt auf `main` entwickelt.

Für neue Features, größere Anpassungen und Fehlerbehebungen wird jeweils ein eigener Branch verwendet.

Beispiele:

    feature/keyboard-control
    feature/fb-feedback-ui
    feature/audio-engine
    fix/fader-range

### Branch-Regeln

- ausschließlich im aktuell ausgecheckten Branch arbeiten
- nicht selbstständig auf `main` wechseln
- keine Änderungen direkt auf `main` committen
- vor Beginn `git status` prüfen
- nur Änderungen committen, die zum aktuellen Auftrag gehören
- keine unrelated Änderungen mitcommitten
- vor jedem Commit `git diff` prüfen
- Branch-Wechsel nur durchführen, wenn dies ausdrücklich beauftragt wurde

### Commit-Struktur

- kleine Aufgaben dürfen in einem einzelnen Commit umgesetzt werden
- größere Aufgaben sollen in mehrere logisch sinnvolle Commits aufgeteilt werden, wenn dies Nachvollziehbarkeit, Review oder Fehlersuche verbessert
- ein Commit soll jeweils eine fachlich oder technisch verständliche Änderungseinheit enthalten
- keine künstliche Aufteilung in Mini-Commits ohne eigenen fachlichen Wert
- Zwischenstände nur dann committen, wenn sie in sich konsistent und sinnvoll nachvollziehbar sind

### Commit-Messages

Commit-Messages sollen:

- kurz
- präzise
- aussagekräftig
- auf Englisch
- im Imperativ

formuliert sein.

Beispiele:

    Add German keyboard mapping
    Connect keyboard input to band state
    Add feedback controls to FB mode
    Fix bipolar fader range
    Refine filterbank layout

### Abschluss eines Agenten-Auftrags

Nach Abschluss:

- Tests und Checks ausführen
- `git status` prüfen
- sicherstellen, dass keine unbeabsichtigten Änderungen offen sind
- alle erzeugten Commit-IDs nennen
- alle Commit-Messages nennen
- kurz beschreiben, welcher Commit welchen Teil der Änderung enthält
- bekannte offene Punkte nennen

Erst nach manueller Prüfung bzw. ausdrücklicher Freigabe darf der Branch in `main` gemerged werden.

## 32. Codequalität

Der Code soll:

- lesbar
- modular
- nachvollziehbar
- wartbar
- einfach testbar

sein.

Bevorzugen:

- kleine Funktionen
- sprechende Namen
- zentrale Konstanten
- klare State-Updates
- klare Event-Handler
- wenig implizite Logik

Vermeiden:

- Magic Numbers
- duplizierte Keyboard-Zuordnungen
- duplizierte Banddefinitionen
- tiefe Verschachtelung
- unnötige Klassenhierarchien
- unnötige Patterns

## 33. Zentrale Konstanten

Frequenzen und Keyboard-Mapping sollen zentral definiert werden.

Beispiel:

```js
const BAND_FREQUENCIES = [
  "29 Hz",
  "61 Hz",
  "115 Hz",
  "218 Hz",
  "411 Hz",
  "777 Hz",
  "1.5 kHz",
  "2.8 kHz",
  "5.2 kHz",
  "11 kHz"
];
```

Keyboard-Mappings ebenfalls zentral.

Nicht dieselben Werte an mehreren Stellen hart codieren.

## 34. Prototype-0.1-Abnahmekriterien

Prototype 0.1 gilt als erfolgreich, wenn:

- die Anwendung über `npm start` startet
- das UI dem Referenz-Mockup klar entspricht
- die globale Bedienleiste vorhanden ist
- die permanente Modusleiste vorhanden ist
- FB als aktiver Modus funktioniert
- zehn Band-Fader vorhanden sind
- alle Fader mit der Maus bedienbar sind
- das deutsche Keyboard-Mapping funktioniert
- positive Faderbewegung funktioniert
- negative Faderbewegung funktioniert
- Neutralstellung pro Band funktioniert
- modusspezifische Bandbuttons vorhanden sind
- Feedback-State für zehn Bänder vorbereitet ist
- Feedback All vorbereitet ist
- Stereo-State für L/R vorbereitet ist
- Spread-State vorbereitet ist
- das Keyboard-Mapping nicht im Haupt-UI angezeigt wird
- keine unnötigen Frameworks oder Libraries eingebaut wurden
- kein finaler DSP vorgetäuscht wird

## 35. Arbeitsweise für Agenten

Vor jeder größeren Änderung:

1. `docs/PROTOTYPE_0.1_SPEC.md` vollständig lesen. Die darin definierten Arbeits-, Test- und Git-Verfahren sind verbindlich und müssen ohne zusätzliche Erinnerung angewendet werden. Aussagen über fehlende Browser-/Testmöglichkeiten dürfen erst erfolgen, nachdem die in der Spec beschriebenen lokalen CLI-/Playwright-Wege tatsächlich geprüft wurden.
2. `docs/PROTOTYPE_0.1_SPEC.png` als visuelle Referenz prüfen.
3. Nur den aktuellen Arbeitsauftrag umsetzen.
4. Keine alten Markdown-/TXT-Dateien als neue Arbeitsaufträge interpretieren.
5. Keine zusätzlichen Features ergänzen.
6. Bestehende Funktionalität nicht unnötig verändern.
7. Nach der Änderung kurz dokumentieren:
   - was geändert wurde
   - welche Dateien geändert wurden
   - ob Tests oder Checks ausgeführt wurden
   - ob bekannte offene Punkte verbleiben

## 36. Grundsatz

Die Webapp ist keine pixelgenaue Kopie der Erica Synths Resonant Filterbank.

Sie übernimmt:

- die funktionale Grundidee
- die zehn Bänder
- den FB-Modus
- Feedback-Konzept
- Stereo-Konzept
- zentrale Parameter

und optimiert die Bedienung gezielt für:

- Desktop
- Maus
- deutsches Tastaturlayout
- direkten Zugriff
- übersichtliche Darstellung
- spätere Erweiterbarkeit
