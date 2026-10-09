// Help texts for DEV / LAB controls, groups and the response view. Data only.

const DEV_LAB_HELP = {
  'data-key-step-percent': {
    title: 'KEY STEP', what: 'Bestimmt, wie weit sich ein Band-Fader pro Tastaturschritt bewegt.',
    scope: 'Reine Keyboard-Bedienpräferenz. Der Wert ist ein Prozentanteil des vollständigen Fader-Regelwegs und verändert weder DSP noch Audio.',
    values: [['0.1 %', 'Kleinster Schritt.'], ['5 %', 'Bisheriges Verhalten.'], ['100 %', 'Ein Schritt bis zum Grenzwert.']],
    default: '5 %', note: 'Gültig von 0.1 % bis 100.0 %; die Präferenz wird separat gespeichert und nicht in Sweetspots übernommen.'
  },
  'data-key-speed-hz': {
    title: 'KEY SPEED', what: 'Bestimmt, wie viele Fader-Schritte pro Sekunde beim Gedrückthalten einer Tastaturtaste ausgeführt werden.',
    scope: 'Reine Keyboard-Bedienpräferenz. Der erste Schritt erfolgt sofort; nur weitere Schritte nutzen diese Rate.',
    values: [['1 Hz', 'Ein Wiederholungsschritt pro Sekunde.'], ['30 Hz', 'Bisherige Wiederholrate.'], ['60 Hz', 'Höchste Wiederholrate.']],
    default: '30 Hz', note: 'Gültig von 1 Hz bis 60 Hz; die Präferenz wird separat gespeichert und nicht in Sweetspots übernommen.'
  },
  'data-input-preamp-stage': {
    title: 'DEV INPUT STAGE', what: 'Wählt die feste nichtlineare Kennlinie beziehungsweise Klangcharakteristik.',
    scope: 'Wirkt nach dem Input Gain und vor der Dry/Wet-Verzweigung.',
    values: [['LINEAR', 'Vollständig linear; Character ist klanglich wirkungslos.'], ['SILK', 'Sehr subtiler, symmetrischer Peak-Rounding-Charakter.'], ['TAPE', 'Weiche, runde Saturation mit sanfter Verdichtung.'], ['TUBE', 'Warme asymmetrische Sättigung mit kompensiertem DC-Anteil.'], ['CONSOLE', 'Direkter, punchiger Charakter mit definierterem Knee.'], ['CRUNCH', 'Härtere, deutlich hörbare Verzerrung.'], ['DESTROY', 'Hartes, experimentelles Clipping/Fold-Verhalten.']],
    default: 'LINEAR', note: 'Input Gain = Ansteuerung. DEV CHARACTER = Charakteranteil. Die Kennlinie bleibt fest und verändert sich nicht automatisch mit dem Gain; keine Loudness Compensation.'
  },
  'data-input-character-amount': {
    title: 'DEV CHARACTER', what: 'Bestimmt unabhängig vom Input Gain, wie stark der gewählte Stage-Charakter dem linearen Signal aufgeprägt wird.',
    scope: 'Wirkt nach dem Input Gain im Input-Stage-Worklet und vor der Dry/Wet-Verzweigung.',
    values: [['0 %', 'Exakt linearer Ausgang; Input Gain bleibt aktiv.'], ['50 %', 'Hälftige Mischung aus linearer Eingangsspur und voller Stage-Kennlinie.'], ['100 %', 'Voller Charakter der gewählten Stage.']],
    default: '50 %', note: 'Input Gain = Ansteuerung, Character = Charakteranteil. Der Regler fügt keinen linearen Gain hinzu; bei LINEAR ist er klanglich wirkungslos.'
  },
  'data-output-guard-enabled': {
    title: 'OUTPUT GUARD', what: 'Schaltet die dynamische Stereo-Pegelreduktion hinter dem Master ein oder aus.',
    scope: 'Feste Position vor FINAL SAFETY, außerhalb aller Feedback-Loops; beide Kanäle verwenden denselben Gain.',
    values: [['ON', 'Hohe Pegel werden zeitabhängig in Richtung GUARD THRESHOLD reduziert.'], ['OFF', 'Der Guard greift nicht ein. FINAL SAFETY bleibt separat einstellbar.']],
    default: 'ON', note: 'Ohne Lookahead; kurze Attack-Overshoots fängt die nachfolgende FINAL SAFETY ab.'
  },
  'data-output-guard-threshold': {
    title: 'GUARD THRESHOLD', what: 'Zielpegel der dynamischen Gain Reduction in linearem Full Scale.',
    scope: 'Nur bei OUTPUT GUARD ON aktiv; kein Makeup Gain.',
    values: [['0,25 FS', 'Früher Eingriff.'], ['0,80 FS', 'Standard.'], ['0,95 FS', 'Später Eingriff.']],
    default: '0,80 FS', note: 'Bereich 0,25 bis 0,95 FS; ein kurzer Overshoot während ATTACK ist möglich.'
  },
  'data-output-guard-attack-ms': {
    title: 'ATTACK', what: 'Zeitkonstante für das Einsetzen zusätzlicher Gain Reduction.',
    scope: 'Nur bei OUTPUT GUARD ON relevant; kein Lookahead und keine zusätzliche Audio-Latenz.',
    values: [['0,1 ms', 'Sehr schnell.'], ['2 ms', 'Standard.'], ['50 ms', 'Langsamer, mit größerem Overshoot.']],
    default: '2 ms', note: 'Bereich 0,1 bis 50 ms.'
  },
  'data-output-guard-release-ms': {
    title: 'RELEASE', what: 'Zeitkonstante für die Rückkehr des Guard-Gains Richtung 1.',
    scope: 'Nur bei OUTPUT GUARD ON relevant.',
    values: [['20 ms', 'Schnelle Erholung.'], ['250 ms', 'Standard.'], ['2000 ms', 'Langsame Erholung.']],
    default: '250 ms', note: 'Bereich 20 bis 2000 ms.'
  },
  'data-output-protection-enabled': {
    title: 'FINAL SAFETY', what: 'Schaltet die letzte statische Peak-Sicherung nach dem OUTPUT GUARD ein oder aus.',
    scope: 'Feste Position vor dem Audioausgang, außerhalb aller Feedback-Loops. Der direkte BYPASS-Pfad bleibt unverändert.',
    values: [['ON', 'Peaks oberhalb von SAFETY KNEE START werden weich gegen 0,99 FS begrenzt.'], ['OFF', 'Der bearbeitete Ausgang bleibt ohne finale Begrenzung; Pegel über 1,0 FS sind möglich.']],
    default: 'ON', note: 'Umschalten wird geglättet; keine Routing-Auswahl.'
  },
  'data-output-protection-threshold': {
    title: 'SAFETY KNEE START', what: 'Beginn der weichen finalen Ausgangsbegrenzung als linearer Full-Scale-Pegel.',
    scope: 'Nur bei FINAL SAFETY ON aktiv. Werte darunter bleiben unverändert.',
    values: [['0,50 FS', 'Früher Eingriff.'], ['0,80 FS', 'Standard, etwa -1,94 dBFS.'], ['0,95 FS', 'Später Eingriff.']],
    default: '0,80 FS', note: 'Bereich 0,50 bis 0,95 FS; die Ausgangsgrenze bleibt 0,99 FS.'
  },
  'data-output-protection-softness': {
    title: 'SOFTNESS', what: 'Bestimmt die Stärke der weichen Biegung oberhalb des Threshold.',
    scope: 'Nur bei FINAL SAFETY ON aktiv; ändert weder Feedback noch Master-Gain.',
    values: [['0 %', 'Schnellerer Übergang zur 0,99-FS-Grenze.'], ['100 %', 'Weichster Verlauf.']],
    default: '100 %', note: 'Die Kennlinie ist am Knee Start stetig und bleibt unter dem Eingangspegel.'
  },
  'data-reference-level': {
    title: 'DEV REFERENCE', what: 'Steuert den Anteil des Unity-Reference-Pfads im Wet-Signal.',
    scope: 'Nur im Wet Model REFERENCE + DELTA; Band-Gains werden nicht direkt verändert. Im FILTERBANK SUM-Wet-Modell wirkungslos.',
    values: [['100 %', 'Voller Unity-Reference-Anteil.'], ['75 %', 'Reference-Anteil 0,75.'], ['50 %', 'Reference-Anteil 0,50.'], ['25 %', 'Reference-Anteil 0,25.'], ['0 % / BANDS ONLY', 'Kein Unity-Reference-Anteil; im REFERENCE + DELTA-Modell bleibt der Band-/Delta-Anteil.']],
    default: '100 %', note: 'Experimenteller Wet-Model-Vergleich; keine Hardwarebehauptung.'
  },
  'data-band-boost-db': {
    title: 'DEV BAND BOOST', what: 'Legt den maximalen positiven dB-Bereich der Band-Gain-Fader fest.',
    scope: 'Wirkt auf die positive Hälfte jedes Band-Faders; Zwischenwerte werden linear im dB-Bereich abgebildet.',
    values: [['+12 dB', 'Fader +100 = +12 dB.'], ['+18 dB', 'Fader +100 = +18 dB.'], ['+24 dB', 'Fader +100 = +24 dB.']],
    default: '+12 dB', note: 'Experimenteller Kalibrierwert; kein bestätigter Erica-Hardwarewert.'
  },
  'data-band-cut-db': {
    title: 'DEV BAND CUT', what: 'Legt den maximalen negativen dB-Bereich der Band-Gain-Fader fest.',
    scope: 'Wirkt unabhängig vom Boost auf die negative Hälfte der Band-Fader; bei -60 dB sind -100 = -60 dB, -50 = -30 dB und 0 = 0 dB.',
    values: [['-12 dB', 'Fader -100 = -12 dB.'], ['-24 dB', 'Fader -100 = -24 dB.'], ['-36 dB', 'Fader -100 = -36 dB.'], ['-48 dB', 'Fader -100 = -48 dB.'], ['-60 dB', 'Fader -100 = -60 dB.']],
    default: '-12 dB', note: 'Experimenteller Kalibrierwert; kein bestätigter Erica-Hardwarewert.'
  },
  'data-spread-max-offset-db': {
    title: 'DEV SPREAD MAX OFFSET', what: 'Legt den maximalen CLASSIC-SPREAD-Offset pro Kanal fest.',
    scope: 'Legt unmittelbar Min/Max des globalen SPREAD-Reglers fest. Eine notwendige Bereichsklemmung materialisiert neue L/R-Bandwerte.',
    values: [['3 dB', 'Maximal ±3 dB pro Kanal.'], ['6 dB', 'Maximal ±6 dB pro Kanal.'], ['9 dB', 'Maximal ±9 dB pro Kanal.'], ['12 dB', 'Maximal ±12 dB pro Kanal.']],
    default: '6 dB', note: 'Neutraler Test-Startwert, keine Produktionsentscheidung.'
  },
  'data-wet-model': {
    title: 'DEV WET MODEL', what: 'Wählt die experimentelle Bildung des Wet-Ausgangs.',
    scope: 'Wirkt im Wet-Pfad vor der Ausgabe; beeinflusst nicht die trockene Referenz direkt.',
    values: [['REFERENCE + DELTA', 'Unity-Reference plus Summe der durch Band-Gain erzeugten Delta-Beiträge.'], ['FILTERBANK SUM', 'Summe der tatsächlichen Bandpfade ohne direkten Unity-Reference-Pfad.']],
    default: 'FILTERBANK SUM', note: 'Bandsumme im Produktpfad; REFERENCE + DELTA bleibt DEV/LAB-Vergleich.'
  },
  'data-feedback-topology': {
    title: 'DEV FB TOPOLOGY', what: 'Wählt die Vergleichstopologie zusammen mit FEEDBACK CORE.',
    scope: 'PER-BAND ZDF verwendet unter COMMON BUS und LOCAL LOOP EXP private implizite LOCAL-Schleifen plus gekoppeltes MAIN. Mit CURRENT führt COMMON BUS Band-Taps an alle Base-Filter zurück; LOCAL LOOP EXP verwendet private One-Sample-Returns. ISOLATED TPT bleibt der ältere Resonator-/Residualvergleich.',
    values: [['ISOLATED TPT', 'Ältere separate Resonator-/TPT-Architektur.'], ['COMMON BUS · DA_FILTA-ORIGINAL', 'Die eingeschalteten FB-Bandtasten wählen Bus-Abgriffe. Der gemeinsame Return speist alle zehn Base-Bänder desselben Kanals.'], ['LOCAL LOOP EXP', 'Jedes aktive Band besitzt einen getrennten lokalen äußeren Loop; MAIN/FB ALL kann zusätzlich weiterlaufen.']],
    default: 'COMMON BUS · DA_FILTA-ORIGINAL', note: 'FB ALL ist ein separater MAIN-Bus mit eigenem Gate, kein Master der zehn FB-Bandtasten.'
  },
  'data-feedback-core': {
    title: 'FEEDBACK CORE', what: 'DEV/LAB-Vergleich der vorhandenen Feedback-Cores; PER-BAND ZDF ist der Produktstandard.',
    scope: 'PER-BAND ZDF löst LOCAL je Band und MAIN aus der Bandsumme gemeinsam ohne expliziten Sample-Delay. CURRENT COMMON erhält den ursprünglichen verzögerten Bus-Sound; UNIFIED ZDF verwendet einen gemeinsamen impliziten Return. SHARED BUS · BAND SAT folgt dem Blockschaltbild der Hardware: gemeinsamer linearer Eingangssummierer, Begrenzung in der Gain-Stufe jedes Bands.',
    values: [['CURRENT COMMON', 'Vorhandener CURRENT-Core; COMMON BUS oder LOCAL LOOP EXP bestimmt dessen Routing.'], ['UNIFIED ZDF', 'Gemeinsamer impliziter LOCAL/MAIN-Return.'], ['PER-BAND ZDF', 'Private implizite LOCAL-Returns plus separater gekoppelter MAIN-Return.'], ['SHARED BUS · BAND SAT', 'Aktive Bänder speisen einen gemeinsamen impliziten Return in alle Bänder; jedes Band sättigt hinter Fader und Modulation selbst, auch ohne Feedback. FB ALL addiert alle Bänder auf denselben Summierer. DEV FB TOPOLOGY, TAP, TAP MOD und FB SAT wirken hier nicht.']],
    default: 'PER-BAND ZDF', note: 'Explizite DEV-Snapshots behalten ihren Core. Frequenzen, Q und normale FB-Bedienelemente bleiben unverändert.'
  },
  'data-local-loop-tuning': {
    title: 'DEV LOCAL LOOP TUNING', what: 'Wählt die interne Stimmung des experimentellen lokalen Feedback-Loops.',
    scope: 'Wirkt ausschließlich bei LOCAL LOOP EXP. CURRENT lässt die Base-Bandzentren unverändert; COMPENSATED verschiebt nur die Testbänder 218 Hz, 777 Hz, 1.5 kHz und 2.8 kHz abhängig von der tatsächlichen Worklet-Sample-Rate und dem vorhandenen TPT-Q.',
    values: [['CURRENT', 'Unveränderte Base-Bandzentren und das bisherige One-Sample-Delay-Verhalten.'], ['COMPENSATED', 'Stimmt die vier Testbänder intern höher, damit deren verzögerte lokale Selbstoszillation näher an der nominalen Bandfrequenz liegt.']],
    default: 'CURRENT', note: '5.2 kHz und 11 kHz bleiben unverändert. Gain, Saturation, Delay, MAIN/FB ALL und alle anderen Topologien werden nicht angepasst.'
  },
  'data-feedback-tap': {
    title: 'DEV FB TAP', what: 'Legt fest, ob der lokale COMMON-BUS-Tap Band-Ausgänge vor oder nach Band-Gain verwendet.',
    scope: 'Nur lokaler COMMON-BUS-Feedback-Tap; bei ISOLATED TPT und ohne lokalen Common Bus wirkungslos.',
    values: [['PRE GAIN', 'Verwendet den unverstärkten Base-Bandpass-Ausgang.'], ['POST GAIN', 'Verwendet den mit (1 + deltaGain) gewichteten Band-Ausgang; Boost/Cut verändert dadurch zusätzlich den lokalen Loop-Tap.']],
    default: 'PRE GAIN', note: 'Experimenteller DEV-Wert; keine Änderung an Band-Gain selbst.'
  },
  'data-feedback-tap-modulation': {
    title: 'DEV FB TAP MOD', what: 'Legt fest, ob Band-Modulation in die POST-GAIN-Feedback-Taps der ZDF-Cores einfließt.',
    scope: 'Nur UNIFIED ZDF und PER-BAND ZDF mit POST GAIN-Tap bzw. POST-GAIN-MAIN-Summe. Betrifft LOCAL und MAIN; CURRENT verwendet Modulation im Tap unverändert immer. Dynamic-EQ-Gain bleibt in beiden Fällen außerhalb des Loops.',
    values: [['FADER + MOD', 'Der Tap folgt dem effektiven Band-Gain aus Fader plus LFO, Envelope, Clock Mod, FILTER- und Spread-Modulation. Moduliertes −12 dB wirkt auf die Resonanz wie ein Fader auf −12 dB.'], ['FADER ONLY · LEGACY', 'Bisheriges Verhalten: Nur der Fader gewichtet den Tap; Modulation verändert ausschließlich den hörbaren Pegel.']],
    default: 'FADER + MOD', note: 'Ohne aktive Band-Modulation sind beide Werte sample-identisch.'
  },
  'data-common-bus-saturation-mode': {
    title: 'DEV FB SAT', what: 'Wählt die Sättigungskennlinie der Common-Bus-Returns.',
    scope: 'Nur positive COMMON-BUS-Returns: lokaler Common Return und MAIN/FB-ALL-Return werden jeweils mit dieser Kennlinie gesättigt.',
    values: [['CURRENT', 'Bestehende tanh()-Kennlinie.'], ['CONSTANT CEILING', 'Verwendet ceiling * tanh((drive * x) / ceiling).']],
    default: 'CURRENT', note: 'Experimenteller DEV-Wert; im LEGACY-FB-ALL-Pfad nicht die Legacy-Sättigung ersetzen.'
  },
  'data-common-bus-drive': {
    title: 'DEV FB DRIVE', what: 'Bestimmt den Drive-Faktor der CONSTANT-CEILING-Common-Bus-Kennlinie.',
    scope: 'Relevant für positive COMMON-BUS-Returns nur bei CONSTANT CEILING; im CURRENT-Modus wird dieser Wert nicht verwendet.',
    values: [['0.5', 'Niedrigere Ansteuerung der Kennlinie.'], ['1', 'Neutrale Ansteuerung.'], ['2', 'Doppelte Ansteuerung.'], ['4', 'Vierfache Ansteuerung.'], ['8', 'Achtfache Ansteuerung.'], ['16', 'Sechzehnfache Ansteuerung.']],
    default: '1', note: 'Experimenteller DEV-Wert; kein unabhängiger Gain-Regler.'
  },
  'data-common-bus-ceiling': {
    title: 'DEV FB CEILING', what: 'Bestimmt die Ceiling-Amplitude der CONSTANT-CEILING-Kennlinie.',
    scope: 'Relevant für positive COMMON-BUS-Returns nur bei CONSTANT CEILING; im CURRENT-Modus wird dieser Wert nicht verwendet.',
    values: [['0.25', 'Return-Ceiling 0,25.'], ['0.50', 'Return-Ceiling 0,50.'], ['1.00', 'Return-Ceiling 1,00.'], ['2.00', 'Return-Ceiling 2,00.'], ['4.00', 'Return-Ceiling 4,00.']],
    default: '1.00', note: 'Experimenteller DEV-Wert; wirkt zusammen mit der Formel ceiling * tanh((drive * x) / ceiling).'
  },
  'data-feedback-all-engine': {
    title: 'DEV FB ALL ENGINE', what: 'Wählt den MAIN-/FB-ALL-Feedbackpfad.',
    scope: 'LEGACY verwendet den bisherigen Legacy-FB-ALL-Pfad. COMMON BUS bildet einen eigenen MAIN-Return aus der Summe der Base-Band-Ausgänge. FB ALL schaltet nicht die einzelnen FB-Bandtasten.',
    values: [['LEGACY', 'Bisheriger Legacy-FB-ALL-Pfad.'], ['COMMON BUS', 'Eigener MAIN-Common-Bus-Return; lokaler Common Return und MAIN-Return werden getrennt gebildet und gesättigt, dann gemeinsam an den Filterbank-Eingang geführt.']],
    default: 'LEGACY', note: 'Experimenteller Architekturvergleich; keine bestätigte Erica-Schaltung.'
  },
  'data-feedback-all-source': {
    title: 'DEV FB ALL SOURCE', what: 'Wählt die Quelle der MAIN-/FB-ALL-Summe.',
    scope: 'Nur COMMON-BUS FB ALL / MAIN; die Auswahl erfolgt nach Bildung der jeweiligen MAIN-Summe und vor Level, Resonance-Gain und Saturation.',
    values: [['PRE GAIN SUM', 'Summe der Base-Band-Ausgänge vor Band-Gain.'], ['STATIC POST-GAIN SUM', 'Summe der mit Band-Gain vor Dynamic EQ gewichteten Ausgänge; Dynamic-EQ-Gain wird hier nicht verwendet. Ob Band-Modulation in ZDF-Cores einfließt, legt DEV FB TAP MOD fest.']],
    default: 'STATIC POST-GAIN SUM', note: 'Bei LEGACY wirkungslos; experimenteller MAIN-Tap-Vergleich.'
  },
  'data-post-gain-feedback-weight': {
    title: 'DEV POST GAIN FB WEIGHT', what: 'Formt ausschliesslich die Band-Gewichtung der MAIN-/FB-ALL-POST-GAIN-Summe.',
    scope: 'Nur COMMON-BUS-MAIN mit STATIC POST-GAIN SUM. Die Gewichtung nutzt statischen Band-Gain, nicht Dynamic-EQ-Gain; hörbarer Band-Gain und lokaler Tap bleiben unverändert.',
    values: [['CURRENT', 'Verwendet den statischen linearen Band-Gain unverändert.'], ['SOFT KNEE', 'Bis +12 dB identisch; +18 dB werden zu +15 dB und +24 dB zu +18 dB für den MAIN-Tap gewichtet.']],
    default: 'CURRENT', note: 'Statische, zeitunabhaengige Feedback-Gewichtung; keine Kompression des hoerbaren Signals.'
  },
  'data-feedback-all-level': {
    title: 'DEV FB ALL LEVEL', what: 'Skaliert die gebildete MAIN-Tap-Summe.',
    scope: 'Ausschließlich COMMON-BUS-MAIN: MAIN-Tap-Summe → Level → feedbackGain (1.25 * resonance²) → bestehende Saturation → mainCommonReturn. LEGACY ignoriert den Wert.',
    values: [['RAW', 'Faktor 1,0.'], ['1 / SQRT(2)', 'Faktor ≈ 0,7071 (≈ -3,01 dB).'], ['1 / 2', 'Faktor 0,5 (≈ -6,02 dB).'], ['1 / SQRT(10)', 'Faktor 1 / sqrt(10) ≈ 0,316227766.'], ['1 / 10', 'Faktor 0,1.'], ['1 / 20', 'Faktor 0,05.'], ['1 / 40', 'Faktor 0,025.'], ['1 / 80', 'Faktor 0,0125.']],
    default: 'RAW', note: 'Experimentelle feste COMMON-BUS-MAIN-Kalibrierung; keine automatische Normalisierung und keine finale Klangentscheidung.'
  },
  'data-feedback-all-amount': {
    title: 'FB ALL AMOUNT', what: 'Skaliert ausschließlich die Stärke des gemeinsamen FB-ALL/MAIN-Feedback-Loops.',
    scope: 'Nur ZDF PER-BAND mit aktivem FB ALL / MAIN. Der Faktor wirkt im impliziten MAIN-Feedback-Gain vor der MAIN-Sättigung; LOCAL-Feedback bleibt unverändert.',
    values: [['0 %', 'Kein rekursiver MAIN-Return; der günstige LOCAL-only-Pfad bleibt aktiv.'], ['100 %', 'Entspricht exakt dem bisherigen Phase-2-MAIN-Verhalten.']],
    default: '100 %', note: 'Live geglättet; Resonance, FB ALL LEVEL und die LOCAL-Semantik werden nicht verändert.'
  },
  'data-positive-resonance-audition': {
    title: 'CAL DEV RES AUD', what: 'Bestimmt den zusätzlichen Audition-Anteil der positiven lokalen Resonance.',
    scope: 'Nur im positiven lokalen Pfad außerhalb des COMMON-BUS-Modus; wird mit dem hörbaren Residualanteil addiert.',
    values: [['0.10', 'Audition-Gain 0,10.'], ['0.20', 'Audition-Gain 0,20.'], ['0.30', 'Audition-Gain 0,30.'], ['0.40', 'Audition-Gain 0,40.'], ['0.60', 'Audition-Gain 0,60.'], ['0.80', 'Audition-Gain 0,80.'], ['1.00', 'Audition-Gain 1,00.'], ['1.50', 'Audition-Gain 1,50.'], ['2.00', 'Audition-Gain 2,00.'], ['4.00', 'Audition-Gain 4,00.']],
    default: '0.10', note: 'Experimenteller Hörtestwert; im aktuellen COMMON-BUS-Core wirkungslos.'
  },
  'data-positive-resonance-drive': {
    title: 'CAL DEV RES DRIVE', what: 'Bestimmt den Drive der positiven nichtlinearen TPT-Resonator-Saturation.',
    scope: 'Nur im positiven lokalen TPT-/nichtlinearen Resonatorpfad; im COMMON-BUS-Modus werden diese Resonator-Auditionpfade nicht verwendet.',
    values: [['1', 'Drive 1.'], ['2', 'Drive 2.'], ['4', 'Drive 4.'], ['8', 'Drive 8.'], ['16', 'Drive 16.'], ['24', 'Drive 24.'], ['32', 'Drive 32.']],
    default: '1', note: 'Experimenteller Resonator-LAB-Wert; kein FB-ALL- oder Common-Bus-Drive.'
  },
  'data-positive-resonance-damping-floor': {
    title: 'CAL DEV RES FLOOR', what: 'Bestimmt die Restdämpfung des positiven lokalen Resonators bei voller Resonance.',
    scope: 'Nur im positiven lokalen Resonatorpfad; steuert dessen Damping-Skala, nicht den COMMON-BUS-MAIN-Return.',
    values: [['0.10', 'Restdämpfung 0,10.'], ['0.05', 'Restdämpfung 0,05.'], ['0.02', 'Restdämpfung 0,02.'], ['0.00', 'Keine positive Restdämpfung.'], ['-0.02', 'Negative Grenz-/Selbstoszillationsanalyse.'], ['-0.05', 'Stärker negative Grenz-/Selbstoszillationsanalyse.'], ['-0.10', 'Am stärksten negative Grenz-/Selbstoszillationsanalyse.']],
    default: '0.10', note: 'Experimenteller Resonator-LAB-Wert; negative Werte dienen Analyse und sind keine finalen Hardwarewerte.'
  },
  'data-positive-resonance-output': {
    title: 'DEV RES OUTPUT', what: 'Wählt den hörbaren positiven Resonator-Ausgang bzw. Residualtyp.',
    scope: 'Nur im positiven lokalen Resonatorpfad; im aktuellen COMMON-BUS-Core ohne positive lokale Resonator-Audition wirkungslos.',
    values: [['CURRENT RESIDUAL', 'Aktuelles Resonator-Signal minus linearer Base-/Referenzpfad.'], ['NONLINEAR - BASE', 'Nichtlinearer Resonatorausgang minus dessen Base-Anteil.'], ['FULL NONLINEAR', 'Vollständiger nichtlinearer Resonatorausgang; im MATCHED-Modus latenzangepasst rekonstruiert.']],
    default: 'CURRENT RESIDUAL', note: 'Experimenteller TPT-/Residualvergleich.'
  },
  'data-positive-resonance-latency': {
    title: 'DEV RES LATENCY', what: 'Wählt die Latenzvariante des positiven Resonator-Auditionsignals.',
    scope: 'Nur im positiven lokalen Resonatorpfad; der aktuelle COMMON-BUS-MAIN-Pfad verwendet diese Auswahl nicht.',
    values: [['CURRENT', 'Aktuelle, direkt aus dem gewählten Resonatorpfad kommende Latenz.'], ['MATCHED', 'Latenzangepasste Variante für den direkten Vergleich mit dem Base-Pfad.']],
    default: 'CURRENT', note: 'Experimenteller TPT-/Residualvergleich.'
  },
  'data-positive-resonance-curve': {
    title: 'DEV RES CURVE', what: 'Formt die Kennlinie, mit der positive Resonance auf die lokale Resonator-Magnitude abgebildet wird.',
    scope: 'Nur positive lokale Resonance; COMMON BUS deaktiviert den lokalen Resonatorpfad, daher dort wirkungslos.',
    values: [['CURRENT', 'Lineare Resonance-Abbildung.'], ['EARLY', 'Früherer Anstieg über sqrt(resonance).'], ['AGGRESSIVE', 'Früherer/stärkerer Anstieg über cbrt(resonance).']],
    default: 'CURRENT', note: 'Experimenteller Resonator-LAB-Wert.'
  },
  'data-feedback-all-resonance-curve': {
    title: 'DEV RESONANCE CURVE', what: 'Formt ausschließlich die positive Resonance-zu-Feedback-Gain-Kennlinie des COMMON-BUS MAIN-/FB-ALL-Pfads.',
    scope: 'COMMON BUS + FB ALL ENGINE = COMMON BUS: CURRENT verwendet 1.25 * resonance². SOFT KNEE verteilt den oberen kritischen Bereich über mehr Reglerweg und erreicht bei 1.00 weiterhin exakt 1.25. LOCAL LOOP EXP, lokaler Common Bus, negative Resonance und Legacy-Pfade bleiben bei der bisherigen Kennlinie.',
    values: [['CURRENT', 'Unverändert: K = 1.25 * resonance².'], ['SOFT KNEE', 'Glatter A/B-Versuch mit mehr Auflösung vor dem Maximum.']],
    default: 'CURRENT', note: 'Nur Mapping; Topologie, Summierung, Saturation und FB-ALL-Level bleiben unverändert.'
  },
  'data-feedback-all-saturation-return': {
    title: 'DEV MAIN SAT/RETURN', what: 'A/B-Versuch nur im MAIN-/FB-ALL-COMMON-BUS-Return mit normaler CURRENT-tanh-Saturation.',
    scope: 'CURRENT bleibt unveraendert: tanh(K * S). DRIVE 4 / RETURN 0.2 verwendet 0.2 * tanh(4 * K * S). CONSTANT CEILING, lokaler Common Bus, LOCAL LOOP EXP, negative Resonance und Legacy bleiben unveraendert.',
    values: [['CURRENT', 'Unveraendert: tanh(K * S).'], ['DRIVE 4 / RETURN 0.2', 'Vierfacher Drive vor tanh, danach 0.2 Return-Level; Kleinsignal-Steigung 0.8.']],
    default: 'CURRENT', note: 'Nur ein MAIN-Return-A/B-Test; keine Topologie-, Pegel- oder Wet-Modell-Aenderung.'
  },
  'data-negative-resonance-mode': { title: 'NEG MODE', what: 'Wählt den ausschließlich bei negativer Resonance aktiven Feedback-Versuch.', default: 'SIGNED' },
  'data-negative-resonance-curve': { title: 'NEG CURVE', what: 'Normierte Magnitude für negative Resonance.', default: 'SAME AS POSITIVE' },
  'data-negative-resonance-amount': { title: 'NEG AMOUNT', what: 'Skaliert die negative Loop-Stärke von 0 bis 200 %, nicht den Output.', default: '100 %' },
  'data-negative-resonance-local': { title: 'NEG LOCAL', what: 'Schaltet nur den negativen LOCAL-Loop.', default: 'ON' },
  'data-negative-resonance-main': { title: 'NEG MAIN', what: 'Schaltet nur den negativen gemeinsamen MAIN-Loop.', default: 'ON' },
  'data-negative-resonance-phase': { title: 'NEG PHASE', what: 'Steuert ausschließlich den PHASE-Modus.', default: '90°' },
  'data-positive-resonance-engine': {
    title: 'DEV RES ENGINE', what: 'Wählt die Engine des positiven lokalen Resonators.',
    scope: 'Positiver LOCAL-Vergleich in ISOLATED TPT ohne ZDF PER-BAND. Ein gespeichertes PHASE 2 sperrt außerdem die TPT-spezifische LOCAL LOOP COMPENSATED-Abstimmung. Negative Resonance und MAIN folgen ihren eigenen Feedback-Pfaden.',
    values: [['TPT', 'Nichtlinearer positiver TPT-Resonatorpfad mit dem aktuellen Residual-/Audition-Modell.'], ['PHASE 2 · LEGACY', 'Erhaltener älterer LOCAL-Vergleichspfad; keine neue Produktarchitektur.']],
    default: 'TPT', note: 'LAB-Vergleich; keine eigene COMMON-BUS- oder aktive ZDF-Engine. Unabhängig vom bereits implementierten Per-Band-ZDF-Phase-2-MAIN.'
  }
};
const DEV_LAB_GROUP_HELP = {
  input: ['data-input-preamp-stage', 'data-input-character-amount'],
  output: ['data-output-guard-enabled', 'data-output-guard-threshold', 'data-output-guard-attack-ms', 'data-output-guard-release-ms', 'data-output-protection-enabled', 'data-output-protection-threshold', 'data-output-protection-softness'],
  keyboard: ['data-key-step-percent', 'data-key-speed-hz'],
  filterbank: ['data-reference-level', 'data-band-boost-db', 'data-band-cut-db', 'data-spread-max-offset-db', 'data-wet-model'],
  'local-feedback': ['data-feedback-topology', 'data-feedback-core', 'data-local-loop-tuning', 'data-feedback-tap', 'data-feedback-tap-modulation', 'data-common-bus-saturation-mode', 'data-common-bus-drive', 'data-common-bus-ceiling'],
  main: ['data-feedback-all-engine', 'data-feedback-all-source', 'data-post-gain-feedback-weight', 'data-feedback-all-level', 'data-feedback-all-amount', 'data-feedback-all-resonance-curve', 'data-feedback-all-saturation-return'],
  'negative-resonance': ['data-negative-resonance-mode', 'data-negative-resonance-curve', 'data-negative-resonance-amount', 'data-negative-resonance-local', 'data-negative-resonance-main', 'data-negative-resonance-phase'],
  resonator: ['data-positive-resonance-audition', 'data-positive-resonance-drive', 'data-positive-resonance-damping-floor', 'data-positive-resonance-output', 'data-positive-resonance-latency', 'data-positive-resonance-curve', 'data-positive-resonance-engine']
};
const RESPONSE_DEV_LAB_HELP = [
  { title: 'FREEZE / LIVE', what: 'FREEZE hält ausschließlich die sichtbaren DEV-LAB-Livewerte und Zeitgraphen an. Event-Erfassung, Audio und DSP laufen weiter. LIVE setzt nur die visuelle Aktualisierung fort.' },
  { title: 'RESET METRICS', what: 'Löscht ausschließlich Diagnose-Historien, Diagnose-Maxima und resetbare Diagnose-Baselines. Audio- und DSP-Parameter bleiben unverändert.' },
  { title: 'DEBUG CONSOLE', what: 'Öffnet das frei verschiebbare und skalierbare Debug-Panel mit Ereignisprotokoll, Snapshots und Session-Maximalwerten. Die Audioverarbeitung bleibt unverändert.' },
  { title: 'MARK', what: 'Schreibt eine fortlaufende USER-MARK-Zeitmarke für Video- und Audioanalyse in das strukturierte Event-Log. Keine Audio- oder DSP-Änderung.' },
  { title: 'SNAPSHOT', what: 'Schreibt einen kompakten, passiven Momentzustand der vorhandenen Telemetrie und Filterbank-State in das Event-Log. Keine Parameter werden geändert.' }
];

export {
  DEV_LAB_HELP, DEV_LAB_GROUP_HELP, RESPONSE_DEV_LAB_HELP
};
