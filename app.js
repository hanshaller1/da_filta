// Application entry: loads the UI modules in setup order, then wires panic and the audio transport.
// Evaluation order matters: every module below runs its setup on import.
import './ui/app-context.js';
import './ui/dev-lab-panel.js';
import './ui/analyzer-header.js';
import './ui/spectrum-renderer.js';
import './ui/dev-lab-telemetry.js';
import './ui/keyboard-preferences.js';
import './ui/dev-lab-controls.js';
import './ui/band-gain-range.js';
import './ui/dev-lab-help-texts.js';
import './ui/dev-lab-help.js';
import './ui/theme.js';
import './ui/modulation-assignments.js';
import './ui/macro-mode.js';
import './ui/filter-mode.js';
import './ui/dynamic-eq-mode.js';
import './ui/midi-clock.js';
import './ui/lfo-mode.js';
import './ui/clock-mod-mode.js';
import './ui/envelope-mode.js';
import './ui/mode-navigation.js';
import './ui/mode-api.js';
import './ui/band-analyzer.js';
import './ui/bands.js';
import './ui/global-controls.js';
import './ui/keyboard-shortcuts.js';
import './ui/audio-io.js';
import './ui/dev-lab-bindings.js';
import './ui/global-audio-sync.js';
import './ui/state-sync.js';
import './ui/presets.js';
import './ui/sweetspots.js';
import { state, audioEngine, panic, setPanic } from './ui/app-context.js';
import { devLabTelemetry } from './ui/dev-lab-telemetry.js';
import { fbAllButton, renderGlobalControlValue } from './ui/global-controls.js';
import {
  inputDeviceSelect, outputDeviceSelect, audioToggleButton, panicAudioButton, bypassAudioButton, audioMessage,
  audioSourceMode, audioBypassEnabled, rememberedInputDeviceId, selectedSample, logSourceEvent,
  updateAudioStatus, setAudioBypass, refreshAudioDevices
} from './ui/audio-io.js';

setPanic(() => {
  devLabTelemetry.logPanic();
  audioEngine?.panic();
  renderGlobalControlValue('resonance', 0);
  renderGlobalControlValue('dryWet', 0);
  renderGlobalControlValue('inputGain', 0);
  state.feedbackBandLeft.fill(false);
  state.feedbackBandRight.fill(false);
  state.feedbackAllLeft = false;
  state.feedbackAllRight = false;
  document.querySelectorAll('[data-feedback-band]').forEach(button => {
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
  });
  fbAllButton.classList.remove('active');
  fbAllButton.textContent = 'FB ALL';
  fbAllButton.setAttribute('aria-pressed', 'false');
});
audioToggleButton?.addEventListener('click', async () => {
  if (audioEngine.status === 'ON') { await audioEngine.stop(); return; }
  try {
    await audioEngine.start({ inputDeviceId: rememberedInputDeviceId || inputDeviceSelect.value, outputDeviceId: outputDeviceSelect.value, sourceMode: audioSourceMode, sample: selectedSample() });
    setAudioBypass(audioBypassEnabled);
    if (audioSourceMode === 'sample' && selectedSample()) logSourceEvent(`SAMPLE START ${selectedSample().name}`);
  } catch (error) {
    audioMessage.textContent = audioEngine.getErrorMessage(error);
  }
});
bypassAudioButton?.addEventListener('click', () => setAudioBypass(!audioBypassEnabled));
panicAudioButton?.addEventListener('click', panic);
updateAudioStatus('OFF');
refreshAudioDevices();
