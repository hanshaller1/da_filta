(function () {
  const {
    BAND_DEFINITIONS,
    BAND_COUNT,
    BAND_GAIN_MAX,
    clampBandGain,
    setBandBaseGain
  } = window.ResonantState;

  const MAX_BAND_GAIN_DB = 12;
  const PARAMETER_SMOOTHING_SECONDS = 0.015;
  const PROCESSOR_NAME = 'resonant-filterbank-processor';
  const workletModuleLoads = new WeakMap();
  const bandFrequencies = Object.freeze(BAND_DEFINITIONS.map(band => band.frequency));
  const bandBoundaries = Object.freeze(
    bandFrequencies.slice(0, -1).map((frequency, index) => Math.sqrt(frequency * bandFrequencies[index + 1]))
  );
  const bandQs = Object.freeze(bandFrequencies.map((frequency, index) => {
    const lower = index === 0 ? (frequency * frequency) / bandBoundaries[0] : bandBoundaries[index - 1];
    const upper = index === BAND_COUNT - 1 ? (frequency * frequency) / bandBoundaries[BAND_COUNT - 2] : bandBoundaries[index];
    return frequency / (upper - lower);
  }));

  const controlToGainDb = control => MAX_BAND_GAIN_DB * (Number(control) / BAND_GAIN_MAX);
  const controlToDeltaGain = control => 10 ** (controlToGainDb(control) / 20) - 1;
  const normalizeChannel = channel => {
    if (channel === 'left' || channel === 'L') return 'left';
    if (channel === 'right' || channel === 'R') return 'right';
    throw new RangeError('Ungültiger Audiokanal.');
  };
  const readBandControls = (snapshot, property) => {
    const values = Array.isArray(snapshot?.[property]) ? snapshot[property] : [];
    return Array.from({ length: BAND_COUNT }, (_, index) => clampBandGain(values[index] ?? 0));
  };
  const getWorkletModuleUrl = () => new URL('filterbank-processor.js', window.location.href).href;

  const loadWorkletModule = async audioContext => {
    if (!audioContext?.audioWorklet?.addModule) {
      throw new Error('AudioWorklet wird von diesem Browser oder AudioContext nicht unterstützt.');
    }

    const existingLoad = workletModuleLoads.get(audioContext);
    if (existingLoad) return existingLoad;

    const load = audioContext.audioWorklet.addModule(getWorkletModuleUrl()).catch(error => {
      workletModuleLoads.delete(audioContext);
      throw new Error(`Filterbank-AudioWorklet konnte nicht geladen werden: ${error?.message || error}`);
    });
    workletModuleLoads.set(audioContext, load);
    return load;
  };

  class Filterbank {
    static async create(audioContext, initialState) {
      await loadWorkletModule(audioContext);
      return new Filterbank(audioContext, initialState);
    }

    constructor(audioContext, initialState) {
      if (typeof AudioWorkletNode !== 'function') {
        throw new Error('AudioWorkletNode wird von diesem Browser nicht unterstützt.');
      }

      this.context = audioContext;
      this.disposed = false;
      this.bandGainLeft = readBandControls(initialState, 'bandGainLeft');
      this.bandGainRight = readBandControls(initialState, 'bandGainRight');
      this.inputNode = audioContext.createGain();
      this.outputNode = audioContext.createGain();
      this.inputNode.gain.value = 1;
      this.outputNode.gain.value = 1;
      this.workletNode = new AudioWorkletNode(audioContext, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        processorOptions: {
          bandFrequencies: [...bandFrequencies],
          bandQs: [...bandQs],
          bandGainLeft: [...this.bandGainLeft],
          bandGainRight: [...this.bandGainRight],
          maxBandGainDb: MAX_BAND_GAIN_DB,
          smoothingTime: PARAMETER_SMOOTHING_SECONDS
        }
      });
      this.inputNode.connect(this.workletNode);
      this.workletNode.connect(this.outputNode);
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
      this.workletNode.port.postMessage({
        type: 'set-band-base-gain',
        channel: normalizedChannel,
        index,
        value: nextValue
      });
      return nextValue;
    }

    applyState(snapshot) {
      if (this.disposed) return;
      this.bandGainLeft = readBandControls(snapshot, 'bandGainLeft');
      this.bandGainRight = readBandControls(snapshot, 'bandGainRight');
      this.workletNode.port.postMessage({
        type: 'apply-state',
        bandGainLeft: [...this.bandGainLeft],
        bandGainRight: [...this.bandGainRight]
      });
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.workletNode.port.postMessage({ type: 'dispose' });
      this.workletNode.port.onmessage = null;
      if (typeof this.workletNode.port.close === 'function') this.workletNode.port.close();
      this.inputNode.disconnect();
      this.workletNode.disconnect();
      this.outputNode.disconnect();
    }
  }

  Filterbank.BAND_FREQUENCIES = bandFrequencies;
  Filterbank.BAND_BOUNDARIES = bandBoundaries;
  Filterbank.BAND_QS = bandQs;
  Filterbank.controlToGainDb = controlToGainDb;
  Filterbank.controlToDeltaGain = controlToDeltaGain;
  Filterbank.PARAMETER_SMOOTHING_SECONDS = PARAMETER_SMOOTHING_SECONDS;
  Filterbank.PROCESSOR_NAME = PROCESSOR_NAME;
  window.Filterbank = Filterbank;
})();
