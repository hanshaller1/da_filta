(function () {
  const {
    BAND_DEFINITIONS,
    BAND_COUNT,
    BAND_GAIN_MAX,
    clampBandGain,
    setBandBaseGain
  } = window.ResonantState;

  const MAX_BAND_GAIN_DB = 12;
  const bandFrequencies = Object.freeze(BAND_DEFINITIONS.map(band => band.frequency));
  const bandBoundaries = Object.freeze(
    bandFrequencies.slice(0, -1).map((frequency, index) => Math.sqrt(frequency * bandFrequencies[index + 1]))
  );
  const bandQs = Object.freeze(bandFrequencies.map((frequency, index) => {
    const lower = index === 0
      ? (frequency * frequency) / bandBoundaries[0]
      : bandBoundaries[index - 1];
    const upper = index === BAND_COUNT - 1
      ? (frequency * frequency) / bandBoundaries[BAND_COUNT - 2]
      : bandBoundaries[index];
    return frequency / (upper - lower);
  }));

  const controlToGainDb = control => MAX_BAND_GAIN_DB * (Number(control) / BAND_GAIN_MAX);
  const controlToDeltaGain = control => 10 ** (controlToGainDb(control) / 20) - 1;
  const normalizeChannel = channel => {
    if (channel === 'left' || channel === 'L') return 'left';
    if (channel === 'right' || channel === 'R') return 'right';
    throw new RangeError('Ungültiger Audiokanal.');
  };

  class Filterbank {
    constructor(audioContext) {
      this.context = audioContext;
      this.inputNode = audioContext.createGain();
      this.outputNode = audioContext.createGain();
      this.splitterNode = audioContext.createChannelSplitter(2);
      this.mergerNode = audioContext.createChannelMerger(2);
      this.sums = {
        left: audioContext.createGain(),
        right: audioContext.createGain()
      };
      this.bandFilters = { left: [], right: [] };
      this.deltaGains = { left: [], right: [] };
      this.bandGainLeft = Array(BAND_COUNT).fill(0);
      this.bandGainRight = Array(BAND_COUNT).fill(0);
      this.disposed = false;

      this.sums.left.gain.value = 1;
      this.sums.right.gain.value = 1;
      this.outputNode.gain.value = 1;
      this.inputNode.connect(this.splitterNode);

      // The unfiltered reference path is always present on each channel.
      this.splitterNode.connect(this.sums.left, 0, 0);
      this.splitterNode.connect(this.sums.right, 1, 0);

      for (const channel of ['left', 'right']) {
        const splitterOutput = channel === 'left' ? 0 : 1;
        const sum = this.sums[channel];
        for (let index = 0; index < BAND_COUNT; index += 1) {
          const bandFilter = audioContext.createBiquadFilter();
          bandFilter.type = 'bandpass';
          bandFilter.frequency.value = bandFrequencies[index];
          bandFilter.Q.value = bandQs[index];

          const deltaGain = audioContext.createGain();
          deltaGain.gain.value = 0;
          this.splitterNode.connect(bandFilter, splitterOutput, 0);
          bandFilter.connect(deltaGain);
          deltaGain.connect(sum);

          this.bandFilters[channel].push(bandFilter);
          this.deltaGains[channel].push(deltaGain);
        }
      }

      this.sums.left.connect(this.mergerNode, 0, 0);
      this.sums.right.connect(this.mergerNode, 0, 1);
      this.mergerNode.connect(this.outputNode);
    }

    get input() {
      return this.inputNode;
    }

    get output() {
      return this.outputNode;
    }

    setBandBaseGain(channel, index, value) {
      if (this.disposed) return;
      const normalizedChannel = normalizeChannel(channel);
      const target = normalizedChannel === 'left' ? this.bandGainLeft : this.bandGainRight;
      const nextValue = setBandBaseGain({ bandGainLeft: this.bandGainLeft, bandGainRight: this.bandGainRight }, normalizedChannel, index, value);
      target[index] = nextValue;
      this.setDeltaGain(normalizedChannel, index, nextValue, false);
      return nextValue;
    }

    setDeltaGain(channel, index, control, immediate) {
      const deltaGain = this.deltaGains[channel]?.[index]?.gain;
      if (!deltaGain) return;
      const nextGain = controlToDeltaGain(clampBandGain(control));
      if (immediate) {
        deltaGain.value = nextGain;
        return;
      }
      const now = this.context.currentTime || 0;
      if (typeof deltaGain.cancelScheduledValues === 'function') deltaGain.cancelScheduledValues(now);
      if (typeof deltaGain.setTargetAtTime === 'function') deltaGain.setTargetAtTime(nextGain, now, 0.015);
      else deltaGain.value = nextGain;
    }

    applyState(snapshot) {
      if (this.disposed) return;
      const nextLeft = Array.isArray(snapshot?.bandGainLeft) ? snapshot.bandGainLeft : [];
      const nextRight = Array.isArray(snapshot?.bandGainRight) ? snapshot.bandGainRight : [];
      this.bandGainLeft = Array.from({ length: BAND_COUNT }, (_, index) => clampBandGain(nextLeft[index] ?? 0));
      this.bandGainRight = Array.from({ length: BAND_COUNT }, (_, index) => clampBandGain(nextRight[index] ?? 0));
      for (let index = 0; index < BAND_COUNT; index += 1) {
        this.setDeltaGain('left', index, this.bandGainLeft[index], true);
        this.setDeltaGain('right', index, this.bandGainRight[index], true);
      }
    }

    dispose() {
      if (this.disposed) return;
      [
        this.inputNode,
        this.outputNode,
        this.splitterNode,
        this.mergerNode,
        this.sums.left,
        this.sums.right,
        ...this.bandFilters.left,
        ...this.bandFilters.right,
        ...this.deltaGains.left,
        ...this.deltaGains.right
      ].forEach(node => node?.disconnect());
      this.disposed = true;
    }
  }

  Filterbank.BAND_FREQUENCIES = bandFrequencies;
  Filterbank.BAND_BOUNDARIES = bandBoundaries;
  Filterbank.BAND_QS = bandQs;
  Filterbank.controlToGainDb = controlToGainDb;
  Filterbank.controlToDeltaGain = controlToDeltaGain;
  window.Filterbank = Filterbank;
})();
