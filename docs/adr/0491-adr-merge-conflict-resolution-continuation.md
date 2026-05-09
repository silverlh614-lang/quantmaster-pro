# ADR-0491: ADR Merge Conflict Resolution Continuation

Status: Accepted  
Date: 2026-05-09  
Scope: governance  
Execution impact: NONE  
Live execution allowed: false  
Operator approval required: true

## Context

ADR-0489 and ADR-0490 reserved the prior ADR-numbering merge-conflict resolution records and advanced `docs/adr/INDEX.md` so the next available ADR number became `0491`.

The operator requested the ADR-0491 merge-conflict path to be resolved. At the time of this ADR:

- the current branch has no active Git merge state (`MERGE_HEAD` is absent);
- `git ls-files -u` reports zero unmerged index entries;
- a repository conflict-marker scan excluding `node_modules` reports no checked-in `<<<<<<<`, `=======`, or `>>>>>>>` markers;
- ADR-0490 remains the single issued ADR-0490 file, and `docs/adr/INDEX.md` points new work at ADR-0491.

Because ADR numbers are externally referenced and must not be renumbered after merge, ADR-0491 is reserved explicitly as the continuation merge-conflict resolution record. The next issue number advances to `0492` to prevent repeated contention on ADR-0491.

## Decision

ADR-0491 resolves the ADR-numbering merge-conflict continuation as a documentation/governance PR only.

This PR:

1. Adds `docs/adr/0491-adr-merge-conflict-resolution-continuation.md` as the single ADR-0491 file.
2. Advances `docs/adr/INDEX.md` next issue number from `0491` to `0492`.
3. Adds ADR-0491 to the full ADR index table.
4. Records the ADR-0491 change in `CLAUDE.md`.
5. Leaves trading runtime behavior unchanged.

## Guardrails

Future merge-conflict resolution involving ADR-0491 or later ADRs must preserve these rules:

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

ADR-0491 is governance-only.

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

## Merge button follow-up

ADR-0491 follow-up PRs can use the manual GitHub Actions workflow `.github/workflows/adr-0491-merge-button.yml` as the merge button. The workflow validates the ADR-0491 file, `docs/adr/INDEX.md`, unmerged-index state, conflict markers, and `node scripts/check_adr_index.js`; when manually dispatched with the PR number, it requests GitHub auto-merge into `main` after required checks pass.

Railway runtime completion still requires the deployment target to pick up the merged `main` commit. If Railway tracks `main`, treat runtime completion as confirmed only after Railway creates a post-merge deployment and its logs show the expected commit SHA.

## Consequences

ADR-0491 becomes the explicit continuation record for the ADR-numbering merge-conflict path. Subsequent ADR work must use `0492` from `docs/adr/INDEX.md` and must not reopen ADR-0491 numbering.
