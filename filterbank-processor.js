class ResonantFilterbankProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const processorOptions = options?.processorOptions || {};
    this.bandFrequencies = this.readBandDefinition(processorOptions.bandFrequencies, 'Frequenzen');
    this.bandQs = this.readBandDefinition(processorOptions.bandQs, 'Q-Werte');
    this.bandCount = this.bandFrequencies.length;
    this.maxBandGainDb = Number.isFinite(processorOptions.maxBandGainDb) ? processorOptions.maxBandGainDb : 12;
    const smoothingTime = Number.isFinite(processorOptions.smoothingTime) ? processorOptions.smoothingTime : 0.015;
    this.smoothingCoefficient = Math.exp(-1 / Math.max(1, smoothingTime * sampleRate));
    this.disposed = false;
    this.bandControls = {
      left: this.readControls(processorOptions.bandGainLeft),
      right: this.readControls(processorOptions.bandGainRight)
    };
    this.deltaGains = {
      left: this.bandControls.left.map(control => this.controlToDeltaGain(control)),
      right: this.bandControls.right.map(control => this.controlToDeltaGain(control))
    };
    this.deltaTargets = {
      left: [...this.deltaGains.left],
      right: [...this.deltaGains.right]
    };
    this.filters = {
      left: this.createFilters(),
      right: this.createFilters()
    };

    this.port.onmessage = event => this.handleMessage(event.data);
  }

  readBandDefinition(values, label) {
    if (!Array.isArray(values) || values.length !== 10 || values.some(value => !Number.isFinite(value) || value <= 0)) {
      throw new Error(`Ungültige Filterbank-${label}.`);
    }
    return [...values];
  }

  readControls(values) {
    return Array.from({ length: this.bandCount }, (_, index) => this.clampControl(values?.[index] ?? 0));
  }

  clampControl(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.min(100, Math.max(-100, numericValue));
  }

  controlToDeltaGain(control) {
    const gainDb = this.maxBandGainDb * (this.clampControl(control) / 100);
    return 10 ** (gainDb / 20) - 1;
  }

  createFilters() {
    return this.bandFrequencies.map((frequency, index) => {
      const omega = 2 * Math.PI * frequency / sampleRate;
      const alpha = Math.sin(omega) / (2 * this.bandQs[index]);
      const a0 = 1 + alpha;
      return {
        b0: alpha / a0,
        b1: 0,
        b2: -alpha / a0,
        a1: (-2 * Math.cos(omega)) / a0,
        a2: (1 - alpha) / a0,
        z1: 0,
        z2: 0
      };
    });
  }

  processBandpass(filter, input) {
    const output = filter.b0 * input + filter.z1;
    filter.z1 = filter.b1 * input - filter.a1 * output + filter.z2;
    filter.z2 = filter.b2 * input - filter.a2 * output;
    return output;
  }

  setBandControl(channel, index, value, immediate = false) {
    if ((channel !== 'left' && channel !== 'right') || !Number.isInteger(index) || index < 0 || index >= this.bandCount) return;
    const control = this.clampControl(value);
    const deltaGain = this.controlToDeltaGain(control);
    this.bandControls[channel][index] = control;
    this.deltaTargets[channel][index] = deltaGain;
    if (immediate) this.deltaGains[channel][index] = deltaGain;
  }

  applyState(data) {
    const left = this.readControls(data.bandGainLeft);
    const right = this.readControls(data.bandGainRight);
    for (let index = 0; index < this.bandCount; index += 1) {
      this.setBandControl('left', index, left[index], true);
      this.setBandControl('right', index, right[index], true);
    }
  }

  handleMessage(data) {
    if (!data || this.disposed) return;
    if (data.type === 'set-band-base-gain') {
      this.setBandControl(data.channel, data.index, data.value);
      return;
    }
    if (data.type === 'apply-state') {
      this.applyState(data);
      return;
    }
    if (data.type === 'dispose') {
      this.disposed = true;
      this.port.onmessage = null;
    }
  }

  processChannel(input, output, channel) {
    const filters = this.filters[channel];
    const gains = this.deltaGains[channel];
    const targets = this.deltaTargets[channel];

    for (let frame = 0; frame < output.length; frame += 1) {
      const source = input ? input[frame] : 0;
      let sum = source;
      for (let band = 0; band < this.bandCount; band += 1) {
        gains[band] = targets[band] + this.smoothingCoefficient * (gains[band] - targets[band]);
        sum += gains[band] * this.processBandpass(filters[band], source);
      }
      output[frame] = sum;
    }
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0] || [];
    const outputChannels = outputs[0] || [];
    if (outputChannels[0]) this.processChannel(inputChannels[0], outputChannels[0], 'left');
    if (outputChannels[1]) this.processChannel(inputChannels[1], outputChannels[1], 'right');
    return !this.disposed;
  }
}

registerProcessor('resonant-filterbank-processor', ResonantFilterbankProcessor);
