# ADR-0589: summaryBuilder and marketDataRefresh cyclomatic complexity reduction

@responsibility refactor — summaryBuilder and marketDataRefresh cyclomatic complexity reduction

## Status

Accepted

## Context

`GodFunctionGuard` (warn-only) 가 두 god 함수의 cyclomatic complexity 를 플래그하고 있었다:
`buildGate1MinimumSignalForensicSummaryAdr0505()` (summaryBuilder.ts, cc=177) — ~40개 누적 변수를
6개 루프로 순회하는 집계 함수; `refreshMarketRegimeVars()` (marketDataRefresh.ts, cc=150) — KOSPI/VKOSPI/
USD-KRW/SPX/DXY/FSS/program/short-selling/margin/FRED/MHS/sector-energy 등 다수 지표 섹션을 한 함수에서 순차 처리.
둘 다 파일은 1,500줄 이하라 파일한계 위반은 아니나, 분기 폭증으로 테스트·회귀 추적이 어려운 고-cc 부채.

## Decision

**byte-equivalent helper 추출**로 cc 를 분산한다 (판단·누적 산술·실행 순서·build 인자 전부 보존):

- summaryBuilder: tally 루프를 `tallyKeys()` 1개로 통합, 최대 분기 루프 본문을 신규 leaf 모듈
  `gate1MinimumSignalForensic/summaryAccumulators.ts` 의 `accumulateFailedAudit()`(+6 서브함수)·`accumulateAllAudit()`
  으로 추출. 누적 상태는 단일 mutable `SummaryAccumulatorState` 로 묶어 참조 전달(scalar 누적은 state 프로퍼티로 보존).
  분포 초기화 블록은 `buildDominantFailureDistribution()` 등 module-local 헬퍼로 분리.
- marketDataRefresh: 각 지표 섹션을 `refreshKospiSection()`/`refreshVkospiSection()`/`refreshUsdKrwSection()` 등
  동일-파일 헬퍼로 추출(`computed` 객체 참조 전달). 정적 grep-guard 텍스트 보존을 위해 신규 헬퍼는 same-file 유지.

## Consequences

- `buildGate1...Adr0505` cc **177 → 17**, `refreshMarketRegimeVars` cc **150 → ≤25**. 신규 추출 헬퍼 전부 cc≤25.
  `refreshMarketRegimeVars` 는 GodFunctionGuard warn 리스트에서 완전 제거. `buildGate1...` 는 cc 해소됐으나
  ~150-field 평탄 return 객체 리터럴(cc=17, 분기 0)로 lines=610 잔존 → line-count 기준 warn 만 남음(양성, 비차단).
- byte-equivalent: lint EXIT=0(client+server). summaryBuilder 회귀 124/124(무회귀), marketDataRefresh 회귀
  53 passed/7 failed = **clean 트리(origin/main)와 동일** 검증(stash 대조) → 신규 회귀 0건. 7 failed 는 사전 실패
  (VKOSPI KRX 네트워크 1 + FSS MISSING 타임아웃 1 + ADR-0138 정적 grep 가드 5).
- executionImpact=NONE(신규 KIS/KRX/Yahoo outbound 0건). 9대 불변식 무영향. 파일: marketDataRefresh.ts 1,360→1,494,
  summaryBuilder.ts 918→858, summaryAccumulators.ts 439(신규) — 전부 1,500 이하.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
