# Clock Mod V1

## Reference and implementation boundary

The supplied Desktop Manual reference defines Clock Mod as a clocked sample-and-hold that samples a continuous modulation source and updates the current filterbank band. The V1 behavior in this repository follows the task's Desktop contract. It does not claim that the Erica hardware uses da_filta's waveform set, frequency range, progression directions, midpoint mapping, locks, or transport details.

The official Graphic Resonant FB manual describes its own CV1 shift-register and ALL-CV sample-and-hold modes, plus an internal/external clock and CV gain control. Those Eurorack details are hardware-specific and are not copied into this Desktop-mode implementation: [Graphic Resonant FB manual](https://www.ericasynths.lv/media/resonant.pdf).

## da_filta V1

- The LFO core supplies the free-running waveform and random sample-and-hold semantics. P2 exposes the existing held outputs through common modulation-core assignments; Clock Mod itself has no parameter targets.
- Source Frequency reuses the LFO free-rate range of 0.01–20 Hz. Internal BPM is a separate clock rate and supports 1–10,000 BPM without changing the shared LFO clock limits.
- The existing AudioWorklet ClockCore and MIDI input feed one shared MIDI beat position. Clock Mod can select that MIDI phase independently of the LFO clock selection; its scale uses the shared clock division table.
- Per-band left/right held values are a temporary additive dB layer in the existing band-modulation path. Manual base gains are not written. Other active layers combine before the existing band-limit clamp.
- Reset and re-enable set the runtime cursor to Band 1 for the next tick, then apply the selected direction. A backward progression therefore continues with Band 10 after its reset-first Band 1 tick.
- Modulation Gain scales the largest symmetric excursion around Midpoint that fits within the active positive and negative band limits. Right Invert negates that sampled offset for the right channel.
- Runtime phase, progression and held arrays stay in the worklet. Persisted state contains only Clock Mod configuration.
- UI telemetry is capped at 15 Hz; clock steps never generate DOM events.

## P2 routing extension

The compact assignment editor chooses LATEST or one of ten BAND holds and routes
it to existing audio targets or safe LFO/Envelope parameter targets. Legacy states
migrate to ten original held-band routes, preserving their dB values and exact
sample timing. New routes support per-row amount, channel, invert, enable, remove,
lost-target status and automatic reactivation. This changes routing only;
the generator and its clock/hold behavior remain V1. See
[Modulation Core](modulation-core.md#clock-mod-held-sources-and-migration).

## Deferred V2 topic

`CLOCK MOD STEREO DELAY / SPREAD DELAY` is deferred. V1 does not reinterpret the existing global SPREAD control or add sample delay between left and right channels.
