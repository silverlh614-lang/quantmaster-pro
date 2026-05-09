# ADR-0492 — ADR Merge Conflict Resolution Branch

Date: 2026-05-09
Status: Accepted
Domain: governance

## Context

The operator requested an ADR-0492 merge-conflict resolution PR on a new branch. The current repository state already has ADR-0491 reserved for `supply-snapshot-store-replay`, and `docs/adr/INDEX.md` advertises `0492` as the next available ADR number.

At the time of this ADR, the working branch was created from the current `work` branch as `adr-0492-merge-conflict-resolution`. No active Git merge state or unresolved index entries were present before the governance reservation. Because ADR numbers are externally referenced after merge, ADR-0492 must be reserved explicitly instead of renumbering ADR-0491 or rewriting historical ADR collision records.

## Decision

Reserve ADR-0492 as the merge-conflict resolution branch record and advance the next ADR issue number to `0493`.

This PR:

1. Adds `docs/adr/0492-adr-merge-conflict-resolution-branch.md` as the single ADR-0492 file.
2. Advances `docs/adr/INDEX.md` next issue number from `0492` to `0493`.
3. Adds ADR-0492 to the full ADR index table.
4. Records the change in `CLAUDE.md` change history.
5. Preserves all runtime trading, provider, Telegram, Gate, Kelly, KIS, score, sizing, portfolio, and order execution behavior unchanged.

## Conflict Resolution Policy

Future ADR merge-conflict resolution must keep these guardrails:

- Use only the current `docs/adr/INDEX.md` next issue number for new ADRs.
- Never reuse an already-issued ADR number.
- Never rename or renumber a merged ADR to make another branch apply cleanly.
- When two branches attempt the same ADR number, keep the already-merged ADR and move the later branch to the current next issue number.
- Update the ADR body, `docs/adr/INDEX.md`, and `CLAUDE.md` together.
- Run the ADR index validator after resolving the conflict.
- Preserve known historical collision groups as historical facts.

## Guardrails

ADR-0492 is governance-only.

It does not:

- Change live execution.
- Change KIS order paths or external provider calls.
- Change Gate thresholds, Gate weights, Kelly sizing, `requiredScore`, live buy policy, sell policy, or portfolio sizing.
- Promote any OBSERVE or SHADOW_ONLY diagnostic data to ADVISORY, WEIGHTED, GATED, or CORE.
- Change SectorEnergy, supply, investor-flow, ProgramTrading, snapshot replay, scan diagnostics, Telegram, or runtime pipeline logic.
- Persist raw provider payloads, tokens, account identifiers, or sensitive account data.
- Add environment variables or dependencies.

All runtime impact remains:

- `executionImpact='NONE'`
- `liveExecutionAllowed=false`
- `operatorApprovalRequired=true`

## Verification

The conflict-resolution PR must verify:

- `git status` has no unresolved merge entries.
- The repository contains no checked-in `<<<<<<<`, `=======`, or `>>>>>>>` conflict markers outside Git internals and vendored dependencies.
- `node scripts/check_adr_index.js` exits successfully.

## Consequences

ADR-0492 becomes the explicit governance record for this new-branch merge-conflict resolution. Subsequent ADR work must use `0493` from `docs/adr/INDEX.md` and must not reopen or renumber ADR-0491 or ADR-0492.
