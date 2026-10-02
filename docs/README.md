# Documentation index

Status describes the document's scope at the repository-cleanup baseline
(`56caa74`, 2026-10-02). Historical results are evidence, not implementation
instructions or a claim that the current complete suite is green.

| Status | Documents | Scope |
| --- | --- | --- |
| CURRENT | [architecture.md](architecture.md), [ui-conventions.md](ui-conventions.md) | Compact runtime map and existing UI conventions |
| CURRENT | [clock-mod-v1.md](clock-mod-v1.md), [modulation-core.md](modulation-core.md), [dynamic-eq-v2.md](dynamic-eq-v2.md) | Current feature/state contracts; modulation document predates the four Envelope sources and Clock Mod, see architecture map |
| CURRENT | [dev-control-contract.md](dev-control-contract.md), [dsp-gain-staging.md](dsp-gain-staging.md) | DEV/output contracts; baseline notes in the documents remain dated evidence |
| CURRENT | [input-character-tube-dc-rate.md](input-character-tube-dc-rate.md) | Implemented sample-rate correction and its measurements |
| CURRENT | [BACKLOG.md](BACKLOG.md) | Product backlog, not authorization for implementation; some entries explicitly need status review |
| CURRENT | [repository-cleanup.md](repository-cleanup.md), [../tests/README.md](../tests/README.md), [../tests/QUARANTINE.md](../tests/QUARANTINE.md) | Cleanup findings, profiles and baseline register |
| LEGACY | [dynamic-eq-v1.md](dynamic-eq-v1.md), [typography-audit.md](typography-audit.md) | Earlier feature/design baseline; preserve compatibility evidence |
| LEGACY | [FREEZE_BASELINE_PRE_UI_REFACTOR.md](FREEZE_BASELINE_PRE_UI_REFACTOR.md), [zdf-baseline-regression.md](zdf-baseline-regression.md) | Frozen DSP comparisons and historical test status |
| LEGACY | [input-character-audit.md](input-character-audit.md) | Production audit snapshot; later TUBE correction is documented separately |
| LEGACY | [PROTOTYPE_0.1_SPEC.md](PROTOTYPE_0.1_SPEC.md), `PROTOTYPE_0.1_SPEC.png` | Original specification and visual reference |
| EXPERIMENTAL | [unified-signed-zdf-common-bus.md](unified-signed-zdf-common-bus.md) | DEV A/B experiment and historical evaluation |
| EXPERIMENTAL | [input-character-oversampling-prototype.md](input-character-oversampling-prototype.md), [input-character-production-architecture.md](input-character-production-architecture.md), [input-character-adaptive-oversampling.md](input-character-adaptive-oversampling.md), [input-character-transition-performance.md](input-character-transition-performance.md) | Test-only oversampling/transition controllers; not the deployed input preamp |
| EXPERIMENTAL | `projektboard.excalidraw` | Planning/design artifact; retained |
| OBSOLETE CANDIDATE | `_schmierzettel` | Empty scratch document; no deletion without a separate decision |

Historical INPUT CHARACTER report links still resolve to the tracked reference
fixtures. For new generated measurements and their locations see the test README.
