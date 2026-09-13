# Resonant Filterbank Webapp
## Prototype 0.1 – Spezifikation

## 1. Ziel des Prototyps

Dieser Prototyp bildet zunächst die allgemeine Bedienoberfläche und den FB-Modus der Erica Synths Resonant Filterbank Desktop Version als eigenständige Webapplikation nach.

Der Prototyp soll das physische Gerät nicht 1:1 kopieren, sondern dessen Bedienlogik auf eine Desktop-Webapp übertragen und für Maus- und Tastaturbedienung optimieren.

Der Fokus von Prototype 0.1 liegt auf:

- UI-Struktur
- visueller Umsetzung gemäß Spezifikation und Referenz-Mockup
- Keyboard-Bedienung
- State-Management
- FB-Modus als vollständig umgesetzter UI-/State-Modus
- Feedback-Zuständen
- Stereo-/Spread-Zuständen
- modusspezifischem Workspace

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
- vollständiger Analyzer-/Audio-DSP

## 2. Verbindliche Referenzen

### Funktionale Referenz

Die Datei:

`docs/PROTOTYPE_0.1_SPEC.md`

ist die verbindliche funktionale Spezifikation für Prototype 0.1.

### Visuelle Referenz

Das Mockup:

`docs/PROTOTYPE_0.1_SPEC.png` dient ausschließlich als unverbindliche Stilreferenz für Farbwelt, Grundcharakter und visuelle Sprache. Layout, Struktur, Positionen und Funktionen richten sich ausschließlich nach dieser Spezifikation und dem aktuellen implementierten UI-Stand.

Aktuelle Layout- und Strukturentscheidungen dieser Spezifikation haben Vorrang vor älteren Layoutdetails des Mockups.

Falls Spezifikation und Mockup voneinander abweichen:

- Funktion und Verhalten richten sich nach der Spezifikation.
- aktuelle Layout- und Workspace-Struktur richten sich nach der Spezifikation.
- das Mockup bleibt Referenz für Stil, Farbwelt und visuellen Gesamtcharakter.

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
- Regressionstests

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
├─ package-lock.json
├─ playwright.config.js
├─ .gitignore
│
├─ tests/
│  ├─ smoke.spec.js
│  └─ artifacts/          # erzeugte Test-/Screenshot-Artefakte
│
└─ docs/
   ├─ PROTOTYPE_0.1_SPEC.md
   └─ PROTOTYPE_0.1_SPEC.png
```

`tests/artifacts/` enthält Testausgaben und ist kein produktiver Bestandteil der Webapp.

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
- Zustände zentral und nachvollziehbar verwalten
- keine versteckten Seiteneffekte
- keine unnötigen globalen Variablen
- keine unnötigen Framework-Patterns
- Feedback-State nicht unnötig an einen einzelnen Modus koppeln

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

Die Hardware verwendet dieselben zehn Taster sowohl zur Auswahl von Modi/Hauptfunktionen als auch für modusspezifische Aktionen.

Die Webapp trennt diese Funktionen bewusst:

### Ebene A – globaler Shell-Bereich

Dauerhaft sichtbar:

- globale Slider
- Mode-/Function-Bar

### Ebene B – modusspezifischer Workspace

Unterhalb des globalen Shell-Bereichs befindet sich ein vollständig modusspezifischer Workspace.

Mitte und unterer Bereich dürfen je Modus unterschiedlich aufgebaut sein.

Es besteht ausdrücklich **kein** Zwang, in allen Modi dieselben zehn Fader oder dieselbe Struktur anzuzeigen.

Prototype 0.1 setzt ausschließlich den FB-Workspace vollständig um.

## 7. Mode-/Function-Bar

Die permanente Leiste enthält zehn Einträge.

### Aktive Betriebsmodi

- FB
- FILTER
- CLK MOD
- DYNAMIC EQ

### Hauptfunktionen / Funktionsseiten

- MACRO
- ENV MOD
- LFO MOD
- PLAY / LOAD
- SPECTR
- CONFIG

### Prototype 0.1

Nur FB ist als UI-/State-Modus vollständig umgesetzt und auswählbar.

Die übrigen Einträge:

- bleiben sichtbar
- dürfen visuell leicht deaktiviert dargestellt werden
- erhalten keinen Active-State
- verändern `activeMode` nicht
- schalten keinen Workspace um
- lösen keine erfundene Funktion aus

Ein zusätzliches Popup oder eine Meldung „noch nicht implementiert“ ist nicht erforderlich.

### Tastatur

Die Zahlenreihe `1–0` ist in Prototype 0.1 **nicht** für die Mode-/Function-Bar reserviert.

Sie steuert im FB-Workspace die zehn Band-Feedbacks.

Die Mode-/Function-Bar besitzt in Prototype 0.1 noch keine verbindliche Keyboard-Zuordnung.

Daher zeigt die Mode-/Function-Bar keine Shortcut-Hinweise `1–0` und keine Ziffern an den einzelnen Mode-/Function-Buttons.

## 8. Globale Bedienelemente

Die folgenden globalen Bedienelemente bleiben dauerhaft sichtbar.

Sie werden im UI als Slider dargestellt, nicht als virtuelle Drehregler.

### INPUT GAIN

- normaler Slider
- Wertebereich in Prototype 0.1: 0 dB bis +24 dB
- Default: 0 dB
- keine negativen Input-Gain-Werte
- sichtbare Skala von `0` bis `+24`
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
- Bedeutung abhängig vom Spread-Modus
- Mitte klar sichtbar markieren

### VOLUME

- normaler Slider
- Ausgangslautstärke

## 9. DATA / SHIFT / BACK

### DATA

Prototype 0.1 benötigt keinen DATA-Encoder.

DATA wird in Prototype 0.1:

- nicht dargestellt
- nicht implementiert

Eine spätere Feinsteuerung kann bei Bedarf separat spezifiziert werden.

### SHIFT

SHIFT bleibt als Tastatur-Modifier erhalten.

Prototype 0.1 verwendet SHIFT ausdrücklich für Sekundärfunktionen, derzeit:

- `Shift + 1–0` = MOD für Band 1–10

Ein sichtbarer SHIFT-Button ist nicht erforderlich.

### BACK

BACK wird in Prototype 0.1:

- nicht dargestellt
- nicht implementiert

Die Webapp baut keine künstliche Hardware-Main-Screen-Navigation nach.

Falls später eine sinnvolle Menü-/Overlay-Navigation entsteht, kann BACK erneut spezifiziert werden.

## 10. FB-Modus

FB ist der einzige vollständig umgesetzte **UI-/State-Modus** in Prototype 0.1.

„Vollständig umgesetzt“ bedeutet in diesem Kontext:

- FB-Workspace vorhanden
- Mausbedienung vorhanden
- Keyboard-Bedienung vorhanden
- zentraler State funktioniert
- Feedback-/MOD-States funktionieren
- Band-Fader funktionieren
- Bandvisualisierung reagiert auf die UI

Nicht enthalten sind:

- finaler Audio-DSP
- klanglich originalgetreue Filtermodellierung
- klanglich originalgetreues Feedback
- finale Modulations-DSP-Logik

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

Im FB-Workspace gibt es zehn vertikale Fader.

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

Für die sichtbare Skala der Band-Fader gilt daher vorläufig:

```text
oben   = +
Mitte  = 0
unten  = −
```

Die internen Werte `-100 ... +100` sind ausschließlich ein UI-/State-Regelweg und keine behauptete dB-Skala.

## 12. Keyboard-Steuerung – deutsches Tastaturlayout

Die Anwendung wird ausdrücklich für ein deutsches QWERTZ-Tastaturlayout entwickelt.

Die Keyboard-Zuordnung wird über `KeyboardEvent.code` abgebildet, damit die physische Tastenposition stabil bleibt.

Nicht davon ausgehen, dass ein US-QWERTY-Layout verwendet wird.

### FB – Band 1 bis 10

Sichtbare Tasten:

```text
1 2 3 4 5 6 7 8 9 0
```

Technisch:

```text
Digit1
Digit2
Digit3
Digit4
Digit5
Digit6
Digit7
Digit8
Digit9
Digit0
```

### MOD – Band 1 bis 10

Sichtbare Tasten:

```text
Shift + 1 ... Shift + 0
```

Technisch:

```text
Shift + Digit1
...
Shift + Digit0
```

`Shift + DigitN` darf nicht zusätzlich FB desselben Bandes toggeln.

## 13. Band-Fader – positive Bewegung

Positive Faderbewegung für Band 1 bis 10:

```text
Q W E R T Z U I O P
```

Technische Zuordnung:

```text
Q = KeyQ
W = KeyW
E = KeyE
R = KeyR
T = KeyT
Z = KeyY
U = KeyU
I = KeyI
O = KeyO
P = KeyP
```

`KeyY` entspricht auf einer deutschen QWERTZ-Tastatur der sichtbaren Taste `Z`.

## 14. Band-Fader – negative Bewegung

Negative Faderbewegung für Band 1 bis 10:

```text
A S D F G H J K L Ö
```

Technische Zuordnung:

```text
A = KeyA
S = KeyS
D = KeyD
F = KeyF
G = KeyG
H = KeyH
J = KeyJ
K = KeyK
L = KeyL
Ö = Semicolon
```

`Semicolon` entspricht auf einer deutschen QWERTZ-Tastatur der sichtbaren Taste `Ö`.

## 15. Band-Fader – Neutralstellung

Die dritte Tastenreihe setzt das jeweilige Band direkt auf Neutral / Flat.

Deutsches Tastaturlayout:

```text
Y X C V B N M , . -
```

Technische Zuordnung:

```text
Y = KeyZ
X = KeyX
C = KeyC
V = KeyV
B = KeyB
N = KeyN
M = KeyM
, = Comma
. = Period
- = Slash
```

`KeyZ` entspricht auf einer deutschen QWERTZ-Tastatur der sichtbaren Taste `Y`.

`Slash` entspricht auf der vorgesehenen physischen deutschen Position der sichtbaren Taste `-`.

Komma, Punkt und Minus müssen zuverlässig über `KeyboardEvent.code` erkannt werden.

## 16. Verhalten bei Tastendruck

### Einzelner Tastendruck

Ein Tastendruck verändert den jeweiligen Fader verbindlich um:

```text
5 % des gesamten gültigen Fader-Regelwegs
```

Mathematisch:

```js
step = (max - min) * 0.05
```

Danach muss sauber auf `min` bzw. `max` begrenzt werden.

### Gedrückt halten

Gedrückt halten darf das normale Keyboard-Auto-Repeat nutzen.

Das Verhalten muss kontrolliert und gleichmäßig sein.

Keine zusätzliche künstliche Beschleunigung.

### Neutral-Taste

Die Neutral-Taste setzt den jeweiligen Fader sofort exakt auf Mittelstellung.

Die Neutralstellung muss auch nach wiederholten Tastaturänderungen exakt erreichbar bleiben.

## 17. FB- und MOD-Buttons pro Band

Im FB-Workspace besitzt jedes der zehn Bänder zwei getrennte Buttons:

- `FB`
- `MOD`

Beide Controls besitzen unabhängige States.

Folgende Kombinationen sind zulässig:

- FB OFF / MOD OFF
- FB ON / MOD OFF
- FB OFF / MOD ON
- FB ON / MOD ON

FB und MOD schließen sich ausdrücklich nicht gegenseitig aus.

### FB

FB repräsentiert den Feedback-Loop des jeweiligen Bandes.

Prototype 0.1 verwendet als vorläufige UI-Logik:

- Klick bzw. zugeordneter Tastendruck toggelt den State
- aktiver State wird sichtbar dargestellt
- erneute Aktion deaktiviert den State

### MOD

MOD repräsentiert die temporäre Bandmodulation aus dem Hardware-Konzept.

Grundlage aus dem Manual:

- temporäre Modulation des jeweiligen Bandes
- Sinus-Modulation
- interne Clock-Frequenz
- 10 % des maximalen Band-Gains

Prototype 0.1 verwendet vorläufig ebenfalls Toggle-Verhalten als UI-State.

Das endgültige Interaktionsverhalten ist noch offen.

Insbesondere darf später noch entschieden werden:

- Hold/Momentary statt Toggle
- Mouse-Down/Mouse-Up-Verhalten
- Key-Down/Key-Up-Verhalten
- Modulationsdauer

Noch kein finaler MOD-DSP implementieren oder vortäuschen.

## 18. Feedback-Konfiguration

Feedback ist ein Zustand der Filterbank und nicht ausschließlich an den FB-Modus gebunden.

Intern werden getrennte Stereo-Zustände vorbereitet:

```text
feedbackBandLeft[0..9]
feedbackBandRight[0..9]

feedbackAllLeft
feedbackAllRight
```

### Band-Feedback

Für jedes der zehn Bänder existiert pro Kanal ein Feedback-State.

Im aktuellen gekoppelten UI können L und R gemeinsam geschaltet werden.

### Feedback All

Feedback All entspricht dem Main-Feedback-Loop der Hardware.

Er führt die kombinierte Summe aller Bänder zurück.

Band-Feedback und Feedback All dürfen gleichzeitig aktiv sein.

Spätere aktive Modi dürfen dieselben Feedback-Zustände verwenden oder darstellen.

Die aktuelle direkte Bedienoberfläche dafür befindet sich im FB-Workspace.

## 19. Darstellung der Feedback-Zustände

Die visuelle Darstellung ist für Prototype 0.1 festgelegt.

### Band-Feedback

- jedes Band besitzt einen sichtbaren `FB`-Button
- der aktive/inaktive State wird direkt am Button dargestellt
- aktive Zustände dürfen mit bestehendem Glow/Outline/Active-State hervorgehoben werden

### Feedback All

- `FB ALL` befindet sich als kompakter Toggle oben rechts im Analyzer-/Bandvisualisierungsbereich
- aktiver/inaktiver State wird direkt am Control dargestellt
- kein zusätzliches großes Feedback-Panel
- keine zusätzliche Feedback-Konfigurationsseite

Optische Detailverfeinerungen sind später möglich, die grundsätzliche Darstellung bleibt jedoch direkt am zugehörigen Control.

## 20. Stereo-State

Intern soll Prototype 0.1 getrennte Zustände für links und rechts vorbereiten, auch wenn die UI zunächst gekoppelt arbeitet.

Verbindliche fachliche Trennung:

```text
bandGainLeft[10]
bandGainRight[10]

feedbackBandLeft[10]
feedbackBandRight[10]

feedbackAllLeft
feedbackAllRight
```

Bei gekoppelter Bedienung dürfen L/R gemeinsam aktualisiert werden.

Keine UI-Duplizierung mit separaten L/R-Buttons ist erforderlich.

Die interne Trennung dient der späteren Stereo- und FB_CH_SELECT-Funktionalität.

## 21. Spread-Modi

Für Prototype 0.1 sind mindestens zwei Spread-Konzepte vorzubereiten:

```text
CLASSIC
FB_CH_SELECT
```

### CLASSIC

- L und R sind im Grundsatz gekoppelt
- CLASSIC SPREAD entspricht dem bekannten Hardware-Konzept
- die exakte mathematische DSP-Abbildung ist derzeit **nicht** spezifiziert
- keine eigene Panning-, Gain-, Offset- oder Verteilungskurve erfinden
- Prototype 0.1 bildet dafür nur UI-/State-Verhalten ab, solange keine separate DSP-Spezifikation vorliegt

### FB_CH_SELECT

Spread dient zur Auswahl des bearbeiteten Kanals:

```text
links   = LEFT
Mitte   = LEFT + RIGHT
rechts  = RIGHT
```

Prototype 0.1 muss diese Zustände sauber abbilden.

## 22. Modusspezifischer Workspace

Unterhalb des globalen Shell-Bereichs befindet sich der modusspezifische Workspace.

Dieser Bereich darf je Modus vollständig unterschiedlich aufgebaut sein.

Es besteht kein Zwang, in anderen Modi zehn Fader oder dieselben Bedienelemente zu zeigen.

### FB-Workspace

Der FB-Workspace besteht aus:

1. großem Bandvisualisierungsbereich über die volle verfügbare Workspace-Breite
2. `FB ALL` oben rechts innerhalb dieses Bereichs
3. darunter zehn Bandzüge
4. pro Band:
   - `FB`
   - `MOD`
   - vertikaler Fader
   - Frequenzbeschriftung

Der Bandvisualisierungsbereich soll als dominantes Element der mittleren Zone auftreten.

Für Prototype 0.1 gelten im Statusbereich folgende Bezeichnungen:

- Titel: `FILTERBANK RESPONSE`
- Spread-Status: `SPREAD MODE  CLASSIC`
- Kanalstatus: `CHANNEL  L + R` bzw. eine gleichwertige klare L/R-Anzeige

Die Bezeichnungen `FB ANALYZER`, `FB CH SELECT  CLASSIC` und `STEREO READY` sollen nicht mehr verwendet werden.

Andere Modi werden in Prototype 0.1 noch nicht umgesetzt.

## 23. Bandvisualisierung

Der aktuelle Bereich `FILTERBANK RESPONSE` ist in Prototype 0.1 **kein echter Spektrumanalyzer**.

Er visualisiert die eingestellten Werte der zehn Filterbänder.

### Verhalten

- Fader nach oben → Darstellung des zugehörigen Bandes steigt
- Fader nach unten → Darstellung des zugehörigen Bandes sinkt
- Neutralstellung → neutrale Darstellung
- nur das geänderte Band wird aktualisiert
- Maus- und Tastaturänderungen aktualisieren die Darstellung unmittelbar

Die zehn Bandgruppen im Graphen sollen horizontal exakt zu den zehn Bandzügen darunter ausgerichtet sein.

Die horizontale Mittelachse jeder Bandgruppe soll mit der horizontalen Mittelachse des zugehörigen Bandzuges übereinstimmen.

Die vertikale Skala verwendet solange kein finaler dB-Bereich spezifiziert ist nur:

```text
+
0
−
```

Konkrete Werte wie `+12` oder `-12` dürfen nicht angezeigt werden.

Solange noch kein echter Audio-DSP vorhanden ist:

- kein Fake-Audio vortäuschen
- kein zufälliges Spektrum als echtes Signal darstellen
- keine FFT- oder echte Audioanalyse behaupten

Ein späterer echter Audio-/Spectrum-Analyzer kann separat spezifiziert werden.

## 24. Keyboard-Mapping im UI

Das Keyboard-Mapping wird nicht dauerhaft auf der Hauptoberfläche angezeigt.

Kein großer Keyboard-Mapping-Bereich im Hauptlayout.

Später optional:

- Hilfe-Menü
- Hilfe-Overlay
- Shortcut-Dialog

Prototype 0.1 benötigt noch kein Hilfe-Menü.

## 25. Mausbedienung

Alle sichtbaren Slider, Fader und Buttons müssen zusätzlich mit der Maus bedienbar sein.

Tastatur und Maus verändern denselben zentralen State.

Keine getrennten Werte für Maus und Tastatur.

Die UI muss nach Tastaturänderungen sofort aktualisiert werden.

Fokussierte `input[type="range"]`-Elemente dürfen die definierten globalen Keyboard-Shortcuts nicht blockieren.

Echte Texteingaben, `textarea`, `select` und `contenteditable` sollen Keyboard-Shortcuts weiterhin schützen.

## 26. Visuelle Anforderungen

Grundstil entsprechend Referenz-Mockup:

- dunkler Hintergrund
- klare Panel-Struktur
- moderne Studio-/Audio-Optik
- dezente Neon-Akzente
- gute Kontraste
- keine übertriebene Animation
- keine verspielten UI-Elemente
- klare Frequenzbeschriftungen
- symmetrische 10-Band-Struktur im FB-Workspace

Das UI soll professionell, funktional und ruhig wirken.

Globale Controls bleiben Slider.

Keine Knobs oder Dropdowns ohne ausdrücklichen Auftrag.

## 27. Responsive Verhalten

Primärziel ist Desktop-Nutzung.

Optimierung zunächst für:

- Windows-PC
- Chrome
- normaler Desktop-Monitor
- Referenzgröße ungefähr 1920 × 1080 px

Prototype 0.1 muss nicht mobil optimiert sein.

Die Oberfläche soll den verfügbaren Desktop-Viewport sinnvoll ausnutzen.

Die zehn Bandzüge sollen möglichst in einer Reihe bleiben, solange dies sinnvoll darstellbar ist.

Keine aufwendige Mobile-Navigation entwickeln.

## 28. State-Modell

Prototype 0.1 besitzt einen klaren zentralen State.

Fachlich mindestens:

```js
{
  activeMode: "FB",

  inputGain: 0,
  resonance: 0,
  dryWet: 50,
  spread: 0,
  volume: -6,

  spreadMode: "CLASSIC",
  channelSelection: "LR",

  bandGainLeft:  [0,0,0,0,0,0,0,0,0,0],
  bandGainRight: [0,0,0,0,0,0,0,0,0,0],

  feedbackBandLeft:  [false,false,false,false,false,false,false,false,false,false],
  feedbackBandRight: [false,false,false,false,false,false,false,false,false,false],

  feedbackAllLeft: false,
  feedbackAllRight: false,

  modulated: [false,false,false,false,false,false,false,false,false,false]
}
```

Die konkrete Implementierung darf davon abweichen, wenn sie klarer und wartbarer ist.

Verbindlich sind:

- fachliche Trennung von L/R
- eigener MOD-State
- Feedback-State nicht ausschließlich an FB gekoppelt
- Maus und Tastatur verändern denselben zentralen State
- HTML-Defaultwerte und State-Defaultwerte dürfen sich nicht widersprechen

Bei aktuell gekoppelter Bedienung dürfen L/R-Werte synchron gesetzt werden.

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

```text
feature/keyboard-control
feature/fb-feedback-ui
feature/audio-engine
fix/fader-range
```

### Branch-Regeln

Vor jedem Entwicklungstask:

1. `git status` prüfen
2. aktuellen Branch prüfen

Wenn ein neuer Feature-/Fix-Task auf `main` beginnt:

- der Benutzer ist dafür verantwortlich, einen passenden Feature-/Fix-Branch anzulegen und lokal auszuchecken
- der Agent darf selbst keinen Branch anlegen oder wechseln
- der Agent weist den Benutzer darauf hin und wartet, wenn für den Task ein Feature-/Fix-Branch vorgesehen ist, aber `main` aktiv ist
- erst nach Bereitstellung des passenden Arbeitsbranches wird mit der Entwicklung fortgefahren

Wenn bereits ein passender Arbeitsbranch aktiv ist:

- dort weiterarbeiten
- nicht eigenmächtig auf einen anderen bestehenden Branch wechseln

Zusätzlich:

- ausschließlich im aktuell passenden Arbeitsbranch arbeiten
- nicht direkt auf `main` entwickeln, wenn für den Task ein Feature-/Fix-Branch vorgesehen ist
- der Agent verändert ausschließlich Projektdateien innerhalb des bereits ausgecheckten Arbeitsbranches
- fremde Änderungen weder stagen noch verwerfen
- kein Merge nach `main` ohne ausdrückliche Freigabe

### Abschluss eines Agenten-Auftrags

Nach Abschluss:

- Tests und Checks ausführen
- `git status` prüfen
- `git diff` prüfen
- sicherstellen, dass keine unbeabsichtigten Änderungen offen sind
- Commit und Push führt der Benutzer außerhalb der Agentenumgebung durch
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

Verbindliche physische Codes:

```js
const FB_CODES = [
  "Digit1","Digit2","Digit3","Digit4","Digit5",
  "Digit6","Digit7","Digit8","Digit9","Digit0"
];

const FADER_UP_CODES = [
  "KeyQ","KeyW","KeyE","KeyR","KeyT",
  "KeyY","KeyU","KeyI","KeyO","KeyP"
];

const FADER_DOWN_CODES = [
  "KeyA","KeyS","KeyD","KeyF","KeyG",
  "KeyH","KeyJ","KeyK","KeyL","Semicolon"
];

const FADER_NEUTRAL_CODES = [
  "KeyZ","KeyX","KeyC","KeyV","KeyB",
  "KeyN","KeyM","Comma","Period","Slash"
];
```

Nicht dieselben Werte an mehreren Stellen hart codieren.

## 34. Prototype-0.1-Abnahmekriterien

Prototype 0.1 gilt als erfolgreich, wenn:

- die Anwendung über `npm start` startet
- das UI der aktuellen Spezifikation und der visuellen Grundsprache des Referenz-Mockups entspricht
- die globale Bedienleiste vorhanden ist
- die permanente Mode-/Function-Bar vorhanden ist
- die Mode-/Function-Bar keine `1–0`-Shortcut-Hinweise oder Ziffern an ihren Buttons zeigt
- nur FB in Prototype 0.1 auswählbar ist; nicht implementierte Einträge keinen Active-State oder Workspace-Wechsel auslösen
- FB als UI-/State-Modus funktioniert
- der FB-Workspace über die volle mittlere Breite einen großen Bandvisualisierungsbereich besitzt
- `FB ALL` oben rechts im Bandvisualisierungsbereich sitzt
- zehn Band-Fader vorhanden sind
- Band-Fader und Bandvisualisierung keine erfundenen `+12/-12 dB`-Werte anzeigen, sondern nur `+ / 0 / −`
- pro Band getrennte `FB`- und `MOD`-Buttons vorhanden sind
- FB und MOD gleichzeitig aktiv sein können
- alle Fader mit der Maus bedienbar sind
- das deutsche Keyboard-Mapping über `KeyboardEvent.code` funktioniert
- `1–0` FB für Band 1–10 steuert
- `Shift + 1–0` MOD für Band 1–10 steuert
- positive Faderbewegung über `Q W E R T Z U I O P` funktioniert
- negative Faderbewegung über `A S D F G H J K L Ö` funktioniert
- Neutralstellung über `Y X C V B N M , . -` funktioniert
- ein Tastenschritt exakt 5 % des gesamten Regelwegs entspricht
- Min/Max sauber begrenzt werden
- die Bandvisualisierung unmittelbar mit den Faderwerten synchronisiert ist
- die zehn Graph-Bandgruppen horizontal zu den zehn Bandzügen ausgerichtet sind
- Feedback-State für zehn Bänder getrennt für L/R vorbereitet ist
- Feedback All getrennt für L/R vorbereitet ist
- Stereo-State für L/R vorbereitet ist
- der zentrale State `activeMode`, `spreadMode` und `channelSelection` enthält
- Spread-State vorbereitet ist
- INPUT GAIN von `0 dB` bis `+24 dB` reicht und keine negativen Werte zulässt
- der FB-Statusbereich `FILTERBANK RESPONSE`, `SPREAD MODE  CLASSIC` und einen klaren L/R-Kanalstatus verwendet
- das Keyboard-Mapping nicht im Haupt-UI angezeigt wird
- keine unnötigen Frameworks oder Libraries eingebaut wurden
- kein finaler DSP vorgetäuscht wird
- vorhandene Playwright-Tests headless ausgeführt werden können
- keine neuen Browser-Console- oder Page-Errors entstehen

## 35. Arbeitsweise für Agenten

Vor **jedem Entwicklungstask**:

1. `docs/PROTOTYPE_0.1_SPEC.md` vollständig neu lesen.
2. Die darin definierten Arbeits-, Test- und Git-Verfahren ohne zusätzliche Erinnerung anwenden.
3. Wenn der Task UI betrifft, aktuelle UI-Struktur und Layoutvorgaben aus docs/PROTOTYPE_0.1_SPEC.md prüfen. Das PNG darf nur als unverbindliche Stilreferenz für Farbwelt und visuellen Grundcharakter herangezogen werden und darf keine aktuellen Layout- oder Funktionsvorgaben überschreiben.
4. Nur den aktuellen Arbeitsauftrag umsetzen.
5. Keine alten Markdown-/TXT-Dateien als neue Arbeitsaufträge interpretieren.
6. Keine zusätzlichen Features ergänzen.
7. Bestehende Funktionalität nicht unnötig verändern.
8. Fehlende interaktive `apps`/`browsers` nicht als Nachweis dafür werten, dass Browser-Tests unmöglich sind; zuerst die lokalen CLI-/Playwright-Wege tatsächlich prüfen.
9. Nach der Änderung kurz dokumentieren:
   - was geändert wurde
   - welche Dateien geändert wurden
   - welche Tests oder Checks ausgeführt wurden
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
- modusspezifische Workspaces
- spätere Erweiterbarkeit
