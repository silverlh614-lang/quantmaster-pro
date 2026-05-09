# ADR-0490: ADR Merge Conflict Resolution Follow-up

Status: Accepted  
Date: 2026-05-09  
Scope: governance  
Execution impact: NONE  
Live execution allowed: false  
Operator approval required: true

## Context

ADR-0489 reserved the previous merge-conflict guard number, advanced the ADR index to `0490`, and recorded the rule that future ADR conflict-resolution work must update the ADR body, `docs/adr/INDEX.md`, and `CLAUDE.md` together.

The operator requested the ADR-0490 merge-conflict path to be handled and prepared for PR. At the time of this ADR:

- the current branch has no active Git merge state (`MERGE_HEAD` is absent);
- `git ls-files -u` reports zero unmerged index entries;
- a repository conflict-marker scan excluding `node_modules` reports no checked-in `<<<<<<<`, `=======`, or `>>>>>>>` markers;
- ADR-0489 remains the single issued ADR-0489 file, and `docs/adr/INDEX.md` points new work at ADR-0490.

Because ADR numbers are externally referenced and must not be renumbered after merge, ADR-0490 is reserved explicitly as the follow-up merge-conflict resolution record. The next issue number advances to `0491` to prevent repeated contention on ADR-0490.

## Decision

ADR-0490 resolves the ADR-numbering merge-conflict follow-up as a documentation/governance PR only.

This PR:

1. Adds `docs/adr/0490-adr-merge-conflict-resolution-follow-up.md` as the single ADR-0490 file.
2. Advances `docs/adr/INDEX.md` next issue number from `0490` to `0491`.
3. Adds ADR-0490 to the full ADR index table.
4. Records the ADR-0490 change in `CLAUDE.md`.
5. Leaves trading runtime behavior unchanged.

## Guardrails

Future merge-conflict resolution involving ADR-0490 or later ADRs must preserve these rules:

- Do not renumber already-issued ADR files.
- Do not reuse ADR numbers that have appeared in merged history.
- Update the ADR body, `docs/adr/INDEX.md`, and `CLAUDE.md` together.
- Run the ADR index validator after the conflict is resolved.
- Preserve known historical collision and gap accounting instead of rewriting history.

## Non-goals

This ADR does not:

- change Gate1/Gate2/Gate3 thresholds or scoring;
- change Kelly sizing, requiredScore, tranche sizing, or risk caps;
- change KIS, KRX, NAVER, Yahoo, Gemini, Telegram, scheduler, provider, cache, or order-execution logic;
- promote any SHADOW_ONLY/OBSERVE data path to ADVISORY or LIVE;
- add or remove runtime environment variables;
- alter stock universe, sector mapping, watchlist, shadow ledger, virtual-account, or real-order behavior.

## Safety invariants

ADR-0490 is governance-only.

- `executionImpact=NONE`
- `liveExecutionAllowed=false`
- `operatorApprovalRequired=true`
- Runtime code changes: `0`
- KIS order behavior changes: `0`
- Provider quota changes: `0`
- Gate/Kelly/requiredScore changes: `0`

## Validation

Required validation for this PR:

- no active `MERGE_HEAD`;
- `git ls-files -u` returns zero rows;
- conflict-marker scan excluding `node_modules` returns zero rows;
- `node scripts/check_adr_index.js` exits successfully.

## Consequences

ADR-0490 becomes the explicit follow-up record for the ADR-numbering merge-conflict path. Subsequent ADR work must use `0491` from `docs/adr/INDEX.md` and must not reopen ADR-0490 numbering.
