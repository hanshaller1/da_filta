(function () {
  const { BAND_COUNT, BAND_GAIN_MIN, BAND_GAIN_MAX, clampBandGain } = window.ResonantState;
  const dbToGain = db => 10 ** (Number(db) / 20);
  const dryWetGains = value => {
    const wet = Math.min(100, Math.max(0, Number(value))) / 100;
    return { dry: 1 - wet, wet };
  };

  class AudioEngine {
    constructor({ onStatusChange, onDevicesChanged }) {
      this.onStatusChange = onStatusChange;
      this.onDevicesChanged = onDevicesChanged;
      this.status = 'OFF';
      this.inputGainDb = 0;
      this.resonance = 0;
      this.positiveResonanceAuditionGain = window.Filterbank?.POSITIVE_RESONANCE_AUDITION_GAIN ?? 0.1;
      this.positiveResonanceDrive = window.Filterbank?.POSITIVE_RESONANCE_DRIVE ?? 1;
      this.positiveResonanceDampingFloor = window.Filterbank?.POSITIVE_RESONANCE_DAMPING_FLOOR ?? 0.1;
      this.positiveResonanceOutputMode = window.Filterbank?.POSITIVE_RESONANCE_OUTPUT_MODE ?? 'current-residual';
      this.positiveResonanceLatencyMode = window.Filterbank?.POSITIVE_RESONANCE_LATENCY_MODE ?? 'current';
      this.positiveResonanceCurve = window.Filterbank?.POSITIVE_RESONANCE_CURVE ?? 'current';
      this.dryWet = 50;
      this.volumeDb = -6;
      this.context = null;
      this.stream = null;
      this.source = null;
      this.inputGainNode = null;
      this.dryGainNode = null;
      this.wetGainNode = null;
      this.mixBus = null;
      this.volumeGainNode = null;
      this.destination = null;
      this.outputElement = null;
      this.filterbank = null;
      this.bandGainLeft = Array(BAND_COUNT).fill(0);
      this.bandGainRight = Array(BAND_COUNT).fill(0);
      this.feedbackBandLeft = Array(BAND_COUNT).fill(false);
      this.feedbackBandRight = Array(BAND_COUNT).fill(false);
      this.feedbackAllLeft = false;
      this.feedbackAllRight = false;
      this.handleDeviceChange = () => this.refreshDevices().then(devices => this.onDevicesChanged?.(devices)).catch(() => {});
      if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', this.handleDeviceChange);
    }

    setStatus(status, message = '') {
      this.status = status;
      this.onStatusChange?.(status, message);
    }

    async refreshDevices() {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Gerätezugriff wird von diesem Browser nicht unterstützt.');
      const devices = await navigator.mediaDevices.enumerateDevices();
      return { inputs: devices.filter(device => device.kind === 'audioinput'), outputs: devices.filter(device => device.kind === 'audiooutput') };
    }

    setInputGainDb(value) {
      this.inputGainDb = Math.max(0, Math.min(24, Number(value)));
      this.setSmoothedParam(this.inputGainNode?.gain, dbToGain(this.inputGainDb));
    }

    setDryWet(value) {
      this.dryWet = Math.max(0, Math.min(100, Number(value)));
      const gains = dryWetGains(this.dryWet);
      this.setSmoothedParam(this.dryGainNode?.gain, gains.dry);
      this.setSmoothedParam(this.wetGainNode?.gain, gains.wet);
    }

    setVolumeDb(value) {
      this.volumeDb = Math.max(-60, Math.min(0, Number(value)));
      this.setSmoothedParam(this.volumeGainNode?.gain, dbToGain(this.volumeDb));
    }

    setResonance(value) {
      const numericValue = Number(value);
      this.resonance = Number.isFinite(numericValue) ? Math.max(-1, Math.min(1, numericValue)) : 0;
      this.filterbank?.setResonance(this.resonance);
      return this.resonance;
    }

    setPositiveResonanceAuditionGain(value) {
      const numericValue = Number(value);
      this.positiveResonanceAuditionGain = Number.isFinite(numericValue) && numericValue > 0
        ? numericValue
        : (window.Filterbank?.POSITIVE_RESONANCE_AUDITION_GAIN ?? 0.1);
      this.filterbank?.setPositiveResonanceAuditionGain(this.positiveResonanceAuditionGain);
      return this.positiveResonanceAuditionGain;
    }

    setPositiveResonanceDrive(value) {
      const numericValue = Number(value);
      this.positiveResonanceDrive = numericValue === 1 || numericValue === 2 || numericValue === 4 || numericValue === 8 || numericValue === 16 || numericValue === 24 || numericValue === 32
        ? numericValue
        : (window.Filterbank?.POSITIVE_RESONANCE_DRIVE ?? 1);
      this.filterbank?.setPositiveResonanceDrive(this.positiveResonanceDrive);
      return this.positiveResonanceDrive;
    }

    setPositiveResonanceDampingFloor(value) {
      const numericValue = Number(value);
      this.positiveResonanceDampingFloor = numericValue === 0.10 || numericValue === 0.05 || numericValue === 0.02
        || numericValue === 0 || numericValue === -0.02 || numericValue === -0.05 || numericValue === -0.10
        ? numericValue
        : (window.Filterbank?.POSITIVE_RESONANCE_DAMPING_FLOOR ?? 0.1);
      this.filterbank?.setPositiveResonanceDampingFloor(this.positiveResonanceDampingFloor);
      return this.positiveResonanceDampingFloor;
    }

    setPositiveResonanceOutputMode(value) {
      this.positiveResonanceOutputMode = value === 'nonlinear-base' || value === 'full-nonlinear' ? value : 'current-residual';
      this.filterbank?.setPositiveResonanceOutputMode(this.positiveResonanceOutputMode);
      return this.positiveResonanceOutputMode;
    }

    setPositiveResonanceLatencyMode(value) {
      this.positiveResonanceLatencyMode = value === 'matched' ? value : 'current';
      this.filterbank?.setPositiveResonanceLatencyMode(this.positiveResonanceLatencyMode);
      return this.positiveResonanceLatencyMode;
    }

    setPositiveResonanceCurve(value) {
      this.positiveResonanceCurve = value === 'early' || value === 'aggressive' ? value : 'current';
      this.filterbank?.setPositiveResonanceCurve(this.positiveResonanceCurve);
      return this.positiveResonanceCurve;
    }

    setBandBaseGain(channel, index, value) {
      if (!Number.isInteger(index) || index < 0 || index >= BAND_COUNT) throw new RangeError('Ungültiger Bandindex.');
      const nextValue = clampBandGain(value);
      const target = channel === 'left' ? this.bandGainLeft : this.bandGainRight;
      target[index] = nextValue;
      this.filterbank?.setBandBaseGain(channel, index, nextValue);
      return nextValue;
    }

    setBandFeedback(channel, index, enabled) {
      if (!Number.isInteger(index) || index < 0 || index >= BAND_COUNT) throw new RangeError('Ungültiger Bandindex.');
      if (channel !== 'left' && channel !== 'right') throw new RangeError('Ungültiger Audiokanal.');
      const target = channel === 'left' ? this.feedbackBandLeft : this.feedbackBandRight;
      const nextValue = Boolean(enabled);
      target[index] = nextValue;
      this.filterbank?.setBandFeedback(channel, index, nextValue);
      return nextValue;
    }

    setFeedbackAll(channel, enabled) {
      if (channel !== 'left' && channel !== 'right') throw new RangeError('Ungültiger Audiokanal.');
      const nextValue = Boolean(enabled);
      if (channel === 'left') this.feedbackAllLeft = nextValue;
      else this.feedbackAllRight = nextValue;
      this.filterbank?.setFeedbackAll(channel, nextValue);
      return nextValue;
    }

    getFilterbankState() {
      return {
        bandGainLeft: this.bandGainLeft,
        bandGainRight: this.bandGainRight,
        feedbackBandLeft: this.feedbackBandLeft,
        feedbackBandRight: this.feedbackBandRight,
        feedbackAllLeft: this.feedbackAllLeft,
        feedbackAllRight: this.feedbackAllRight,
        resonance: this.resonance,
        positiveResonanceAuditionGain: this.positiveResonanceAuditionGain,
        positiveResonanceDrive: this.positiveResonanceDrive,
        positiveResonanceDampingFloor: this.positiveResonanceDampingFloor,
        positiveResonanceOutputMode: this.positiveResonanceOutputMode,
        positiveResonanceLatencyMode: this.positiveResonanceLatencyMode,
        positiveResonanceCurve: this.positiveResonanceCurve
      };
    }

    applyState(snapshot) {
      const left = Array.isArray(snapshot?.bandGainLeft) ? snapshot.bandGainLeft : [];
      const right = Array.isArray(snapshot?.bandGainRight) ? snapshot.bandGainRight : [];
      this.bandGainLeft = Array.from({ length: BAND_COUNT }, (_, index) => clampBandGain(left[index] ?? 0));
      this.bandGainRight = Array.from({ length: BAND_COUNT }, (_, index) => clampBandGain(right[index] ?? 0));
      this.feedbackBandLeft = Array.from({ length: BAND_COUNT }, (_, index) => Boolean(snapshot?.feedbackBandLeft?.[index]));
      this.feedbackBandRight = Array.from({ length: BAND_COUNT }, (_, index) => Boolean(snapshot?.feedbackBandRight?.[index]));
      this.feedbackAllLeft = Boolean(snapshot?.feedbackAllLeft);
      this.feedbackAllRight = Boolean(snapshot?.feedbackAllRight);
      this.setResonance(snapshot?.resonance);
      this.setPositiveResonanceDrive(snapshot?.positiveResonanceDrive ?? this.positiveResonanceDrive);
      this.setPositiveResonanceDampingFloor(snapshot?.positiveResonanceDampingFloor ?? this.positiveResonanceDampingFloor);
      this.setPositiveResonanceOutputMode(snapshot?.positiveResonanceOutputMode ?? this.positiveResonanceOutputMode);
      this.setPositiveResonanceLatencyMode(snapshot?.positiveResonanceLatencyMode ?? this.positiveResonanceLatencyMode);
      this.setPositiveResonanceCurve(snapshot?.positiveResonanceCurve ?? this.positiveResonanceCurve);
      if (this.filterbank) this.filterbank.applyState(this.getFilterbankState());
    }

    setSmoothedParam(param, value) {
      this.setAudioParam(param, value, false);
    }

    setAudioParam(param, value, immediate) {
      if (!param) return;
      if (immediate) { param.value = value; return; }
      const now = this.context?.currentTime || 0;
      if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(now);
      if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(value, now, 0.015);
      else param.value = value;
    }

    applyAudioParameters(immediate = false) {
      this.setAudioParam(this.inputGainNode?.gain, dbToGain(this.inputGainDb), immediate);
      const gains = dryWetGains(this.dryWet);
      this.setAudioParam(this.dryGainNode?.gain, gains.dry, immediate);
      this.setAudioParam(this.wetGainNode?.gain, gains.wet, immediate);
      this.setAudioParam(this.volumeGainNode?.gain, dbToGain(this.volumeDb), immediate);
    }

    async start({ inputDeviceId, outputDeviceId }) {
      if (this.status === 'STARTING' || this.status === 'ON') return;
      this.setStatus('STARTING');
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('AudioContext ist in diesem Browser nicht verfügbar.');
        this.context = new AudioContextClass();
        await this.context.resume();
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofonzugriff wird von diesem Browser nicht unterstützt.');
        const audioConstraints = { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        if (inputDeviceId) audioConstraints.deviceId = { exact: inputDeviceId };
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        if (this.onDevicesChanged) this.onDevicesChanged(await this.refreshDevices());

        this.source = this.context.createMediaStreamSource(this.stream);
        this.inputGainNode = this.context.createGain();
        this.dryGainNode = this.context.createGain();
        this.wetGainNode = this.context.createGain();
        this.mixBus = this.context.createGain();
        this.volumeGainNode = this.context.createGain();
        this.destination = this.context.createMediaStreamDestination();
        this.filterbank = await Filterbank.create(this.context, this.getFilterbankState());

        // The wet branch stays structurally unchanged; Filterbank owns its DSP internally.
        this.source.connect(this.inputGainNode);
        this.inputGainNode.connect(this.dryGainNode);
        this.inputGainNode.connect(this.filterbank.input);
        this.dryGainNode.connect(this.mixBus);
        this.filterbank.output.connect(this.wetGainNode);
        this.wetGainNode.connect(this.mixBus);
        this.mixBus.connect(this.volumeGainNode);
        this.volumeGainNode.connect(this.destination);
        this.applyAudioParameters(true);

        this.outputElement = document.createElement('audio');
        this.outputElement.autoplay = true;
        this.outputElement.srcObject = this.destination.stream;
        document.body.appendChild(this.outputElement);
        if (typeof this.outputElement.setSinkId === 'function') await this.outputElement.setSinkId(outputDeviceId || '');
        else if (outputDeviceId) throw new Error('Dieses Chrome-Setup unterstützt keine Audio-Auswahl.');
        await this.outputElement.play();
        this.setStatus('ON');
      } catch (error) {
        await this.cleanup();
        this.setStatus('ERROR', this.getErrorMessage(error));
        throw error;
      }
    }

    async stop() {
      await this.cleanup();
      this.setStatus('OFF');
    }

    disconnectNode(node) {
      if (node) node.disconnect();
    }

    async cleanup() {
      if (this.filterbank) { this.filterbank.dispose(); this.filterbank = null; }
      [this.source, this.inputGainNode, this.dryGainNode, this.wetGainNode, this.mixBus, this.volumeGainNode].forEach(node => this.disconnectNode(node));
      this.source = null;
      this.inputGainNode = null;
      this.dryGainNode = null;
      this.wetGainNode = null;
      this.mixBus = null;
      this.volumeGainNode = null;
      if (this.stream) { this.stream.getTracks().forEach(track => track.stop()); this.stream = null; }
      if (this.outputElement) { this.outputElement.pause(); this.outputElement.srcObject = null; this.outputElement.remove(); this.outputElement = null; }
      if (this.context) { await this.context.close(); this.context = null; }
      this.destination = null;
    }

    getErrorMessage(error) {
      if (error?.name === 'NotAllowedError') return 'Audio-Berechtigung wurde verweigert.';
      if (error?.name === 'NotFoundError') return 'Kein Audio-Eingabegerät gefunden.';
      if (error?.name === 'NotReadableError') return 'Das Audio-Eingabegerät ist nicht verfügbar.';
      return error?.message || 'Audio konnte nicht gestartet werden.';
    }
  }

  window.AudioEngine = AudioEngine;
})();
