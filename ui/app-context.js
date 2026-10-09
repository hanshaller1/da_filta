// Shared application context: state constants, the single UI state object, the AudioEngine handle
// and the functions that later modules provide to earlier ones.

const {
  BAND_DEFINITIONS,
  BAND_COUNT,
  BAND_GAIN_MIN,
  BAND_GAIN_MAX,
  BAND_GAIN_NEUTRAL,
  GLOBAL_CONTROL_DEFINITIONS,
  controlToBandGainDb,
  bandGainDbToControl,
  bandGainDbToBipolarPercent,
  createInitialState,
  getEffectiveBandGains,
  setBandBaseGain: setStateBandBaseGain
} = window.ResonantState;
const state = createInitialState();

// Created in audio-io.js once every callback it needs exists.
let audioEngine = null;
const setAudioEngine = value => (audioEngine = value);

// No-ops until their owner replaces them: app.js provides panic, dev-lab-telemetry.js the diagnostics refresh.
let panic = () => {};
const setPanic = value => (panic = value);
let updateResonatorDiagnostics = () => {};
const setUpdateResonatorDiagnostics = value => (updateResonatorDiagnostics = value);

// Functions provided by modules that load after their callers. The owning module assigns its
// function during setup; callers only use them from event handlers and render calls.
const hooks = {
  getFilterbankDisplayBandGains: null, // ui/band-gain-range.js
  renderClockModControls: null, // ui/clock-mod-mode.js
  renderLfoControls: null, // ui/lfo-mode.js
  setAnalyzerDisplayOption: null, // ui/band-analyzer.js
  updatePerChannelBands: null, // ui/global-controls.js
  updateDevControlRelevance: null // ui/dev-lab-bindings.js
};

export {
  BAND_DEFINITIONS, BAND_COUNT, BAND_GAIN_MIN, BAND_GAIN_MAX, BAND_GAIN_NEUTRAL, GLOBAL_CONTROL_DEFINITIONS,
  controlToBandGainDb, bandGainDbToControl, bandGainDbToBipolarPercent, getEffectiveBandGains,
  setStateBandBaseGain, state, audioEngine, panic, updateResonatorDiagnostics, setAudioEngine, setPanic,
  setUpdateResonatorDiagnostics, hooks
};
