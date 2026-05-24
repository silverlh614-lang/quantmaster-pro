# Patch Report Template

> Copy this template and fill it in **after the patch** (ADR-530 Patch Scope Guard).
> Report honestly: list every changed file, state test failures and skips, do not hide scope creep.
> Each PR also appends one summary line to `docs/ai/10-patch-history-index.md` (## 색인).

## ADR
ADR-XXX:

## Summary
-

## Changed Files
-

## Domains Touched
-

## Behavior Changed?
- NO / YES
- Details:

## SourceSnapshot Impact
-

## Execution Impact
-

## Shadow Learning Impact
-

## Telegram Impact
-

## Provider Impact
-

## Tests Run
-

## Results
-

## Remaining Risks
-

## Follow-up ADRs
-

## Rollback Notes
-

---

### Scope conformance (confirm before merge)
- [ ] Only files inside the Patch Plan's `Allowed Files` were changed.
- [ ] No unrelated domain was touched (≤3 domains; otherwise the ADR was split).
- [ ] If documentation-only: no source code was modified.
- [ ] If warning-cleanup: no runtime semantics changed (unless explicitly declared).
- [ ] ADR-0146 PR self-review (5 categories) passed → `docs/ai/08-testing-checklist.md`.
