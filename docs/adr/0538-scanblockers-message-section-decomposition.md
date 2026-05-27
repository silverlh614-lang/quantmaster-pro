# ADR-0538: scanBlockers Message Section Decomposition

@responsibility ADR-0538 records the behavior-preserving decomposition of formatScanBlockersMessage into section-builder helpers to clear GodFunctionGuard cc.

## Status

Accepted.

## Context

`formatScanBlockersMessage()` in
`server/trading/signalScanner/scanDiagnostics/scanBlockersFormatter.ts` is a
622-line display renderer with cyclomatic complexity **131** — far past the
GodFunctionGuard threshold (cc≤25). It assembles the `/scan_blockers` Telegram
message as a long sequence of `lines.push(...)` calls interleaved with section
conditionals (sector-energy quality emoji, R3 state, empty-scan reasons,
permission/regime display, supply availability, etc.).

It is **display-only** (executionImpact=NONE) — it renders an already-decided
`ScanSummary` and makes no trading/gate judgment. It has strong regression
coverage: 19 test files / 335 passing assertions exercise its output.

The host file `scanBlockersFormatter.ts` is also 1484 LoC (a registered ACMA
baseline file, near the 1500 limit), so in-file helper extraction would risk
pushing it over.

## Decision

Extract `formatScanBlockersMessage`'s display sections into pure section-builder
helpers in a **new sibling module**
`server/trading/signalScanner/scanDiagnostics/scanBlockersMessageSections.ts`
(`@responsibility scan_blockers 메시지 섹션 빌더 — display-only 순수 라인 생성`).

Each helper has the shape `buildXxxSection(input): string[]` — it receives the
already-derived display inputs and returns the lines it contributes. The branch
logic (ternary/if clusters) moves into the helpers, so `formatScanBlockersMessage`
becomes a thin orchestration that concatenates section outputs (cc ≤ 25). This
also reduces `scanBlockersFormatter.ts` line count.

## Consequences

- `formatScanBlockersMessage` cc 131 → ≤25; host file shrinks (relieves the
  baseline file).
- **Output byte-identical** — guaranteed by the 19 test files staying at the
  335-pass / 12-pre-existing-fail baseline (the 12 are unrelated buyListLoop
  static-grep guards + Gate1 calibration ranges).
- No judgment/gate logic changed; no provider/SourceSnapshot/execution impact.
  `executionImpact=NONE`, byte-equivalent behavior.

## Alternatives Considered

- **In-file helpers**: rejected — `scanBlockersFormatter.ts` is already 1484 LoC
  (baseline), adding helpers risks exceeding the 1500 file limit.
- **cc-counter tolerance**: not applicable — this function's cc is genuine
  section branching, not null-safety over-counting (already recalibrated in the
  prior cc fix).

## Migration Plan

1. Create `scanBlockersMessageSections.ts` with pure section builders.
2. Replace each inline section in `formatScanBlockersMessage` with a helper call.
3. Verify the 19 test files stay at 335 pass / 12 pre-existing fail (0 new),
   `lint` EXIT=0, `validate:all` EXIT=0, and the function reports GodFunctionGuard OK.
