# ADR-0497: Diagnostic Taxonomy & Gate Failure Attribution SSOT

Date: 2026-05-09
Status: Accepted

## Context

ADR-0487 through ADR-0496 created Fresh Data, Supply, SectorEnergy, Promotion Audit, Snapshot, and Investor Flow diagnostic layers. Those ADRs are intentionally safe and preserve live execution behavior, but they repeatedly define the same concepts across documents and code:

- diagnostic-only policy (`executionImpact=NONE`, `liveExecutionAllowed=false`)
- data confidence and data-line status labels
- provider health labels
- provider issue vs market signal separation
- `null` vs zero vs missing vs stale semantics
- promotion readiness labels
- Gate failure attribution causes
- Fresh Data status display contracts

Without a taxonomy SSOT, future ADRs may create duplicate enums, inconsistent labels, or conflicting interpretations of provider failures. In particular, the repeated invariants are that raw provider payload persistence is forbidden, `UNKNOWN` remains `UNKNOWN`, `null` is not zero, provider issue is not bearish, stale/missing/partial data is diagnostic evidence only, and Gate/Kelly/KIS/order/live paths remain unchanged.

## Decision

Add shared diagnostic taxonomy types and pure helper functions in `server/diagnostics/diagnosticTaxonomyAdr0497.ts`.

ADR-0497 defines canonical meanings for:

1. `DiagnosticOnlyPolicyAdr0497`
2. `DataConfidenceAdr0497`
3. `ProviderHealthStatusAdr0497`
4. `MarketSignalDirectionAdr0497`
5. `DataValueStateAdr0497`
6. `PromotionReadinessStatusAdr0497`
7. `GateFailureCauseAdr0497`
8. `FreshDataStatusViewModelAdr0497`
9. `GateFailureAttributionEntryAdr0497`

The implementation is classification-only and diagnostic-only. It provides pure helpers for provider/market-signal separation, data-value normalization, Fresh Data status view-model construction, Gate failure attribution entry construction, and compact Telegram-safe formatting. Existing ADR behavior remains unchanged.

## Guardrails

ADR-0497 must preserve these invariants:

- `executionImpact` remains `NONE` for taxonomy and Fresh Data status view models.
- `liveExecutionAllowed` remains `false`.
- No KIS order path import or invocation.
- No Gate threshold, condition weight, Kelly, `requiredScore`, `STRONG_BUY`, `sectorBoost`, `supplyBoost`, or order path change.
- No automatic data-line stage mutation.
- No raw provider payload persistence.
- Provider issue is not market signal.
- `UNKNOWN` remains `UNKNOWN`.
- `null` is never converted to zero.
- Provider failures such as `DOWN`, `DELAYED`, `RATE_LIMITED`, `PARSE_ERROR`, `EMPTY`, `STALE`, and `UNKNOWN` never become bearish market signals.
- The module must not persist anything and must not call live modules.

## Consequences

Future ADRs must reuse this taxonomy instead of defining local duplicate enums for provider health, confidence, market signal, null/zero/missing semantics, promotion readiness, and Gate failure causes.

ADR-0498 and later ADRs can wire these types into Fresh Data status views, replay, and dashboards. That future wiring must be separate from ADR-0497 so this ADR remains taxonomy-only and does not alter scan behavior, Gate decisions, promotion decisions, scheduler behavior, snapshot persistence behavior, investor-flow behavior, sector-energy behavior, KIS order paths, or live execution eligibility.

## Validation

ADR-0497 is validated by unit tests that prove:

- `DIAGNOSTIC_ONLY_POLICY_ADR0497` is frozen and has no live effect.
- Provider issues are separated from market signals.
- `null`, zero, missing, stale, provider error, and parse error are distinct states.
- Fresh Data status view models force market signal to `UNKNOWN` when provider health is not `UP`.
- Gate failure attribution entries default safely and do not persist anything.
- The taxonomy module does not import KIS/order/live modules, mutate Gate/Kelly thresholds, or write files.
