# Dynamic EQ V1

## Signal path

The AudioWorklet feeds the incoming left and right samples into separate copies of the ten bandpass filters. These detector filters read the source **before** FILTERBANK feedback, static band gain, FILTER shape and Dynamic EQ gain. The detector never reads the dynamically corrected output. This choice means feedback-generated peaks do not drive V1 detection.

For each band, the linked detector uses the larger absolute band sample from left or right. PEAK follows that magnitude with an immediate rise and a 15 ms exponential fall. RMS smooths its **square** with a 50 ms exponential window, then takes the square root. Levels use dBFS with a -120 dBFS floor. Both channels receive one shared gain correction per band, so a one-sided signal cannot move the stereo balance through independent gain control.

The global threshold and half-window set upper and lower boundaries. CUT reduces levels above the upper boundary, BOOST raises levels below the lower boundary, and BALANCE applies both. The distance outside the window is multiplied by Strength and limited by Range. Attack builds stronger correction; Release returns toward zero. A sign reversal releases to zero before the opposite correction attacks. Band Sensitivity scales the smoothed correction, leaving the global threshold calculation unchanged.

The engine keeps manual FILTERBANK gains and FILTER shape in their existing state. It sends their un-clamped dB sum to the worklet alongside the existing static band controls. The worklet adds the temporary Dynamic EQ dB offset and applies the shared boost/cut clamp before converting to linear gain. Feedback taps continue to use the static gain path. Dynamic EQ power OFF sets all dynamic offsets to zero immediately while retaining its parameters.

The detector runs only while Dynamic EQ is enabled. It reuses the worklet's band frequencies and Q values, without an FFT, DOM access or per-sample allocation. Level, target and applied gain telemetry is sent at approximately 15 Hz. The UI graph shows detector dBFS, threshold/window and bipolar correction separately.

V1 is absolute threshold, stereo linked and input detected. Relative detection, learning, freeze, sidechain, dual stereo, mid/side, separate cut/boost ranges, per-band thresholds and per-band timing remain future work.
