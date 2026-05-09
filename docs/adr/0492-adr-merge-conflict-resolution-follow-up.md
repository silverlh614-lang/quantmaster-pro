# ADR-0492: ADR Merge Conflict Resolution Follow-up

Status: Accepted
Date: 2026-05-09
Scope: governance
Execution impact: NONE
Live execution allowed: false
Operator approval required: true

## Context

ADR-0489, ADR-0490, and ADR-0491 are already reserved as ADR-numbering merge-conflict resolution governance records on the current mainline history.

A later diagnostic-feature preparation branch attempted to reuse ADR-0490, ADR-0491, and ADR-0492 for ProgramTrading, Supply Snapshot Store/Replay, and Fresh Data Scheduler work. That would delete or overwrite the already-issued governance ADR files and recreate the same merge-conflict pattern that ADR-0491 was meant to stop.

At the time of this ADR:

- the current branch has no active Git merge state (`MERGE_HEAD` is absent);
- `git ls-files -u` reports zero unmerged index entries;
- a repository conflict-marker scan excluding `node_modules` and Git internals reports no checked-in `<<<<<<<`, `=======`, or `>>>>>>>` markers;
- ADR-0490 remains `adr-merge-conflict-resolution-follow-up`;
- ADR-0491 remains `adr-merge-conflict-resolution-continuation`;
- no ProgramTrading, Supply Snapshot, Fresh Data Scheduler, provider, Telegram runtime, Gate, Kelly, KIS order, or live execution behavior is changed by this governance ADR.

Because ADR numbers are externally referenced and must not be renumbered after merge, ADR-0492 is reserved as a follow-up merge-conflict resolution record. New feature ADRs must start from ADR-0493 or later.

## Decision

ADR-0492 resolves the repeated ADR-numbering merge-conflict path as a documentation/governance PR only.

This PR:

1. Restores the existing ADR-0490 and ADR-0491 governance files instead of deleting or overwriting them.
2. Removes the attempted ADR-0490/0491/0492 diagnostic-feature numbering from this branch.
3. Adds this ADR-0492 governance record to document the conflict-resolution outcome.
4. Advances `docs/adr/INDEX.md` next issue number from `0492` to `0493`.
5. Records the resolution in `CLAUDE.md` change history.

## Guardrails

This ADR is governance-only:

- `executionImpact=NONE`.
- `liveExecutionAllowed=false`.
- `operatorApprovalRequired=true`.
- No live execution changes.
- No KIS order imports or order path changes.
- No Gate thresholds, Gate weights, Kelly sizing, live buy policy, or `requiredScore` changes.
- No STRONG_BUY or SectorEnergy boost unlock.
- No provider fetch behavior changes.
- No Telegram runtime behavior changes.
- No raw provider payload persistence.
- Engine liveness and Shadow Learning remain unchanged.

## Consequences

ADR-0490/0491 governance history remains intact and merge-safe. ADR-0492 is now also reserved for conflict-resolution governance, so the next feature ADR must use ADR-0493 or later and must update `docs/adr/INDEX.md` and `CLAUDE.md` together.
