# Patch Plan Template

> Copy this template and fill it in **before editing any code** (ADR-530 Patch Scope Guard).
> Stay inside the declared `Allowed Files`. If more than 3 domains are touched, split the ADR.
> Detailed rules → `docs/ai/09-refactor-rules.md` · validation by type → `docs/ai/08-testing-checklist.md`.

## ADR
ADR-XXX:

## Target Domain
-

## Intent
-

## Current Problem
-

## Allowed Files
-

## Forbidden Files
-

## Expected Behavior Change
-

## Non-Behavioral Change
-

## SourceSnapshot Impact
- NONE / READ_ONLY / FIELD_MAPPING / SEMANTIC_CHANGE

## Execution Impact
- NONE / LIVE_BLOCK_POLICY / ORDER_PATH / POSITION_MANAGEMENT

## Shadow Learning Impact
- NONE / RECORD_ONLY / LIFECYCLE / COUNTERFACTUAL / VIRTUAL_FILL

## Telegram Impact
- NONE / DISPLAY_ONLY / COMMAND_ROUTE / DEDUP / CHANNEL_POLICY

## Provider Impact
- NONE / KIS / KRX / DART / YAHOO / CACHE / FALLBACK

## Learning Impact
- NONE / LearningLabel / CaseRecording / OutcomeClassification

## Risk Level
- LOW / MEDIUM / HIGH

## Tests Required
-

## Rollback Plan
-

## Split Required?
- NO / YES
- Reason:

---

### Invariant pre-check (must all hold)
- [ ] Trading Engine stays alive (no new hard-block from auxiliary data).
- [ ] Shadow Learning never stops (shadowAllowed stays true under SELL_ONLY/R6/providerIssue).
- [ ] Every decision still starts from a single SourceSnapshot (no Gate-internal provider fetch).
- [ ] providerIssue is not converted into a bearish marketSignal.
- [ ] AI_ESTIMATED (L4) data is not used for live execution.
- [ ] LIVE trading body 0-line change + 1-line ENV rollback (when near the live path).
