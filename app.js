const {
  BAND_DEFINITIONS,
  BAND_COUNT,
  BAND_GAIN_MIN,
  BAND_GAIN_MAX,
  BAND_GAIN_NEUTRAL,
  GLOBAL_CONTROL_DEFINITIONS,
  controlToBandGainDb,
  createInitialState,
  setBandBaseGain: setStateBandBaseGain
} = window.ResonantState;
const state = createInitialState();
let audioEngine = null;
const POSITIVE_RESONANCE_AUDITION_VALUES = [0.10, 0.20, 0.30, 0.40, 0.60, 0.80, 1.00, 1.50, 2.00, 4.00];
const positiveResonanceAuditionSelect = document.querySelector('[data-positive-resonance-audition]');
const positiveResonanceDriveSelect = document.querySelector('[data-positive-resonance-drive]');
const positiveResonanceDampingFloorSelect = document.querySelector('[data-positive-resonance-damping-floor]');
const positiveResonanceOutputSelect = document.querySelector('[data-positive-resonance-output]');
const positiveResonanceLatencySelect = document.querySelector('[data-positive-resonance-latency]');
const positiveResonanceCurveSelect = document.querySelector('[data-positive-resonance-curve]');
const addDevSelectOptions = (select, values, format = value => String(value)) => {
  if (!select) return;
  values.forEach(value => {
    const optionValue = format(value);
    if ([...select.options].some(option => option.value === optionValue)) return;
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionValue;
    select.append(option);
  });
};
addDevSelectOptions(positiveResonanceAuditionSelect, [1.50, 2.00, 4.00], value => value.toFixed(2));
addDevSelectOptions(positiveResonanceDriveSelect, [24, 32]);
addDevSelectOptions(positiveResonanceDampingFloorSelect, [-0.05, -0.10], value => value.toFixed(2));
const devLabPanel = document.querySelector('[data-dev-lab-panel]');
const devLabToggle = document.querySelector('[data-dev-lab-toggle]');
const devLabControls = document.querySelector('.dev-lab-panel .dev-lab-controls');
const devLabGroups = new Map();
[['input', 'INPUT'], ['filterbank', 'FILTERBANK'], ['local-feedback', 'LOCAL FEEDBACK'], ['main', 'FB ALL / MAIN'], ['resonator', 'LEGACY / RESONATOR LAB']].forEach(([value, label]) => {
  const group = document.createElement('section');
  group.className = 'dev-lab-group';
  group.dataset.devLabGroup = value;
  group.innerHTML = `<h2>${label}</h2>`;
  devLabControls?.append(group);
  devLabGroups.set(value, group);
});
const groupForDevControl = control => {
  const attribute = control.querySelector('select')?.getAttributeNames().find(name => name.startsWith('data-')) ?? '';
  if (attribute === 'data-input-preamp-stage') return 'input';
  if (attribute === 'data-reference-level' || attribute === 'data-band-boost-db' || attribute === 'data-band-cut-db' || attribute === 'data-wet-model') return 'filterbank';
  if (attribute === 'data-feedback-all-engine' || attribute === 'data-feedback-all-source' || attribute === 'data-feedback-all-level') return 'main';
  return 'resonator';
};
const inlineDevLabControls = document.querySelector('.analyzer-header .dev-lab-controls');
inlineDevLabControls?.querySelectorAll(':scope > .dev-audition-control, :scope > .dev-lab-control').forEach(control => {
  devLabGroups.get(groupForDevControl(control))?.append(control);
});
inlineDevLabControls?.remove();
const analyzerHeader = document.querySelector('.analyzer-header');
const analyzerStatus = document.querySelector('.analyzer-status');
const analyzerTitle = analyzerHeader?.querySelector('strong');
if (analyzerHeader && analyzerStatus && analyzerTitle) {
  const titleStatus = document.createElement('div');
  titleStatus.className = 'analyzer-title-status';
  titleStatus.append(analyzerTitle, analyzerStatus);
  analyzerHeader.prepend(titleStatus);
}
const analyzerHeaderControls = analyzerHeader?.querySelector('.analyzer-header-controls');
const analyzerLegend = document.querySelector('.analyzer > .legend');
if (analyzerHeaderControls && analyzerLegend) analyzerHeaderControls.prepend(analyzerLegend);
const analyzer = document.querySelector('.analyzer');
const analyzerAxisX = document.querySelector('.chart-grid .axis-x');
if (analyzer && analyzerAxisX) {
  const analyzerFooter = document.createElement('div');
  analyzerFooter.className = 'analyzer-footer';
  analyzerFooter.append(analyzerAxisX);
  analyzer.append(analyzerFooter);
}
const filterbankWorkspace = document.querySelector('.fb-workspace');
const responseCollapseButton = document.createElement('button');
responseCollapseButton.type = 'button';
responseCollapseButton.className = 'response-collapse-toggle';
const setFilterbankResponseCollapsed = collapsed => {
  filterbankWorkspace?.classList.toggle('is-collapsed', collapsed);
  responseCollapseButton.setAttribute('aria-expanded', String(!collapsed));
  responseCollapseButton.setAttribute('aria-label', collapsed ? 'Filterbank response ausklappen' : 'Filterbank response einklappen');
  responseCollapseButton.textContent = collapsed ? '▾' : '▴';
};
if (analyzerHeaderControls && filterbankWorkspace) {
  setFilterbankResponseCollapsed(false);
  analyzerHeaderControls.append(responseCollapseButton);
  responseCollapseButton.addEventListener('click', () => setFilterbankResponseCollapsed(!filterbankWorkspace.classList.contains('is-collapsed')));
}
devLabToggle?.addEventListener('click', () => {
  const open = Boolean(devLabPanel?.hidden);
  if (devLabPanel) devLabPanel.hidden = !open;
  devLabToggle.classList.toggle('active', open);
  devLabToggle.setAttribute('aria-expanded', String(open));
});
const addDevLabSelector = (label, attribute, options) => {
  const container = devLabGroups.get({
    'data-input-preamp-stage': 'input',
    'data-reference-level': 'filterbank',
    'data-band-boost-db': 'filterbank',
    'data-band-cut-db': 'filterbank',
    'data-wet-model': 'filterbank',
    'data-feedback-topology': 'local-feedback',
    'data-feedback-tap': 'local-feedback',
    'data-common-bus-saturation-mode': 'local-feedback',
    'data-common-bus-drive': 'local-feedback',
    'data-common-bus-ceiling': 'local-feedback',
    'data-feedback-all-engine': 'main',
    'data-feedback-all-source': 'main',
    'data-feedback-all-level': 'main'
  }[attribute] ?? 'resonator');
  if (!container) return null;
  const control = document.createElement('label');
  control.className = 'dev-lab-control';
  const title = document.createElement('span');
  title.textContent = label;
  const select = document.createElement('select');
  select.setAttribute(attribute, '');
  options.forEach(([value, text]) => { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); });
  control.append(title, select);
  container.append(control);
  return select;
};
const referenceLevelSelect = addDevLabSelector('DEV REFERENCE', 'data-reference-level', [['1', '100 %'], ['0.75', '75 %'], ['0.5', '50 %'], ['0.25', '25 %'], ['0', '0 % / BANDS ONLY']]);
const resonanceEngineSelect = addDevLabSelector('DEV RES ENGINE', 'data-positive-resonance-engine', [['tpt', 'TPT'], ['phase2', 'PHASE 2']]);
const bandBoostSelect = addDevLabSelector('DEV BAND BOOST', 'data-band-boost-db', [['12', '+12 dB'], ['18', '+18 dB'], ['24', '+24 dB']]);
const bandCutSelect = addDevLabSelector('DEV BAND CUT', 'data-band-cut-db', [['12', '-12 dB'], ['24', '-24 dB'], ['36', '-36 dB'], ['48', '-48 dB'], ['60', '-60 dB']]);
const feedbackTopologySelect = addDevLabSelector('DEV FB TOPOLOGY', 'data-feedback-topology', [['isolated-tpt', 'ISOLATED TPT'], ['common-bus', 'COMMON BUS']]);
const feedbackTapSelect = addDevLabSelector('DEV FB TAP', 'data-feedback-tap', [['pre-gain', 'PRE GAIN'], ['post-gain', 'POST GAIN']]);
const wetModelSelect = addDevLabSelector('DEV WET MODEL', 'data-wet-model', [['reference-delta', 'REFERENCE + DELTA'], ['filterbank-sum', 'FILTERBANK SUM']]);
const commonBusSatSelect = addDevLabSelector('DEV FB SAT', 'data-common-bus-saturation-mode', [['current', 'CURRENT'], ['constant-ceiling', 'CONSTANT CEILING']]);
const commonBusDriveSelect = addDevLabSelector('DEV FB DRIVE', 'data-common-bus-drive', [['0.5', '0.5'], ['1', '1'], ['2', '2'], ['4', '4'], ['8', '8'], ['16', '16']]);
const commonBusCeilingSelect = addDevLabSelector('DEV FB CEILING', 'data-common-bus-ceiling', [['0.25', '0.25'], ['0.5', '0.50'], ['1', '1.00'], ['2', '2.00'], ['4', '4.00']]);
const feedbackAllEngineSelect = addDevLabSelector('DEV FB ALL ENGINE', 'data-feedback-all-engine', [['legacy', 'LEGACY'], ['common-bus', 'COMMON BUS']]);
const feedbackAllSourceSelect = addDevLabSelector('DEV FB ALL SOURCE', 'data-feedback-all-source', [['pre-gain-sum', 'PRE GAIN SUM'], ['post-gain-sum', 'POST GAIN SUM']]);
if (feedbackAllSourceSelect) feedbackAllSourceSelect.value = 'post-gain-sum';
const feedbackAllLevelSelect = addDevLabSelector('DEV FB ALL LEVEL', 'data-feedback-all-level', [
  ['raw', 'RAW'],
  ['sqrt10', '1 / SQRT(10)'],
  ['tenth', '1 / 10'],
  ['twentieth', '1 / 20'],
  ['fortieth', '1 / 40'],
  ['eightieth', '1 / 80']
]);
const inputPreampStageSelect = addDevLabSelector('DEV INPUT STAGE', 'data-input-preamp-stage', [
  ['linear', 'LINEAR'],
  ['clean', 'CLEAN'],
  ['warm', 'WARM'],
  ['crunch', 'CRUNCH'],
  ['aggressive', 'AGGRESSIVE']
]);

const DEV_LAB_HELP = {
  'data-input-preamp-stage': {
    title: 'DEV INPUT STAGE', what: 'Wählt zwischen reiner linearer Eingangsverstärkung und vier festen experimentellen Drive-Charakteren.',
    scope: 'Wirkt nach dem Input Gain und vor der Dry/Wet-Verzweigung.',
    values: [['LINEAR', 'Input Gain arbeitet als reine lineare Verstärkung.'], ['CLEAN', 'Subtilste feste Nichtlinearität mit leichter Verdichtung bei stärkerer Ansteuerung.'], ['WARM', 'Feste weichere und dichtere Saturation.'], ['CRUNCH', 'Feste deutlich stärkere und rauere Saturation.'], ['AGGRESSIVE', 'Stärkster, bewusst destruktiver fester Charakter.']],
    default: 'LINEAR', note: 'Input Gain bestimmt die kontinuierliche Ansteuerung; die gewählte Kennlinie bleibt fest und morpht nicht mit dem Gain. Experimenteller DEV-Wert, kein Limiter, kein separater Drive-Regler, keine Loudness Compensation und keine bestätigte Erica-Emulation.'
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
  'data-wet-model': {
    title: 'DEV WET MODEL', what: 'Wählt die experimentelle Bildung des Wet-Ausgangs.',
    scope: 'Wirkt im Wet-Pfad vor der Ausgabe; beeinflusst nicht die trockene Referenz direkt.',
    values: [['REFERENCE + DELTA', 'Unity-Reference plus Summe der durch Band-Gain erzeugten Delta-Beiträge.'], ['FILTERBANK SUM', 'Summe der tatsächlichen Bandpfade ohne direkten Unity-Reference-Pfad.']],
    default: 'REFERENCE + DELTA', note: 'Experimenteller Architekturvergleich, keine bestätigte interne Hardwaretopologie.'
  },
  'data-feedback-topology': {
    title: 'DEV FB TOPOLOGY', what: 'Wählt die Topologie des positiven lokalen Feedbacks.',
    scope: 'Wirkt bei aktivem lokalem Feedback und positiver Resonance; COMMON BUS führt lokale Taps an den gemeinsamen Filterbank-Eingang zurück.',
    values: [['ISOLATED TPT', 'Ältere separate Resonator-/TPT-Architektur.'], ['COMMON BUS', 'Ausgewählte lokale Taps werden gemeinsam zurückgeführt und regen erneut alle Base-Bänder an.']],
    default: 'ISOLATED TPT', note: 'Experimenteller Reverse-Engineering-Hörvergleich; COMMON BUS ist der aktuelle lokale Entwicklungspfad. Keine Schaltung wird als bewiesen behauptet.'
  },
  'data-feedback-tap': {
    title: 'DEV FB TAP', what: 'Legt fest, ob der lokale COMMON-BUS-Tap Band-Ausgänge vor oder nach Band-Gain verwendet.',
    scope: 'Nur lokaler COMMON-BUS-Feedback-Tap; bei ISOLATED TPT und ohne lokalen Common Bus wirkungslos.',
    values: [['PRE GAIN', 'Verwendet den unverstärkten Base-Bandpass-Ausgang.'], ['POST GAIN', 'Verwendet den mit (1 + deltaGain) gewichteten Band-Ausgang; Boost/Cut verändert dadurch zusätzlich den lokalen Loop-Tap.']],
    default: 'PRE GAIN', note: 'Experimenteller DEV-Wert; keine Änderung an Band-Gain selbst.'
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
    scope: 'LEGACY verwendet den bisherigen Legacy-FB-ALL-Pfad. COMMON BUS bildet einen eigenen MAIN-Return aus der Summe der Base-Band-Ausgänge.',
    values: [['LEGACY', 'Bisheriger Legacy-FB-ALL-Pfad.'], ['COMMON BUS', 'Eigener MAIN-Common-Bus-Return; lokaler Common Return und MAIN-Return werden getrennt gebildet und gesättigt, dann gemeinsam an den Filterbank-Eingang geführt.']],
    default: 'LEGACY', note: 'Experimenteller Architekturvergleich; keine bestätigte Erica-Schaltung.'
  },
  'data-feedback-all-source': {
    title: 'DEV FB ALL SOURCE', what: 'Wählt die Quelle der MAIN-/FB-ALL-Summe.',
    scope: 'Nur COMMON-BUS FB ALL / MAIN; die Auswahl erfolgt nach Bildung der jeweiligen MAIN-Summe und vor Level, Resonance-Gain und Saturation.',
    values: [['PRE GAIN SUM', 'Summe der Base-Band-Ausgänge vor Band-Gain.'], ['POST GAIN SUM', 'Summe der mit (1 + deltaGain) gewichteten Band-Ausgänge; Boost/Cut beeinflusst dadurch zusätzlich die MAIN-Schleife.']],
    default: 'POST GAIN SUM', note: 'Bei LEGACY wirkungslos; experimenteller MAIN-Tap-Vergleich.'
  },
  'data-feedback-all-level': {
    title: 'DEV FB ALL LEVEL', what: 'Skaliert die gebildete MAIN-Tap-Summe.',
    scope: 'Ausschließlich COMMON-BUS-MAIN: MAIN-Tap-Summe → Level → feedbackGain (1.25 * resonance²) → bestehende Saturation → mainCommonReturn. LEGACY ignoriert den Wert.',
    values: [['RAW', 'Faktor 1,0.'], ['1 / SQRT(10)', 'Faktor 1 / sqrt(10) ≈ 0,316227766.'], ['1 / 10', 'Faktor 0,1.'], ['1 / 20', 'Faktor 0,05.'], ['1 / 40', 'Faktor 0,025.'], ['1 / 80', 'Faktor 0,0125.']],
    default: 'RAW', note: 'Experimentelle feste COMMON-BUS-MAIN-Kalibrierung; keine automatische Normalisierung und keine finale Klangentscheidung.'
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
  'data-positive-resonance-engine': {
    title: 'DEV RES ENGINE', what: 'Wählt die Engine des positiven lokalen Resonators.',
    scope: 'Nur positive lokale Resonance außerhalb des COMMON-BUS-Modus; negative Resonance und FB ALL bleiben im Legacy-Pfad.',
    values: [['TPT', 'Nichtlinearer positiver TPT-Resonatorpfad mit dem aktuellen Residual-/Audition-Modell.'], ['PHASE 2', 'Ältere positive Phase-2-Resonator-/Prototyplösung.']],
    default: 'TPT', note: 'Experimenteller Engine-Vergleich; im aktuellen COMMON-BUS-Core wirkungslos.'
  }
};

const devLabTooltip = document.createElement('div');
devLabTooltip.className = 'dev-lab-tooltip';
devLabTooltip.id = 'dev-lab-tooltip';
devLabTooltip.setAttribute('role', 'tooltip');
devLabTooltip.hidden = true;
document.body.append(devLabTooltip);
let activeDevLabControl = null;
const renderDevLabHelp = help => {
  devLabTooltip.replaceChildren();
  const heading = document.createElement('h3'); heading.textContent = help.title; devLabTooltip.append(heading);
  [['Erklärung', help.what], ['Signalweg / Scope', help.scope]].forEach(([label, value]) => {
    const paragraph = document.createElement('p'); const strong = document.createElement('strong'); strong.textContent = `${label}: `; paragraph.append(strong, value); devLabTooltip.append(paragraph);
  });
  const valuesHeading = document.createElement('strong'); valuesHeading.textContent = 'Werte:'; devLabTooltip.append(valuesHeading);
  const values = document.createElement('ul');
  help.values.forEach(([name, description]) => { const item = document.createElement('li'); const value = document.createElement('strong'); value.textContent = `${name} — `; item.append(value, description); values.append(item); });
  devLabTooltip.append(values);
  [['Default', help.default], ['Hinweis', help.note]].forEach(([label, value]) => { const paragraph = document.createElement('p'); const strong = document.createElement('strong'); strong.textContent = `${label}: `; paragraph.append(strong, value); devLabTooltip.append(paragraph); });
};
const positionDevLabTooltip = () => {
  if (!activeDevLabControl) return;
  const anchor = activeDevLabControl.getBoundingClientRect();
  const width = Math.min(420, Math.max(280, window.innerWidth - 24));
  devLabTooltip.style.width = `${width}px`;
  devLabTooltip.style.maxHeight = `${Math.max(160, window.innerHeight - 24)}px`;
  const tooltipHeight = devLabTooltip.getBoundingClientRect().height;
  let left = anchor.right + 10;
  if (left + width > window.innerWidth - 12) left = anchor.left - width - 10;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  let top = anchor.top;
  if (top + tooltipHeight > window.innerHeight - 12) top = window.innerHeight - tooltipHeight - 12;
  top = Math.max(12, top);
  devLabTooltip.style.left = `${left}px`;
  devLabTooltip.style.top = `${top}px`;
};
const hideDevLabTooltip = control => {
  if (control && activeDevLabControl !== control) return;
  activeDevLabControl = null;
  devLabTooltip.hidden = true;
};
const showDevLabTooltip = control => {
  const select = control.querySelector('select');
  const help = select && DEV_LAB_HELP[select.getAttributeNames().find(name => name.startsWith('data-'))];
  if (!help) return;
  activeDevLabControl = control;
  renderDevLabHelp(help);
  devLabTooltip.hidden = false;
  positionDevLabTooltip();
  select.setAttribute('aria-describedby', devLabTooltip.id);
};
document.querySelectorAll('.dev-lab-panel .dev-lab-control, .dev-lab-panel .dev-audition-control').forEach(control => {
  control.addEventListener('mouseenter', () => showDevLabTooltip(control));
  control.addEventListener('mouseleave', () => { if (!control.contains(document.activeElement)) hideDevLabTooltip(control); });
  control.addEventListener('focusin', () => showDevLabTooltip(control));
  control.addEventListener('focusout', event => { if (!control.contains(event.relatedTarget)) hideDevLabTooltip(control); });
});
window.addEventListener('resize', positionDevLabTooltip);
const THEME_STORAGE_KEY = 'resonant-filterbank-theme';
const THEME_VALUES = ['current', 'clean-modern', 'dark-studio', 'analog-inspired', 'minimal-dark', 'pro-console'];
const themeSelect = document.querySelector('[data-theme-select]');
const readStoredTheme = () => {
  try { return window.localStorage.getItem(THEME_STORAGE_KEY); } catch { return null; }
};
const applyTheme = value => {
  const theme = THEME_VALUES.includes(value) ? value : 'current';
  document.body.dataset.theme = theme;
  if (themeSelect) themeSelect.value = theme;
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Storage may be unavailable. */ }
};
applyTheme(readStoredTheme());
themeSelect?.addEventListener('change', event => applyTheme(event.target.value));
const bands = document.querySelector('.bands');
bands.innerHTML = BAND_DEFINITIONS.map((band,index) => `<article class="band-card"><div class="band-actions"><button class="band-action" type="button" data-feedback-band="${index}">FB</button><button class="band-action" type="button" data-mod-band="${index}">MOD</button></div><output class="band-slider-value" data-band-value="${index}">0.0 dB</output><div class="fader-wrap"><span class="fader-label positive">+</span><div class="fader-track"><input class="band-fader" type="range" min="${BAND_GAIN_MIN}" max="${BAND_GAIN_MAX}" value="${BAND_GAIN_NEUTRAL}" data-band="${index}" aria-label="${band.label} Fader"></div><span class="fader-label negative">−</span></div><div class="band-value">${band.label}</div></article>`).join('');
const formatValue = (name,value) => { if(name==='dryWet') return `${Math.round(value)} %`; if(name==='inputGain'||name==='volume') return `${Number(value).toFixed(1)} dB`; return Number(value).toFixed(2).replace(/\.?0+$/,''); };

const bars = document.querySelector('.bars');
bars.innerHTML = Array.from({length:BAND_COUNT},(_,i)=>`<div class="bar-pair" data-analyzer-band="${i}"><i></i><i></i></div>`).join('');
const faders = [...document.querySelectorAll('.band-fader')];
const renderAnalyzerBar = (bar, value) => {
  const numericValue = Number(value);
  const height = numericValue > BAND_GAIN_NEUTRAL
    ? (numericValue / BAND_GAIN_MAX) * 50
    : numericValue < BAND_GAIN_NEUTRAL
      ? (Math.abs(numericValue) / Math.abs(BAND_GAIN_MIN)) * 50
      : 0;
  bar.classList.toggle('negative', numericValue < BAND_GAIN_NEUTRAL);
  bar.style.height = `${height}%`;
};
const updateAnalyzerBand = index => {
  const [leftBar, rightBar] = document.querySelectorAll(`[data-analyzer-band="${index}"] i`);
  renderAnalyzerBar(leftBar, state.bandGainLeft[index]);
  renderAnalyzerBar(rightBar, state.bandGainRight[index]);
};
const getBandBoostDb = () => Number(bandBoostSelect?.value ?? 12);
const getBandCutDb = () => Number(bandCutSelect?.value ?? 12);
const formatBandSliderValue = value => {
  const gainDb = controlToBandGainDb(value, getBandBoostDb(), getBandCutDb());
  const normalizedGainDb = Math.abs(gainDb) < 1e-9 ? 0 : gainDb;
  return `${normalizedGainDb > 0 ? '+' : ''}${normalizedGainDb.toFixed(1)} dB`;
};
const renderBandSliderValues = () => faders.forEach((_, index) => renderBand(index));
const renderBand = index => {
  const slider = faders[index];
  slider.value = String(state.bandGainLeft[index]);
  const valueDisplay = document.querySelector(`[data-band-value="${index}"]`);
  if (valueDisplay) valueDisplay.textContent = formatBandSliderValue(state.bandGainLeft[index]);
  updateAnalyzerBand(index);
};
const setBandBaseGain = (channel, index, value) => {
  const channels = state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    const nextValue = setStateBandBaseGain(state, targetChannel, index, value);
    audioEngine?.setBandBaseGain(targetChannel, index, nextValue);
  });
  renderBand(index);
};
const setBandFeedback = (channel, index, enabled) => {
  const channels = state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    const target = targetChannel === 'left' ? state.feedbackBandLeft : state.feedbackBandRight;
    target[index] = Boolean(enabled);
    audioEngine?.setBandFeedback(targetChannel, index, target[index]);
  });
};
const setFeedbackAll = (channel, enabled) => {
  const channels = state.channelSelection === 'LR' ? ['left', 'right'] : [channel];
  channels.forEach(targetChannel => {
    if (targetChannel === 'left') state.feedbackAllLeft = Boolean(enabled);
    else state.feedbackAllRight = Boolean(enabled);
    audioEngine?.setFeedbackAll(targetChannel, enabled);
  });
};
faders.forEach((slider,index) => {
  slider.addEventListener('input', () => setBandBaseGain('left', index, slider.value));
  slider.addEventListener('dblclick', () => setBandBaseGain('left', index, BAND_GAIN_NEUTRAL));
  renderBand(index);
});

document.querySelectorAll('[data-control]').forEach(slider => {
  const name = slider.dataset.control;
  const definition = GLOBAL_CONTROL_DEFINITIONS[name];
  const output = document.querySelector(`[data-output="${name}"]`);
  slider.min = String(definition.min);
  slider.max = String(definition.max);
  slider.step = String(definition.step);
  slider.value = String(state[name]);
  const update = () => { state[name] = Number(slider.value); output.textContent = formatValue(name, state[name]); };
  slider.addEventListener('input', update);
  slider.addEventListener('dblclick', () => {
    slider.value = String(definition.defaultValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  update();
});
document.querySelectorAll('[data-feedback-band]').forEach(button => button.addEventListener('click', () => { const index=Number(button.dataset.feedbackBand); const nextValue=!state.feedbackBandLeft[index]; setBandFeedback('left', index, nextValue); button.classList.toggle('active',nextValue); button.setAttribute('aria-pressed',String(nextValue)); }));
document.querySelectorAll('[data-mod-band]').forEach(button => button.addEventListener('click', () => { const index=Number(button.dataset.modBand); state.modulated[index]=!state.modulated[index]; button.classList.toggle('active',state.modulated[index]); button.setAttribute('aria-pressed',String(state.modulated[index])); }));
const fbAllButton = document.querySelector('.fb-all-toggle');
fbAllButton.addEventListener('click', () => { const nextValue=!state.feedbackAllLeft; setFeedbackAll('left', nextValue); fbAllButton.classList.toggle('active',nextValue); fbAllButton.textContent=nextValue?'ON':'OFF'; fbAllButton.setAttribute('aria-pressed',String(nextValue)); });

const FB_CODES = ['Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9','Digit0'];
const FADER_UP_CODES = ['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyU','KeyI','KeyO','KeyP'];
const FADER_DOWN_CODES = ['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon'];
const FADER_NEUTRAL_CODES = ['KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash'];
const BAND_GAIN_STEP = (BAND_GAIN_MAX - BAND_GAIN_MIN) * 0.05;
const isEditableTarget = target => target instanceof HTMLElement && ((target.matches('input, textarea, select') && !target.matches('input[type="range"]')) || target.isContentEditable);
document.addEventListener('keydown', event => {
  if (isEditableTarget(event.target)) return;
  const bandIndex = FB_CODES.indexOf(event.code);
  if (bandIndex !== -1) { if(event.shiftKey) document.querySelector(`[data-mod-band="${bandIndex}"]`).click(); else document.querySelector(`[data-feedback-band="${bandIndex}"]`).click(); event.preventDefault(); return; }
  const upIndex = FADER_UP_CODES.indexOf(event.code);
  if (upIndex !== -1) { setBandBaseGain('left', upIndex, state.bandGainLeft[upIndex] + BAND_GAIN_STEP); event.preventDefault(); return; }
  const downIndex = FADER_DOWN_CODES.indexOf(event.code);
  if (downIndex !== -1) { setBandBaseGain('left', downIndex, state.bandGainLeft[downIndex] - BAND_GAIN_STEP); event.preventDefault(); return; }
  const neutralIndex = FADER_NEUTRAL_CODES.indexOf(event.code);
  if (neutralIndex !== -1) { setBandBaseGain('left', neutralIndex, BAND_GAIN_NEUTRAL); event.preventDefault(); }
});

const inputDeviceSelect = document.querySelector('[data-audio-input]');
const outputDeviceSelect = document.querySelector('[data-audio-output]');
const startAudioButton = document.querySelector('[data-audio-start]');
const stopAudioButton = document.querySelector('[data-audio-stop]');
const audioStatus = document.querySelector('[data-audio-status]');
const audioMessage = document.querySelector('[data-audio-message]');
let hasManualInputSelection = false;
const findElektronInput = devices => devices.find(device => /elektron/i.test(device.label ?? ''));
const renderDevices = (select, devices, emptyLabel) => {
  const selectedValue = select.value;
  select.replaceChildren();
  if (!devices.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = emptyLabel;
    select.append(option);
    return;
  }
  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Audio-Gerät ${index + 1}`;
    select.append(option);
  });
  const preferredElektronInput = select === inputDeviceSelect && !hasManualInputSelection ? findElektronInput(devices) : null;
  if (preferredElektronInput) select.value = preferredElektronInput.deviceId;
  else if ([...select.options].some(option => option.value === selectedValue)) select.value = selectedValue;
};
inputDeviceSelect?.addEventListener('change', () => { hasManualInputSelection = true; });
const updateAudioStatus = (status, message = '') => {
  state.audioStatus = status;
  state.audioError = message;
  audioStatus.textContent = status;
  audioMessage.textContent = message;
  audioStatus.dataset.status = status;
  startAudioButton.disabled = status === 'STARTING' || status === 'ON';
  stopAudioButton.disabled = status !== 'ON';
};
audioEngine = new AudioEngine({
  onStatusChange: updateAudioStatus,
  onDevicesChanged: devices => { renderDevices(inputDeviceSelect, devices.inputs, 'Kein Input-Gerät'); renderDevices(outputDeviceSelect, devices.outputs, 'Standardausgabe'); }
});
audioEngine.applyState(state);
const setPositiveResonanceAuditionGain = value => {
  const numericValue = Number(value);
  const nextValue = POSITIVE_RESONANCE_AUDITION_VALUES.includes(numericValue) ? numericValue : 0.10;
  if (positiveResonanceAuditionSelect) positiveResonanceAuditionSelect.value = nextValue.toFixed(2);
  audioEngine.setPositiveResonanceAuditionGain(nextValue);
};
setPositiveResonanceAuditionGain(positiveResonanceAuditionSelect?.value ?? 0.10);
positiveResonanceAuditionSelect?.addEventListener('change', event => setPositiveResonanceAuditionGain(event.target.value));
const POSITIVE_RESONANCE_DRIVE_VALUES = [1, 2, 4, 8, 16, 24, 32];
const setPositiveResonanceDrive = value => {
  const numericValue = Number(value);
  const nextValue = POSITIVE_RESONANCE_DRIVE_VALUES.includes(numericValue) ? numericValue : 1;
  if (positiveResonanceDriveSelect) positiveResonanceDriveSelect.value = String(nextValue);
  audioEngine.setPositiveResonanceDrive(nextValue);
};
setPositiveResonanceDrive(positiveResonanceDriveSelect?.value ?? 1);
positiveResonanceDriveSelect?.addEventListener('change', event => setPositiveResonanceDrive(event.target.value));
const POSITIVE_RESONANCE_DAMPING_FLOOR_VALUES = [0.10, 0.05, 0.02, 0.00, -0.02, -0.05, -0.10];
const setPositiveResonanceDampingFloor = value => {
  const numericValue = Number(value);
  const nextValue = POSITIVE_RESONANCE_DAMPING_FLOOR_VALUES.includes(numericValue) ? numericValue : 0.10;
  if (positiveResonanceDampingFloorSelect) positiveResonanceDampingFloorSelect.value = nextValue.toFixed(2);
  audioEngine.setPositiveResonanceDampingFloor(nextValue);
};
setPositiveResonanceDampingFloor(positiveResonanceDampingFloorSelect?.value ?? 0.10);
positiveResonanceDampingFloorSelect?.addEventListener('change', event => setPositiveResonanceDampingFloor(event.target.value));
const POSITIVE_RESONANCE_OUTPUT_VALUES = ['current-residual', 'nonlinear-base', 'full-nonlinear'];
const setPositiveResonanceOutputMode = value => {
  const nextValue = POSITIVE_RESONANCE_OUTPUT_VALUES.includes(value) ? value : 'current-residual';
  if (positiveResonanceOutputSelect) positiveResonanceOutputSelect.value = nextValue;
  audioEngine.setPositiveResonanceOutputMode(nextValue);
};
setPositiveResonanceOutputMode(positiveResonanceOutputSelect?.value ?? 'current-residual');
positiveResonanceOutputSelect?.addEventListener('change', event => setPositiveResonanceOutputMode(event.target.value));
const POSITIVE_RESONANCE_LATENCY_VALUES = ['current', 'matched'];
const setPositiveResonanceLatencyMode = value => {
  const nextValue = POSITIVE_RESONANCE_LATENCY_VALUES.includes(value) ? value : 'current';
  if (positiveResonanceLatencySelect) positiveResonanceLatencySelect.value = nextValue;
  audioEngine.setPositiveResonanceLatencyMode(nextValue);
};
setPositiveResonanceLatencyMode(positiveResonanceLatencySelect?.value ?? 'current');
positiveResonanceLatencySelect?.addEventListener('change', event => setPositiveResonanceLatencyMode(event.target.value));
const POSITIVE_RESONANCE_CURVE_VALUES = ['current', 'early', 'aggressive'];
const setPositiveResonanceCurve = value => {
  const nextValue = POSITIVE_RESONANCE_CURVE_VALUES.includes(value) ? value : 'current';
  if (positiveResonanceCurveSelect) positiveResonanceCurveSelect.value = nextValue;
  audioEngine.setPositiveResonanceCurve(nextValue);
};
setPositiveResonanceCurve(positiveResonanceCurveSelect?.value ?? 'current');
positiveResonanceCurveSelect?.addEventListener('change', event => setPositiveResonanceCurve(event.target.value));
const bindDevLabSelect = (select, apply, fallback) => {
  if (!select) return;
  apply(select.value ?? fallback);
  select.addEventListener('change', event => apply(event.target.value));
};
bindDevLabSelect(referenceLevelSelect, value => audioEngine.setReferenceLevel(value), '1');
bindDevLabSelect(resonanceEngineSelect, value => audioEngine.setPositiveResonanceEngine(value), 'tpt');
bindDevLabSelect(bandBoostSelect, value => { audioEngine.setBandBoostDb(value); renderBandSliderValues(); }, '12');
bindDevLabSelect(bandCutSelect, value => { audioEngine.setBandCutDb(value); renderBandSliderValues(); }, '12');
bindDevLabSelect(feedbackTopologySelect, value => audioEngine.setFeedbackTopology(value), 'isolated-tpt');
bindDevLabSelect(feedbackTapSelect, value => audioEngine.setFeedbackTap(value), 'pre-gain');
bindDevLabSelect(wetModelSelect, value => audioEngine.setWetModel(value), 'reference-delta');
bindDevLabSelect(commonBusSatSelect, value => audioEngine.setCommonBusSaturationMode(value), 'current');
bindDevLabSelect(commonBusDriveSelect, value => audioEngine.setCommonBusDrive(value), '1');
bindDevLabSelect(commonBusCeilingSelect, value => audioEngine.setCommonBusCeiling(value), '1');
bindDevLabSelect(feedbackAllEngineSelect, value => audioEngine.setFeedbackAllEngine(value), 'legacy');
bindDevLabSelect(feedbackAllSourceSelect, value => audioEngine.setFeedbackAllSource(value), 'post-gain-sum');
bindDevLabSelect(feedbackAllLevelSelect, value => audioEngine.setFeedbackAllLevel(value), 'raw');
bindDevLabSelect(inputPreampStageSelect, value => audioEngine.setInputPreampStage(value), 'linear');
const syncAudioParameters = () => {
  audioEngine.setInputGainDb(state.inputGain);
  audioEngine.setDryWet(state.dryWet);
  audioEngine.setVolumeDb(state.volume);
};
document.querySelector('[data-control="inputGain"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="dryWet"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="volume"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="resonance"]').addEventListener('input', () => audioEngine.setResonance(state.resonance));
syncAudioParameters();
const refreshAudioDevices = async () => {
  try {
    const devices = await audioEngine.refreshDevices();
    renderDevices(inputDeviceSelect, devices.inputs, 'Kein Input-Gerät');
    renderDevices(outputDeviceSelect, devices.outputs, 'Standardausgabe');
  } catch (error) {
    audioMessage.textContent = error.message;
  }
};
startAudioButton.addEventListener('click', async () => {
  try {
    await audioEngine.start({ inputDeviceId: inputDeviceSelect.value, outputDeviceId: outputDeviceSelect.value });
  } catch (error) {
    audioMessage.textContent = audioEngine.getErrorMessage(error);
  }
});
stopAudioButton.addEventListener('click', () => audioEngine.stop());
updateAudioStatus('OFF');
refreshAudioDevices();
