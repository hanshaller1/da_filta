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
    this.midiPulseCount = 0;
    this.sampleRate = 48000;
  }

  configure(source = {}) {
    this.state = normalizeClockState({ ...this.state, ...source });
    return { ...this.state };
  }

  start(reset = true) {
    if (reset) {
      this.beatPosition = 0;
      this.midiPulseCount = 0;
    }
    this.state.running = true;
  }

  stop() { this.state.running = false; }

  continue() { this.state.running = true; }

  setMidiTempo(bpm) {
    this.state.midiBpm = clamp(bpm, CLOCK_MIN_BPM, CLOCK_MAX_BPM, this.state.midiBpm);
  }

  midiPulse() {
    if (!this.state.running || this.state.source !== 'midi') return false;
    this.midiPulseCount += 1;
    // Pulses are absolute quarter-note subdivisions since MIDI Start. Modulo
    // 24 loses the beat rollover and can re-anchor 0.99 back to 0.0 on pulse 24.
    this.beatPosition = this.midiPulseCount / 24;
    return true;
  }

  advance(sampleRate = this.sampleRate) {
    const safeRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
    this.sampleRate = safeRate;
    if (this.state.running) {
      const bpm = this.state.source === 'midi' ? this.state.midiBpm : this.state.bpm;
      this.beatPosition += bpm / 60 / safeRate;
    }
    return this.beatPosition;
  }

  phaseFor(division = '1/4', resetBeat = 0, phaseOffset = 0) {
    const beatsPerCycle = SYNC_DIVISION_BEATS[division] || 1;
    const cycle = (this.beatPosition - resetBeat) / beatsPerCycle + phaseOffset;
    return ((cycle % 1) + 1) % 1;
  }

  snapshot() { return { ...this.state, beatPosition: this.beatPosition, midiPulseCount: this.midiPulseCount }; }
}
