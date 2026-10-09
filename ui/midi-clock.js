// MIDI clock: device setup dialog, clock/transport tracking and the shared clock state.
import { normalizeClockState } from '../clock-core.mjs';
import { MidiDeviceManager } from '../midi-device-manager.mjs';
import { state, audioEngine, hooks } from './app-context.js';

const lfoMidiStatus = document.querySelector('[data-lfo-midi-status]');
const midiDialog = document.querySelector('[data-midi-dialog]');
const midiAccessStatusElement = document.querySelector('[data-midi-access-status]');
const midiAccessMessage = document.querySelector('[data-midi-access-message]');
const midiInputSelect = document.querySelector('[data-midi-input]');
const midiReceiveToggle = document.querySelector('[data-midi-receive]');
const midiTransportSelect = document.querySelector('[data-midi-transport]');
const midiClockStatusElement = document.querySelector('[data-midi-clock-status]');
const midiTempoElement = document.querySelector('[data-midi-tempo]');
const midiTransportStatusElement = document.querySelector('[data-midi-transport-status]');
const midiRefreshButton = document.querySelector('[data-midi-refresh]');
const MIDI_CONFIG_KEY = 'da-filta-midi-clock-v1';
const loadMidiConfig = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(MIDI_CONFIG_KEY) || 'null');
    return { receive: stored?.receive !== false, transport: stored?.transport === 'auto' ? 'auto' : 'follow', deviceId: typeof stored?.deviceId === 'string' ? stored.deviceId : '' };
  } catch { return { receive: true, transport: 'follow', deviceId: '' }; }
};
const midiConfig = loadMidiConfig();
let midiAccessStatus = typeof navigator.requestMIDIAccess === 'function' ? 'NOT GRANTED' : 'UNAVAILABLE';
let midiRuntimeEnabled = false;
let midiClockStatus = 'DISABLED';
let midiTransportStatus = '—';
let midiDisplayBpm = null;
let midiDisplayFilteredBpm = null;
const midiClockIntervals = [];
let midiClockLocked = false;
let midiLastClockTimestamp = null;
let midiClockBpm = 120;
let midiTransportRunning = false;
const setMidiTransportRunning = value => (midiTransportRunning = value);
let midiClockStatusTimer = 0;
const getMidiStatusText = () => {
  const clock = state.lfoClock || normalizeClockState();
  if (clock.source === 'internal') return `INTERNAL · ${Math.round(clock.bpm)} BPM`;
  if (midiAccessStatus === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (!midiRuntimeEnabled) return 'DISABLED';
  return midiClockStatus === 'LOCKED' && Number.isFinite(midiDisplayBpm)
    ? `LOCKED · ${midiDisplayBpm.toFixed(1)} BPM`
    : midiClockStatus;
};
const usesMidiClockSource = () => state.lfoClock?.source === 'midi' || state.clockMod?.clockSource === 'midi';
const setClockState = (patch, sendMessage = null) => {
  state.lfoClock = normalizeClockState({ ...state.lfoClock, ...patch });
  audioEngine?.setLfoClockState(state.lfoClock);
  if (sendMessage) audioEngine?.sendLfoClockMessage?.(sendMessage);
  if (lfoMidiStatus) lfoMidiStatus.textContent = getMidiStatusText();
  hooks.renderLfoControls();
};
const persistMidiConfig = () => {
  try { window.localStorage.setItem(MIDI_CONFIG_KEY, JSON.stringify(midiConfig)); } catch { /* Storage may be unavailable. */ }
};
const resetMidiTempoTracking = ({ resetWorkingTempo = true, clearDisplay = true } = {}) => {
  midiLastClockTimestamp = null;
  midiClockIntervals.length = 0;
  midiClockLocked = false;
  if (resetWorkingTempo) midiClockBpm = 120;
  if (clearDisplay) { midiDisplayBpm = null; midiDisplayFilteredBpm = null; }
};
const resetMidiClockTracking = (status = 'NO CLOCK') => {
  if (midiClockStatusTimer) clearTimeout(midiClockStatusTimer);
  midiClockStatusTimer = 0;
  resetMidiTempoTracking();
  midiClockStatus = status;
  midiTransportRunning = false;
  midiTransportStatus = midiConfig.transport === 'auto' ? 'STOPPED' : '—';
  if (usesMidiClockSource()) {
    if (state.lfoClock?.source === 'midi') setClockState({ running: false, midiBpm: 120, midiStatus: status === 'NO CLOCK' ? 'NO CLOCK' : status }, 'stop');
    else audioEngine?.sendLfoClockMessage?.('stop');
  }
  renderMidiSetup();
};
let lastMidiSelection = '';
const midiManager = new MidiDeviceManager({
  onMessage: event => receiveMidiClockMessage(event),
  onChange: (inputs, selectedId) => {
    if (midiInputSelect) {
      const previous = selectedId;
      midiInputSelect.replaceChildren();
      if (!inputs.length) midiInputSelect.add(new Option('NO INPUT', ''));
      else {
        midiInputSelect.add(new Option('SELECT INPUT', ''));
        inputs.forEach(input => {
          const name = [input.name, input.manufacturer].filter(Boolean).join(' · ') || `MIDI Input ${input.id}`;
          midiInputSelect.add(new Option(name, input.id));
        });
      }
      midiInputSelect.disabled = inputs.length === 0 || midiAccessStatus !== 'CONNECTED';
      midiInputSelect.value = selectedId;
      if (midiRuntimeEnabled && previous !== lastMidiSelection) {
        lastMidiSelection = previous;
        resetMidiClockTracking(midiConfig.receive ? (previous ? 'NO CLOCK' : 'NO INPUT') : 'DISABLED');
      }
    }
    renderMidiSetup();
  }
});
const renderMidiSetup = () => {
  const hasInput = Boolean(midiRuntimeEnabled && midiManager?.selectedId && midiManager.activeInput);
  if (midiAccessStatusElement) midiAccessStatusElement.textContent = midiAccessStatus;
  if (midiAccessMessage && !midiAccessMessage.dataset.error) midiAccessMessage.textContent = '';
  if (midiInputSelect) midiInputSelect.disabled = !midiRuntimeEnabled || !midiManager?.inputs.length || midiAccessStatus !== 'CONNECTED';
  if (midiReceiveToggle) { midiReceiveToggle.checked = midiConfig.receive; midiReceiveToggle.disabled = !midiRuntimeEnabled; }
  if (midiTransportSelect) { midiTransportSelect.value = midiConfig.transport; midiTransportSelect.disabled = !midiRuntimeEnabled; }
  if (midiRefreshButton) midiRefreshButton.disabled = !midiRuntimeEnabled;
  const enableButton = document.querySelector('[data-midi-enable]');
  if (enableButton) {
    enableButton.textContent = midiRuntimeEnabled ? 'DISABLE MIDI' : 'ENABLE MIDI';
    enableButton.setAttribute('aria-pressed', String(midiRuntimeEnabled));
  }
  if (midiClockStatusElement) midiClockStatusElement.textContent = !midiRuntimeEnabled || !midiConfig.receive ? 'DISABLED' : !hasInput ? 'NO INPUT' : midiClockStatus;
  if (midiTempoElement) midiTempoElement.textContent = midiRuntimeEnabled && midiConfig.receive && hasInput && Number.isFinite(midiDisplayBpm) ? `${midiDisplayBpm.toFixed(1)} BPM` : '—';
  if (midiTransportStatusElement) midiTransportStatusElement.textContent = !midiRuntimeEnabled || !midiConfig.receive || !hasInput ? '—' : midiTransportStatus;
  const midiButton = document.querySelector('[data-midi-setup].midi-setup-button');
  if (midiButton) {
    midiButton.classList.toggle('midi-status-warning', midiRuntimeEnabled && midiAccessStatus === 'CONNECTED' && hasInput && midiClockStatus !== 'LOCKED');
    midiButton.classList.toggle('midi-status-active', midiRuntimeEnabled && midiConfig.receive && hasInput && midiClockStatus === 'LOCKED');
    midiButton.classList.toggle('midi-status-neutral', !midiRuntimeEnabled || midiAccessStatus !== 'CONNECTED' || !hasInput);
    midiButton.setAttribute('aria-label', 'MIDI Setup');
    midiButton.title = `MIDI Setup · ${midiClockStatus}`;
  }
  if (lfoMidiStatus) lfoMidiStatus.textContent = getMidiStatusText();
  if (state.selectedWorkspaceMode === 'clock-mod') hooks.renderClockModControls();
};
const receiveMidiClockMessage = event => {
  if (!midiRuntimeEnabled || !midiConfig.receive || !midiManager?.selectedId) return;
  const status = event.data?.[0];
  const timestamp = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
  if (![0xf8, 0xfa, 0xfb, 0xfc].includes(status)) return;
  if (status === 0xfa) {
    if (midiClockStatusTimer) clearTimeout(midiClockStatusTimer);
    midiClockStatusTimer = 0;
    midiTransportRunning = true;
    midiTransportStatus = 'RUNNING';
    resetMidiTempoTracking();
    midiClockStatus = 'NO CLOCK';
    if (usesMidiClockSource()) {
      if (state.lfoClock?.source === 'midi') setClockState({ running: true, midiStatus: 'NO CLOCK' }, 'start');
      else audioEngine?.sendLfoClockMessage?.('start');
    }
    renderMidiSetup();
    return;
  }
  if (status === 0xfb) {
    if (midiClockStatusTimer) clearTimeout(midiClockStatusTimer);
    midiClockStatusTimer = 0;
    midiTransportRunning = true;
    midiTransportStatus = 'RUNNING';
    midiLastClockTimestamp = null;
    midiClockStatus = 'NO CLOCK';
    if (usesMidiClockSource()) {
      if (state.lfoClock?.source === 'midi') setClockState({ running: true, midiStatus: 'NO CLOCK' }, 'continue');
      else audioEngine?.sendLfoClockMessage?.('continue');
    }
    renderMidiSetup();
    return;
  }
  if (status === 0xfc) {
    if (midiClockStatusTimer) clearTimeout(midiClockStatusTimer);
    midiClockStatusTimer = 0;
    midiTransportRunning = false;
    midiTransportStatus = 'STOPPED';
    if (midiConfig.transport === 'follow') {
      midiClockStatus = midiLastClockTimestamp === null ? 'NO CLOCK' : 'STOPPED';
      if (usesMidiClockSource()) {
        if (state.lfoClock?.source === 'midi') setClockState({ running: false, midiStatus: 'STOPPED' }, 'stop');
        else audioEngine?.sendLfoClockMessage?.('stop');
      }
    } else {
      midiClockStatus = 'STOPPED';
      if (usesMidiClockSource()) {
        if (state.lfoClock?.source === 'midi') setClockState({ running: false, midiStatus: 'STOPPED' }, 'stop');
        else audioEngine?.sendLfoClockMessage?.('stop');
      }
    }
    renderMidiSetup();
    return;
  }
  if (status !== 0xf8) return;
  if (midiConfig.transport === 'auto') {
    midiTransportRunning = true;
    midiTransportStatus = 'RUNNING';
  }
  if (midiLastClockTimestamp !== null) {
    const periodMs = timestamp - midiLastClockTimestamp;
    if (periodMs >= 5 && periodMs <= 100) {
      midiClockIntervals.push(periodMs);
      if (midiClockIntervals.length > 24) midiClockIntervals.shift();
      const orderedIntervals = [...midiClockIntervals].sort((left, right) => left - right);
      const middle = Math.floor(orderedIntervals.length / 2);
      const medianPeriod = orderedIntervals.length % 2
        ? orderedIntervals[middle]
        : (orderedIntervals[middle - 1] + orderedIntervals[middle]) / 2;
      const measured = Math.min(300, Math.max(30, 60000 / (medianPeriod * 24)));
      midiClockBpm = measured;
      midiDisplayFilteredBpm = midiDisplayFilteredBpm === null
        ? midiClockBpm
        : midiDisplayFilteredBpm + (midiClockBpm - midiDisplayFilteredBpm) * .5;
      const displayCandidate = Math.round((midiDisplayFilteredBpm + 1e-8) * 10) / 10;
      if (midiDisplayBpm === null || Math.abs(displayCandidate - midiDisplayBpm) + 1e-8 >= .1) midiDisplayBpm = displayCandidate;
      midiClockLocked = orderedIntervals.length >= 2;
    }
  }
  midiLastClockTimestamp = timestamp;
  if (midiClockStatusTimer) clearTimeout(midiClockStatusTimer);
  midiClockStatusTimer = setTimeout(() => {
    midiClockStatus = midiConfig.transport === 'follow' && !midiTransportRunning ? 'STOPPED' : 'NO CLOCK';
    if (midiConfig.transport === 'auto') { midiTransportRunning = false; midiTransportStatus = 'STOPPED'; }
    if (usesMidiClockSource()) {
      if (state.lfoClock?.source === 'midi') setClockState({ running: false, midiStatus: midiClockStatus }, 'stop');
      else audioEngine?.sendLfoClockMessage?.('stop');
    }
    renderMidiSetup();
  }, 750);
  midiClockStatus = midiConfig.transport === 'follow' && !midiTransportRunning ? 'STOPPED' : (midiClockLocked ? 'LOCKED' : 'NO CLOCK');
  if (state.lfoClock?.source === 'midi') {
    const running = midiTransportRunning;
    setClockState({ midiBpm: midiClockBpm, running, midiStatus: midiClockStatus }, null);
  }
  if (usesMidiClockSource() && midiTransportRunning) audioEngine?.sendMidiClockPulse?.(midiClockBpm);
  renderMidiSetup();
};
const disableMidiClock = () => {
  if (!midiRuntimeEnabled) return;
  midiManager.disable();
  if (midiClockStatusTimer) clearTimeout(midiClockStatusTimer);
  midiClockStatusTimer = 0;
  resetMidiTempoTracking();
  midiRuntimeEnabled = false;
  midiTransportRunning = false;
  midiClockStatus = 'DISABLED';
  midiTransportStatus = '—';
  if (usesMidiClockSource()) {
    if (state.lfoClock?.source === 'midi') {
      setClockState({ running: false, midiAvailable: midiAccessStatus === 'CONNECTED', midiBpm: 120, midiStatus: 'DISABLED' }, 'stop');
    } else audioEngine?.sendLfoClockMessage?.('stop');
  }
  renderMidiSetup();
};
const enableMidiClock = async () => {
  try {
    if (!midiManager.available) {
      midiAccessStatus = 'UNAVAILABLE';
      midiRuntimeEnabled = false;
      midiClockStatus = 'DISABLED';
      renderMidiSetup();
      return false;
    }
    const result = await midiManager.enable();
    midiAccessStatus = result.status;
    midiRuntimeEnabled = true;
    midiAccessMessage.dataset.error = '';
    if (midiConfig.deviceId && midiManager.inputs.some(input => input.id === midiConfig.deviceId)) midiManager.select(midiConfig.deviceId);
    resetMidiTempoTracking();
    midiClockStatus = !midiConfig.receive ? 'DISABLED' : midiManager.selectedId ? 'NO CLOCK' : 'NO INPUT';
    if (state.lfoClock?.source === 'midi') setClockState({ midiAvailable: true, running: false, midiStatus: midiClockStatus });
    else if (state.clockMod?.clockSource === 'midi') audioEngine?.sendLfoClockMessage?.('stop');
    renderMidiSetup();
    return true;
  } catch (error) {
    if (!midiManager.access) midiAccessStatus = 'NOT GRANTED';
    midiRuntimeEnabled = false;
    midiAccessMessage.textContent = error?.name === 'SecurityError' ? 'MIDI access is blocked by browser or site settings.' : 'MIDI access could not be enabled. Try again.';
    midiAccessMessage.dataset.error = 'true';
    renderMidiSetup();
    return false;
  }
};
document.querySelectorAll('[data-midi-setup]').forEach(button => button.addEventListener('click', () => {
  renderMidiSetup();
  if (midiDialog && !midiDialog.open) midiDialog.showModal();
}));
document.querySelector('[data-midi-enable]')?.addEventListener('click', () => {
  if (midiRuntimeEnabled) disableMidiClock();
  else enableMidiClock();
});
midiRefreshButton?.addEventListener('click', () => {
  if (midiRuntimeEnabled && midiManager.access) {
    midiManager.refresh();
    midiAccessStatus = 'CONNECTED';
    renderMidiSetup();
  } else if (!midiManager.available) {
    midiAccessStatus = 'UNAVAILABLE';
    renderMidiSetup();
  }
});
midiInputSelect?.addEventListener('change', () => {
  midiManager.select(midiInputSelect.value);
  midiConfig.deviceId = midiManager.selectedId;
  persistMidiConfig();
  resetMidiClockTracking(!midiConfig.receive ? 'DISABLED' : (midiManager.selectedId ? 'NO CLOCK' : 'NO INPUT'));
});
midiReceiveToggle?.addEventListener('change', () => {
  midiConfig.receive = midiReceiveToggle.checked;
  persistMidiConfig();
  if (!midiConfig.receive) resetMidiClockTracking('DISABLED');
  else resetMidiClockTracking(midiManager.selectedId ? 'NO CLOCK' : 'NO INPUT');
});
midiTransportSelect?.addEventListener('change', () => {
  midiConfig.transport = midiTransportSelect.value === 'auto' ? 'auto' : 'follow';
  persistMidiConfig();
  resetMidiClockTracking(midiConfig.receive ? (midiManager.selectedId ? 'NO CLOCK' : 'NO INPUT') : 'DISABLED');
});

export {
  lfoMidiStatus, midiConfig, midiAccessStatus, midiRuntimeEnabled, midiDisplayBpm, getMidiStatusText,
  setClockState, midiManager, setMidiTransportRunning
};
