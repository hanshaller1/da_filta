# Unified Signed ZDF Common Bus — DEV-A/B-Prototyp

Stand: Branch `feature/feedback-resonance`. `CURRENT` bleibt Default und Klangreferenz. `ZDF` ist nur bei `COMMON BUS` und `LOCAL LOOP EXP` aktiv; `ISOLATED TPT` verwendet weiterhin seinen bisherigen Pfad. Die DEV-Telemetrie kennzeichnet diesen Fall ausdrücklich. Bei einem Core-Wechsel werden die rekursiven Returns und die Base-TPT-Integratorzustände geleert; AudioContext und Worklet bleiben bestehen. Das ist ein diskreter A/B-Wechsel, kein Crossfade.

## Architektur und Herleitung

Im vorhandenen `LinearTptSvf.process()` gilt vor dem State-Commit:

```text
v3       = x - ic2eq
band     = a1·ic1eq + a2·v3
unitBand = baseK·band
```

Mit `x = source + R` folgt für jedes Band:

```text
y_i = a_i·R + b_i
a_i = baseK_i·a2_i
b_i = baseK_i·[a1_i·ic1eq_i + a2_i·(source - ic2eq_i)]
```

Die Zustände werden beim Berechnen von `a_i` und `b_i` nur gelesen. Nach Lösung von `R` wird jeder bestehende Base-TPT-Filter genau einmal mit `source + R` fortgeschrieben. Es gibt weder einen 10×10-Solver noch eine zweite Base-Filterbank.

```text
L(R) = A_L·R + B_L,   A_L = Σ gate_i·tapLocal_i·a_i,
                      B_L = Σ gate_i·tapLocal_i·b_i
M(R) = A_M·R + B_M,   A_M = gAll·level·Σ tapMain_i·a_i,
                      B_M = gAll·level·Σ tapMain_i·b_i
```

`tapLocal_i` ist bei `COMMON BUS / POST GAIN` der geglättete hörbare Band-Gain, sonst 1. Bei `LOCAL LOOP EXP` bleibt der lokale Tap PRE GAIN. `tapMain_i` ist bei `POST GAIN SUM` das bestehende `mainPostGainFeedbackWeight(audibleGain)` (einschließlich der optionalen Soft-Knee-Kennlinie), bei `PRE GAIN SUM` 1. Die Summen verwenden vorzeichenbehaftete Samples, keine Beträge oder Energien. `level` ist unverändert die gewählte FB-ALL-Skalierung. Der hörbare `FILTERBANK SUM` bleibt `Σ audibleGain_i·y_i`. Im ZDF-Core ist ein aktiviertes FB ALL immer Teil des unified MAIN-Busses; die alte `FB ALL ENGINE = LEGACY`-Alternative bleibt für CURRENT und Snapshots erhalten, erzeugt in ZDF aber keinen separaten verzögerten Legacy-Return. Für den fairen A/B-Hörtest daher `FB ALL ENGINE = COMMON BUS` wählen.

Mit `r` als geglätteter bipolarer Resonance und `K_L = sign(r)·1.25·r²` wird gelöst:

```text
F(R) = R - S_L(K_L·L(R)) - S_M(K_M·M(R)) = 0
K_M = sign(r)·1.25·mainCurve(|r|)
```

Bei `MAIN RESONANCE CURVE = CURRENT` ist `mainCurve(|r|)=r²`; die bestehende Soft-Knee-Option bleibt optional. `S_L` und `S_M` sind die bisherigen tanh-Saturationen der jeweiligen Busse. Für `COMMON BUS / CONSTANT CEILING` gilt `S(t)=ceiling·tanh(drive·t/ceiling)`. `LOCAL LOOP EXP` behält lokal `tanh(t)`; MAIN kann weiterhin seine vorhandene Saturation bzw. `DRIVE 4 / RETURN 0.2` verwenden. Die beiden Returns teilen einen aktuellen Filterinput, werden aber separat saturiert. `R[n-1]` dient nur als Solver-Initialwert, nicht als verzögertes Feedbacksignal.

Der Solver nutzt höchstens sechs geklammerte Newton-Schritte mit analytischer Ableitung, Fehlergrenze `1e-8`, und bei schwieriger Ableitung/Konvergenz höchstens 20 Bisektionsschritte innerhalb der durch beide Saturations-Ceilings begrenzten Return-Spanne. Nicht-finite Zustände werden auf einen sicheren Null-Return zurückgesetzt. Kein Fallback auf `CURRENT`, keine per-Sample-Arrays oder Closures. Positive und negative Resonance laufen durch denselben Solver; nur das Loop-Gain-Vorzeichen wechselt. `RESONANCE = 0` ergibt `R = 0`.

## Offline-Messung: LOCAL-only, Resonance 1

Kurzer Sinus-Burst am jeweiligen Bandzentrum, anschließend Null-Input. Frequenz aus interpolierten positiven Nulldurchgängen im letzten 30-%-Tail; ein Tail zählt als gehalten, wenn `RMS_late > 0,005` und mindestens 50 % des frühen RMS erreicht. Angegebene Thresholds sind grobe Rasterwerte aus `0,7…1,0`; kein exakter Bifurkationspunkt. Die Messung verwendet `COMMON BUS`, LOCAL des jeweiligen Bands ON, MAIN OFF, `FILTERBANK SUM`.

| Band | Soll Hz | CURRENT 44,1k | ZDF 44,1k | CURRENT 48k | ZDF 48k | ZDF 96k | Threshold CURRENT 48k | Threshold ZDF 48k |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 29 | 28,91 | 28,95 | 28,91 | 28,95 | 28,95 | 0,900 | 0,900 |
| 2 | 61 | 60,74 | 60,92 | 60,75 | 60,92 | 60,92 | 0,900 | 0,900 |
| 3 | 115 | 114,26 | 114,86 | 114,31 | 114,86 | 114,86 | 0,900 | 0,900 |
| 4 | 218 | 215,59 | 217,74 | 215,76 | 217,74 | 217,74 | 0,900 | 0,900 |
| 5 | 411 | 402,97 | 410,51 | 403,57 | 410,51 | 410,51 | 0,900 | 0,900 |
| 6 | 777 | 749,14 | 776,03 | 751,22 | 776,03 | 776,02 | 0,900 | 0,900 |
| 7 | 1500 | 1404,37 | 1498,28 | 1411,39 | 1498,27 | 1498,22 | 0,925 | 0,900 |
| 8 | 2800 | 2497,02 | 2797,30 | 2518,48 | 2797,23 | 2796,91 | 0,925 | 0,900 |
| 9 | 5200 | 4160,52 | 5196,30 | 4227,31 | 5195,70 | 5193,14 | 0,975 | 0,900 |
| 10 | 11000 | kein Sustain | 11025,00 | kein Sustain | 11030,91 | 10990,60 | keines ≤1 | 0,900 |

Bei 96 kHz erreicht CURRENT Band 10 etwa 8754,75 Hz und einen gemessenen Threshold von 1,0; bei 44,1/48 kHz hält es im Test nicht. Band 9 braucht in CURRENT bei 44,1 kHz 1,0, bei 96 kHz 0,925. ZDF lag für alle zehn Bänder bei allen drei Raten im Messraster bei 0,900. Ohne Anregung bleibt der exakt digitale Nullzustand erwartungsgemäß null; es wurde kein Noise-Seed ergänzt.

Alle 30 ZDF-LOCAL-Survey-Renders waren endlich und gehalten; die Frequenzabweichung blieb deutlich unter der 6-%-Testgrenze. Im Normalfall wurden durchschnittlich etwa 2–4 Newton-Schritte benötigt, maximal 5 (Band 10/44,1 kHz), ohne Fallback oder Non-finite-Reset. Der größte Residualwert in der normalen Survey blieb bei etwa `1e-8`.

Peak, RMS, Attack und Tail werden im Testreport je Render mitgemessen. Bei 48 kHz beispielsweise: Band 8 CURRENT/ZDF Tail-RMS `0,732/0,878`, Peak `1,064/1,258`; Band 9 `0,420/0,831`, Peak `0,618/1,197`; Band 10 CURRENT ohne gehaltenen Tail, ZDF Tail-RMS `0,759`, Peak `1,190`. Die Attack-Metrik ist das erste 10-ms-RMS-Fenster oberhalb 50 % des maximalen Fenster-RMS; sie liegt für die oberen Bänder in beiden Cores im ersten Fenster. Gehaltene Tails reichen bis zum Ende des 0,5-s-Renders (rund 470 ms nach dem Burst); ihre tatsächliche Maximaldauer wurde damit **nicht** bestimmt.

## Weitere Szenarien und Grenzen

Bei 48 kHz, einem 777-Hz-Burst und `MAIN LEVEL = 1/√10`: ZDF LOCAL-only Tail-RMS `0,858`; MAIN-only klingt im Null-Input-Tail rechnerisch ab (`3,6e-9`), MAIN RAW hält `1,327` (CURRENT `1,313`). LOCAL+MAIN hält `2,229` (CURRENT `2,137`), drei LOCAL-Bänder + MAIN `2,256` (CURRENT `2,314`). Die Zahlen zeigen, dass beide Busse gleichzeitig wirken, aber sie sind **kein Hörurteil** über Biss, Körper, Dichte, Intermodulation oder Mode Capture. Diese Eigenschaften benötigen einen direkten Hörvergleich mit identischen Sweetspots und Pegelbeobachtung.

Negative LOCAL-, MAIN- und Dual-Resonance sowie Resonance 0 blieben endlich; negative Tails klangen in diesem Burst-Test ab. Stereo-Isolation: rechter Ausgang blieb bei ausschließlich linkem Input exakt 0. PANIC löschte den nachfolgenden Tail exakt auf 0. Ein offener einzelner POST-GAIN-Tap sank bei 0/−6/−12/−24 dB monoton (`0,0200 / 0,0100 / 0,00502 / 0,00126` Peak). `LOCAL LOOP EXP / ZDF` lieferte mit `CURRENT` und `COMPENSATED` Tuning exakt identische Samples; im ZDF-Core gelten nominelle Frequenzen. Ein gesonderter laufender Offline-Worklet-Test schaltete per Live-Message zwischen zwei Anregungen CURRENT → ZDF, ohne Worklet-Neuaufbau; die gemessene Frequenz wechselte entsprechend von der verzögerten Band-9-Region in die nominelle 5,2-kHz-Region.

Der bewusst extreme Test (zehn LOCAL-Bänder, MAIN RAW, +24 dB, Drive 16, Ceiling 4) blieb endlich, aber erreichte einen Wet-Peak von etwa **353,6**. Dabei wurden 42 Solver-Fallbacks, maximal sechs Newton-Schritte und ein schlechtester Residualwert von `9,53e-7` gemessen, jedoch kein Non-finite-Reset. Das ist keine pegelbegrenzte Produktionsfreigabe; beim Hörtest solche Extremkombinationen vorsichtig verwenden. Es wurde absichtlich keine zusätzliche Return-Absenkung oder Ausgangslimitierung eingeführt.

## Performance und Teststatus

Stereo-Dual-Bus, je 0,35 s offline gerendert, medianer Browser-Render-Zeitwert nach Warm-up (kein Echtzeit-CPU-Profil):

| Rate | CURRENT | ZDF |
| ---: | ---: | ---: |
| 44,1 kHz | 29,8 ms | 37,6 ms |
| 48 kHz | 30,3 ms | 41,8 ms |
| 96 kHz | 52,9 ms | 67,6 ms |

ZDF kostet in diesem Szenario grob 25–40 % mehr Offline-Renderzeit. Im aktiven AudioWorklet fallen keine dynamischen per-Sample-Datenstrukturen im neuen Solver an. Der Performance-Vergleich ist hardware- und browserabhängig; eine reale Audio-Thread-Underrun-Messung ist offen.

Die fokussierten ZDF- und Sweetspot-Tests waren grün. Der komplette Playwright-Lauf ergab **70 bestanden / 12 fehlgeschlagen** (82 Tests zum Zeitpunkt des Laufs); der danach ergänzte isolierte Live-Worklet-Switch-Test bestand ebenfalls. Alle neuen ZDF-Tests waren grün. Ein anschließender [Baseline-/Regressionsvergleich](zdf-baseline-regression.md) hat **alle zwölf Fehlschläge auf dem unmittelbaren vor-ZDF-Stand reproduziert** und CURRENT in 13 Signalkonfigurationen bitweise mit diesem Stand verglichen: keine Sample-Abweichung. Die Gesamtsuite ist dennoch ausdrücklich **nicht grün**; die vorbestehende Testschuld wurde nicht umgeschrieben. Es erfolgte kein Commit, Merge oder Deployment.
