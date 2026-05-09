# ADR-0489: ADR Merge Conflict Resolution Guard

Date: 2026-05-09

## Status

Accepted

## Context

The repository is continuing the ADR-0487/0488 Fresh Data Supply Layer sequence. The next available ADR number was `0489`, and the operator requested the ADR-0489 merge-conflict path to be resolved before opening the PR.

The current branch had no active Git merge state and no checked-in conflict markers at the time of this ADR. The ADR index validator also reported the expected baseline: ADR files and the index were consistent, with known historical collision groups preserved and `0489` as the next issue number.

Because ADR numbers are externally referenced and cannot be renumbered after merge, the safest conflict resolution is to reserve ADR-0489 explicitly, advance the ADR index to `0490`, and document the guardrails that future conflict resolution must preserve.

## Decision

ADR-0489 resolves the ADR-numbering merge-conflict risk as a documentation/governance PR only.

This PR:

1. Adds `docs/adr/0489-adr-merge-conflict-resolution-guard.md` as the single ADR-0489 file.
2. Advances `docs/adr/INDEX.md` next issue number from `0489` to `0490`.
3. Adds ADR-0489 to the full ADR index table.
4. Records the change in `CLAUDE.md` change history.
5. Leaves all runtime trading, data provider, Telegram, KIS, Gate, Kelly, sizing, score, and order execution behavior unchanged.

## Conflict Resolution Policy

Future merge-conflict resolution involving ADR-0489 or later ADRs must preserve these rules:

- Never reuse an already-issued ADR number.
- Never renumber a merged ADR file to make a branch apply cleanly.
- Resolve duplicate new ADR attempts by assigning the losing branch the current `INDEX.md` next issue number.
- Update the ADR body, `docs/adr/INDEX.md`, and `CLAUDE.md` together.
- Run the ADR index validator after the conflict is resolved.
- Keep known historical collision groups as historical facts; do not rewrite them while resolving a new conflict.

## Guardrails

ADR-0489 is governance-only.

It does not:

- Change live execution.
- Change KIS order paths or external provider calls.
- Change Gate thresholds, Gate weights, Kelly sizing, `requiredScore`, live buy policy, sell policy, or portfolio sizing.
- Promote any SHADOW_ONLY/OBSERVE data to ADVISORY, WEIGHTED, GATED, or CORE.
- Change SectorEnergy, supply, investor-flow, or scan diagnostics runtime logic.
- Persist raw provider payloads or sensitive account data.
- Add environment variables or dependencies.

All runtime impact remains:

- `executionImpact='NONE'`
- `liveExecutionAllowed=false`
- `operatorApprovalRequired=true`

## Verification

The conflict-resolution PR must verify:

- `git status` has no unresolved merge entries.
- The repository contains no `<<<<<<<`, `=======`, or `>>>>>>>` conflict markers outside Git internals and vendored dependencies.
- `node scripts/check_adr_index.js` exits successfully.

## Consequences

ADR-0489 becomes the explicit merge-conflict resolution guard for the ADR sequence. Subsequent ADR work must use `0490` from `docs/adr/INDEX.md` and must not reopen ADR-0489 numbering.
