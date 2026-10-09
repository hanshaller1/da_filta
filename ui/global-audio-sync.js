// Pushes the global slider values to the AudioEngine and logs their changes.
import { state, audioEngine } from './app-context.js';
import { devLabTelemetry } from './dev-lab-telemetry.js';
import { renderDynamicEqControls } from './dynamic-eq-mode.js';
import { materializeSpreadDb } from './bands.js';
import { updateDevControlRelevance } from './dev-lab-bindings.js';

const syncAudioParameters = () => {
  audioEngine.setInputGainDb(state.inputGain);
  audioEngine.setDryWet(state.dryWet);
  audioEngine.setVolumeDb(state.volume);
};
document.querySelector('[data-control="inputGain"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="dryWet"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="volume"]').addEventListener('input', syncAudioParameters);
document.querySelector('[data-control="resonance"]').addEventListener('input', () => { audioEngine.setResonance(state.resonance); updateDevControlRelevance(); });
document.querySelector('[data-control="spread"]').addEventListener('input', () => {
  audioEngine.setSpread(state.spread);
  materializeSpreadDb(state.spread);
  renderDynamicEqControls();
});
['resonance', 'dryWet', 'inputGain', 'volume', 'spread'].forEach(name => {
  const slider = document.querySelector(`[data-control="${name}"]`); let previous = state[name];
  slider?.addEventListener('input', () => { const next = state[name]; devLabTelemetry.logStateChange(name.toUpperCase(), Number(previous).toFixed(name === 'resonance' ? 2 : 1), Number(next).toFixed(name === 'resonance' ? 2 : 1)); previous = next; });
});
syncAudioParameters();
