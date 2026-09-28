export const CLOCK_SOURCES = Object.freeze(['internal', 'midi']);
export const CLOCK_MIN_BPM = 30;
export const CLOCK_MAX_BPM = 300;
export const CLOCK_DEFAULT_BPM = 120;
export const SYNC_DIVISION_BEATS = Object.freeze({
  '1/32': 0.125, '1/16': 0.25, '1/8': 0.5, '1/4': 1,
  '1/2': 2, '1/1': 4, '2/1': 8, '4/1': 16
});

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

export function normalizeClockState(source = {}) {
  return {
    source: source.source === 'midi' ? 'midi' : 'internal',
    bpm: clamp(source.bpm, CLOCK_MIN_BPM, CLOCK_MAX_BPM, CLOCK_DEFAULT_BPM),
    midiBpm: clamp(source.midiBpm, CLOCK_MIN_BPM, CLOCK_MAX_BPM, CLOCK_DEFAULT_BPM),
    running: source.running === undefined ? source.source !== 'midi' : source.running !== false,
    midiAvailable: source.midiAvailable === true,
    midiStatus: typeof source.midiStatus === 'string' ? source.midiStatus : 'UNAVAILABLE'
  };
}

// Shared sample-clock phase for all synchronized modulation sources. The
// position is measured in quarter-note beats and advances only from audio
// samples; MIDI clock messages periodically re-anchor it at 24 PPQN.
export class ClockCore {
  constructor(source = {}) {
    this.state = normalizeClockState(source);
    this.beatPosition = 0;
    // MIDI phase is tracked alongside the selected LFO clock so another mode
    // can follow MIDI without changing the LFO's independent clock selection.
    this.midiBeatPosition = 0;
    this.midiTransportRunning = this.state.source === 'midi' && this.state.running;
    this.midiPulseCount = 0;
    this.clockModTickPhase = 0;
    this.sampleRate = 48000;
  }

  configure(source = {}) {
    this.state = normalizeClockState({ ...this.state, ...source });
    if (this.state.source === 'midi') this.midiTransportRunning = this.state.running;
    return { ...this.state };
  }

  start(reset = true) {
    if (reset) {
      this.beatPosition = 0;
      this.midiBeatPosition = 0;
      this.midiPulseCount = 0;
    }
    this.state.running = true;
    this.midiTransportRunning = true;
  }

  startMidi(reset = true) {
    if (reset) {
      this.midiBeatPosition = 0;
      this.midiPulseCount = 0;
      if (this.state.source === 'midi') this.beatPosition = 0;
    }
    this.midiTransportRunning = true;
    if (this.state.source === 'midi') this.state.running = true;
  }

  stop() { this.state.running = false; this.midiTransportRunning = false; }

  stopMidi() {
    this.midiTransportRunning = false;
    if (this.state.source === 'midi') this.state.running = false;
  }

  continue() { this.state.running = true; this.midiTransportRunning = true; }

  continueMidi() {
    this.midiTransportRunning = true;
    if (this.state.source === 'midi') this.state.running = true;
  }

  setMidiTempo(bpm) {
    this.state.midiBpm = clamp(bpm, CLOCK_MIN_BPM, CLOCK_MAX_BPM, this.state.midiBpm);
  }

  midiPulse() {
    if (!this.midiTransportRunning || (this.state.source === 'midi' && !this.state.running)) return false;
    this.midiPulseCount += 1;
    // Pulses are absolute quarter-note subdivisions since MIDI Start. Modulo
    // 24 loses the beat rollover and can re-anchor 0.99 back to 0.0 on pulse 24.
    this.midiBeatPosition = this.midiPulseCount / 24;
    if (this.state.source === 'midi') this.beatPosition = this.midiBeatPosition;
    return true;
  }

  advance(sampleRate = this.sampleRate) {
    const safeRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
    this.sampleRate = safeRate;
    if (this.state.running) {
      const bpm = this.state.source === 'midi' ? this.state.midiBpm : this.state.bpm;
      this.beatPosition += bpm / 60 / safeRate;
    }
    if (this.midiTransportRunning) {
      this.midiBeatPosition += this.state.midiBpm / 60 / safeRate;
      if (this.state.source === 'midi' && this.state.running) this.beatPosition = this.midiBeatPosition;
    }
    return this.beatPosition;
  }

  // Clock Mod has its own BPM setting, but shares this audio-sample clock
  // engine. The high-rate phase is isolated from the LFO's 30-300 BPM range.
  advanceClockModSteps(bpm, sampleRate = this.sampleRate) {
    const safeRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
    const numericBpm = Number(bpm);
    const safeBpm = Number.isFinite(numericBpm) ? Math.min(10000, Math.max(1, numericBpm)) : 120;
    this.clockModTickPhase += safeBpm / 60 / safeRate;
    const due = Math.floor(this.clockModTickPhase + 1e-10);
    if (due < 1) return 0;
    this.clockModTickPhase = Math.max(0, this.clockModTickPhase - due);
    return Math.min(3, due);
  }

  resetClockModPhase() { this.clockModTickPhase = 0; }

  phaseFor(division = '1/4', resetBeat = 0, phaseOffset = 0) {
    const beatsPerCycle = SYNC_DIVISION_BEATS[division] || 1;
    const cycle = (this.beatPosition - resetBeat) / beatsPerCycle + phaseOffset;
    return ((cycle % 1) + 1) % 1;
  }

  snapshot() { return { ...this.state, beatPosition: this.beatPosition, midiPulseCount: this.midiPulseCount }; }
}
