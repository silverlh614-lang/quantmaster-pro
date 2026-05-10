# ADR Numbering Operations — Patch / Hotfix Policy

@responsibility ADR 번호 운영 메모 — gap 재사용 금지, PATCH 규칙, 진단 ADR 중단 원칙.

## Purpose

This document is an operations note for ADR numbering hygiene. It does not issue a new ADR number and does not change `docs/adr/INDEX.md` next-number state.

Current source of truth remains:

- `docs/adr/INDEX.md`
- Current next ADR: `0502`
- Latest numbered diagnostic chain: ADR-0501 Weekend Replay

## PATCH / Hotfix Rule

When a change fixes or clarifies an already-issued ADR without introducing a new architectural decision, use:

```text
PATCH-<existing ADR number>
```

Examples:

- `PATCH-0491 Supply Snapshot domain accuracy hotfix`
- Future examples: `PATCH-0454 ...`, `PATCH-0501 ...`

PATCH changes must not advance the next ADR number and must not create a new `docs/adr/NNNN-*.md` file.

Allowed PATCH scopes:

1. Incorrect diagnostic display fix.
2. Incorrect classification fix.
3. Dead wiring / silent degradation repair.
4. Duplicate PR or merge-state cleanup.
5. Raw payload exposure prevention.
6. Invalid data hard reject.
7. Existing test reinforcement.
8. Existing output compression or de-duplication.
9. Existing SSOT consolidation without new semantics.
10. Live guardrail reinforcement.

Disallowed PATCH scopes:

1. New diagnostic dashboard.
2. New taxonomy.
3. New compact `/scan_blockers` line.
4. New diagnostic-only module.
5. New replay layer.
6. New dry-run matrix.
7. New status enum.
8. New data promotion stage.
9. New live Gate / Kelly / KIS / order behavior.
10. Any change requiring a new architectural decision.

If a change needs one of the disallowed scopes, it is not a PATCH. It requires explicit operator approval and, if diagnostics are involved, must justify why ADR-0501 diagnostic freeze is insufficient.

## Gap / Missing Number Rule

Missing ADR numbers are historical trace artifacts. They must not be reused.

If a number appears missing, do not backfill it. Record the history only. Reusing a missing number breaks git-history traceability and external references.

Operational interpretation:

- A visible gap is not an available number.
- A closed / superseded PR does not make its number reusable.
- A PATCH never consumes a new ADR number.
- The only next numbered ADR is the value in `docs/adr/INDEX.md`.

## Sensitive Numbering Ranges

### 0445–0452

This range previously had collision risk from concurrent sessions. It must be treated as historical and immutable. Do not renumber, reuse, or backfill any apparent gap in this range.

### 0489–0492

This range mixed merge-conflict governance and Fresh Data Supply implementation work. The final mainline state is authoritative. Duplicate / superseded PRs were closed, including the ADR-0491 duplicate branches after PATCH-0491.

Operational note:

- ADR-0491 implementation is on `main`.
- PATCH-0491 fixed Supply Snapshot domain accuracy.
- Duplicate open PRs for ADR-0491/0492 were closed as superseded.
- Do not reopen or reuse numbers in this range to “clean up” history.

### 0500–0501

ADR-0500 and ADR-0501 close the empty-scan diagnostic chain:

- ADR-0500: Empty Scan Root Cause Dashboard
- ADR-0501: Weekend Replay using GateFailureCause

After ADR-0501, new diagnostic-only ADRs are paused.

## Diagnostic Freeze After ADR-0501

New diagnostic-only ADRs are paused after ADR-0501.

Allowed after the freeze:

1. PATCH to fix an existing diagnostic bug.
2. Runtime observation using existing ADR-0501 Weekend Replay output.
3. Promotion / demotion policy based on observed evidence.
4. Output compression / de-duplication of existing diagnostics.
5. Refactoring that reduces complexity without adding new diagnostic semantics.

Not allowed without explicit operator approval:

1. More diagnostic-only ADRs.
2. More `/scan_blockers` compact sections.
3. More diagnostic enum families.
4. More root-cause dashboards.
5. More replay layers.
6. More dry-run calibration matrices.

## Review Checklist For Numbering Patches

Before merging a numbering or PATCH PR:

- [ ] No new `docs/adr/NNNN-*.md` file unless intentionally issuing the next ADR from `INDEX.md`.
- [ ] `docs/adr/INDEX.md` next number is unchanged for PATCH PRs.
- [ ] Duplicate / superseded PRs are closed or explicitly referenced.
- [ ] `npm run validate:adrIndex` passes.
- [ ] `git diff --check` passes.
- [ ] Live trading, Gate, Kelly, KIS, order path, scheduler, and data promotion semantics are unchanged unless the PR is not a PATCH.

## Current Decision

As of PATCH-0491 cleanup:

```text
Next numbered ADR: 0502
Diagnostics: paused after ADR-0501
Hotfix style: PATCH-<existing ADR number>
Gap handling: record only, never reuse
0489–0492: closed as historical mixed merge/implementation range
```
