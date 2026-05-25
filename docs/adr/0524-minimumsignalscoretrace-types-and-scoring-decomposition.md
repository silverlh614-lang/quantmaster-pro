# ADR-0524: minimumSignalScoreTrace types and scoring decomposition

@responsibility refactor — minimumSignalScoreTrace types and scoring decomposition

## Status

Accepted

## Context

`server/trading/signalScanner/minimumSignalScoreTrace.ts` (1736 LoC) 는 절대 규칙 #6 (1500줄) 위반으로
ADR-0133 BASELINE_TECHNICAL_DEBT 카탈로그에 등재된 잔여 파일 중 하나다. `@responsibility`:
"ADR-0466 Minimum Signal Score Decomposition diagnostics" — Gate1 점수 분해 진단(advisory-only).
인라인 타입 12종 + 점수 정규화/상대강도(RS) 스코어링 함수가 대형 누적.

## Decision

타입/인터페이스 12종을 `minimumSignalScoreTrace/types.ts` 로, 점수 정규화 + RS 스코어링 leaf 클러스터
(`round1`/`round2`/`finite`/`toFiniteNumber`/`clamp` + `normalizeSignalScoreTo100` +
`scoreRelativeStrength` 등, `build*` 미호출)를 `minimumSignalScoreTrace/scoring.ts` 로 추출.
본체는 named import + `export * from './minimumSignalScoreTrace/types.js'` +
`export { normalizeSignalScoreTo100, scoreRelativeStrength } from './minimumSignalScoreTrace/scoring.js'`
로 public API byte-equivalent 재export. `build*` 진단 함수는 본체 잔류 (one-directional).

```
server/trading/signalScanner/
├── minimumSignalScoreTrace.ts        # build* 진단 함수 본체 (types·scoring 소비)
└── minimumSignalScoreTrace/
    ├── types.ts                      # ADR-0466 진단 타입 계약 SSOT
    └── scoring.ts                    # 신호점수 정규화 + RS 순수 계산 (advisory-only)
```

## Consequences

- 1736 → **1411 LoC** (types 198 + scoring 163 추출) → ADR-0133 BASELINE 카탈로그에서 정식 제거 → 재초과 시 즉시 fail.
- 외부 importer 경로 변경 0건 (이전 export 20개 byte-identical 보존). 런타임 byte-equivalent, advisory-only, executionImpact=NONE.
- 회귀: lint EXIT=0 · complexity EXIT=0 · responsibility 0 · 관련 스위트 155 pass / 1 fail.
  유일 실패(`WATCHLIST_UPSTREAM_SCORE` normalize)는 `git stash` 로 **원본(1736줄)에서 동일 재현 확인된 사전 실패**
  (`resolveWatchlistUpstreamScore` 가중치 기인, 본 분해 무관·무회귀 — ADR-0533 baseline).
- 후속: 대형 함수(`scoreRelativeStrength`·`buildMinimumSignalScoreTrace`) 내부 분해는 별도 patch (본 ADR 범위 밖).

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
