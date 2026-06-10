# ADR-0596: minimumSignalScoreTrace component-scorer and report decomposition

@responsibility refactor — minimumSignalScoreTrace.ts 점수 컴포넌트 계산·trace 경로 해석·집계 리포트를 minimumSignalScoreTrace/ 하위로 이동, 본체는 trace 조립만 잔류 (byte-equivalent)

## Status

Accepted

## Context

`server/trading/signalScanner/minimumSignalScoreTrace.ts` 는 현재 **1,499~1,500줄**로 절대 규칙 #6 의
1,500줄 ACMA 한계에 **1줄 차로 재도달**했다. [[ADR-0524]](types 12종 + scoring leaf 추출, 1736→1411) 이후
ADR-0467(advisory 컴포넌트 2종)·ADR-0505(forensic 진단)·ADR-0594(reversal momentum credit wiring) 등
Gate1 점수 진단 확장이 본체에 누적되어 다시 차올랐다. 모듈 책임은 ADR-0466 "Minimum Signal Score
Decomposition diagnostics" — **counterfactual/advisory-only**, 임계 완화·주문 라우팅·매매 상태 변경 없음.

현재 본체에는 세 가지 성격의 코드가 섞여 있다:

1. **trace 필드 해석 유틸** (~178줄): `numericTraceValue`/`resolveNumericTracePath`/`tracePathExists`/
   `breakoutSignalState`/`isBreakoutFired` 등 — CandidateEntryTrace 중첩 경로 탐색 순수 함수.
2. **점수 컴포넌트 계산** (~415줄): `priceMomentumScore`(PRICE_MOMENTUM)·`breakoutScore`
   (BREAKOUT_STRUCTURE)·`volumeLiquidityScore`(VOLUME_LIQUIDITY)·`technicalTrendScore`(TECHNICAL_TREND)·
   `normalizedRelativeStrength`(RELATIVE_STRENGTH) — 컴포넌트 코드별 normalized/weighted/confidence 산출.
3. **trace 조립 + 집계/포매팅** (~840줄): `buildMinimumSignalScoreTrace`(17개 컴포넌트 조립 + 합산 +
   would-pass counterfactual), `buildUnknownDataTreatmentAudit`, `buildSoftFailAccumulationTrace`,
   `buildRiskPenaltyTrace`, `buildMinSignalScoreDecompositionReport`, `buildSignalScoreCalibrationResults`.

ADR-0524 의 잔여 leaf(scoring.ts 추출분)는 소진됐으므로, 이번에는 1·2(계산층)와 집계 리포트(스캔 단위
요약·calibration 시나리오)를 하위 모듈로 *순수 이동*한다. 컴포넌트 코드·가중치·페널티·confidence 정책은
1글자도 바꾸지 않는다 (불변식 #6: UNKNOWN/provider 장애의 bearish 변환 금지 메시지 포함 byte 보존).

## Decision

ADR-0524 가 만든 `minimumSignalScoreTrace/` 디렉토리에 신규 3모듈을 추가한다. 본체는 trace/audit/
softFail/riskPenalty **조립 함수 4종**만 보유하고, 계산·해석·집계 리포트는 하위 모듈을 소비한다.

```
server/trading/signalScanner/
├── minimumSignalScoreTrace.ts                # 본체 — component() + buildMinimumSignalScoreTrace + buildUnknownDataTreatmentAudit
│                                             #   + softFailCodeForCondition/buildSoftFailAccumulationTrace + buildRiskPenaltyTrace
│                                             #   + public re-export. 예상 ~690줄
└── minimumSignalScoreTrace/
    ├── types.ts                              # (기존, ADR-0524) ADR-0466 진단 타입 계약 SSOT
    ├── scoring.ts                            # (기존, ADR-0524) 정규화 + RS 순수 계산
    ├── traceFieldResolver.ts                 # 신규 ~205줄 — numericTraceValue·nestedNumericTraceValue·tracePathExists·
    │                                         #   resolveNumericTracePath·stringArrayTraceValue·positiveReasonProxy
    │                                         #   + BREAKOUT_SOURCE_KEYS·breakoutSignalState·isBreakoutFired·isBreakoutUnavailable·breakoutProjectionBreakPoint
    ├── componentScorers.ts                   # 신규 ~455줄 — normalizedRelativeStrength·volumeLiquidityScore·breakoutScore·
    │                                         #   priceMomentumScore(ADR-0594 reversal credit wiring 포함)·technicalTrendScore
    └── decompositionReport.ts                # 신규 ~265줄 — average·buildMinSignalScoreDecompositionReport·buildSignalScoreCalibrationResults
```

신규 파일 `@responsibility` 초안 (25단어 이내, 상단 20줄 내):

| 파일 | @responsibility 초안 |
|------|----------------------|
| `traceFieldResolver.ts` | `CandidateEntryTrace 중첩 경로 수치/문자열 해석과 breakout 신호 상태 판독 순수 유틸 (advisory-only)` |
| `componentScorers.ts` | `Gate1 신호점수 컴포넌트(PRICE_MOMENTUM/BREAKOUT/VOLUME/TECH_TREND/RS) 계산 순수 함수 — 가중치·페널티 정책 무변경 (advisory-only)` |
| `decompositionReport.ts` | `Gate1 최소신호점수 분해 집계 리포트와 calibration 시나리오 산출 (advisory-only, executionImpact NONE)` |

설계 근거:

- **단방향 의존**: `traceFieldResolver` ← `componentScorers` ← 본체, `decompositionReport` ← 본체 소비자.
  하위 모듈은 `types.ts`/`scoring.ts`/`entryFilterDecomposition`(타입)/`gatePositiveFeatureMaterializer`/
  `reversalMomentumCredit` 만 import — 본체 역참조 0건 (순환 import 차단).
- **조립층 본체 잔류**: `buildMinimumSignalScoreTrace` 는 `loadTradingSettings`/`resolveWatchlistUpstreamScore`
  소비 + requiredScore 결정(`input.trace.minSignalRequiredScore` 우선) 지점 — ADR-0480 가드 단언
  (`operatorActionRouterAdr0480.test.ts:180`)이 본체 텍스트를 검사하므로 본체 잔류가 가드 무수정 경로.
- **ADR-0594 wiring 동반 이동**: `priceMomentumScore` 의 `buildPriceMomentumReversalApplier` import 는
  `componentScorers.ts` 로 함께 이동 — flag default OFF byte-equivalent 그대로.

## Consequences

- `minimumSignalScoreTrace.ts` 1,500 → **~690줄** (한계 대비 ~810줄 여유). 신규 3모듈 전부 1,500줄 한계 내.
  executionImpact=**NONE** — advisory-only 진단층 순수 이동, 런타임 byte-equivalent.
- **외부 importer 경로 변경 0건** (10+개 소비처: entryFilterDecomposition/* 7파일·gate1ScoringAlignmentAdr0472·
  gate1ForensicInputsCollectorAdr0507·gate1PositiveScoreStarvation 등). 본체 public 표면 보존:
  - `export * from './minimumSignalScoreTrace/types.js'` (기존 유지)
  - `export { normalizeSignalScoreTo100, scoreRelativeStrength } from './minimumSignalScoreTrace/scoring.js'` (기존 유지)
  - 신규: `export { buildMinSignalScoreDecompositionReport, buildSignalScoreCalibrationResults } from './minimumSignalScoreTrace/decompositionReport.js'`
  - `buildMinimumSignalScoreTrace`/`buildUnknownDataTreatmentAudit`/`buildSoftFailAccumulationTrace`/`buildRiskPenaltyTrace` 는 본체 정의 그대로.
- **가드 테스트 영향 — 갱신 0건, 검증 의무 4건**:

  | 가드 테스트 | 검사 방식 | 영향 |
  |---|---|---|
  | `operatorActionRouterAdr0480.test.ts` (L34/L180) | 정적 grep — `const requiredScore = input.trace.minSignalRequiredScore` | **무영향** (해당 줄은 본체 잔류 `buildMinimumSignalScoreTrace` 내부) — 이동 후 green 재확인 의무 |
  | `minimumSignalScoreDecompositionAdr0466.test.ts` | 런타임 import (`buildMinimumSignalScoreTrace`·`buildUnknownDataTreatmentAudit`·`normalizeSignalScoreTo100`) | **무영향** (re-export 보존) |
  | `gate1ReversalMomentumCreditWiringAdr0594.test.ts` | 런타임 import (`buildMinimumSignalScoreTrace`) | **무영향** — priceMomentumScore 이동 후 reversal credit 적용 결과 동일 재확인 |
  | `gate1ScoringAlignmentAdr0472` / `gate1MinimumSignalForensicAdr0505` / `scanBlockersGateCompactAdr0507` 등 | 런타임 import 또는 타 파일 grep | **무영향** |

  단, `buildMinimumSignalScoreTrace` 가 이동된 scorer 들을 named import 하는 줄이 추가되므로, 향후
  본체 텍스트 가드를 추가할 때는 ADR-0444 concat 패턴(본체 + `minimumSignalScoreTrace/*.ts`)을 권장.
- 9대 불변식: #2 Shadow 무접촉(진단층은 counterfactual 산출만, 학습 파이프 0줄), #6 보존 — `INVESTOR_FLOW`/
  `SUPPLY_CONFLUENCE` 의 "provider issue, not market bearishness" 메시지·페널티 분기 byte 그대로 이동 없음
  (본체 잔류), #7 보존 — confidence 강등 정책 무변경, #9 — scorer 는 trace 입력만 읽고 provider 직접 조회 0
  (이동 후에도 fetch/axios import 0건, ADR-0505 정적 가드 패턴과 정합).
- 회귀 기준: `lint` EXIT=0 · `validate:complexity` OK · `validate:responsibility` OK ·
  `npx vitest run server/trading/signalScanner` 스위트 green (ADR-0533 baseline 선존 실패 제외) · `precommit` 통과.

## Alternatives Considered

1. **`buildMinimumSignalScoreTrace`(464줄) 자체 분할 (컴포넌트 17개를 빌더 배열로 재구성)** — 기각.
   컴포넌트 순서·합산·would-pass 계산이 진단 계약의 본체라 재구성은 behavior risk. ADR-0524 도
   "대형 함수 내부 분해는 별도 patch" 로 명시 이연한 부분 — 순수 이동 원칙과 충돌.
2. **scoring.ts 에 scorer 들을 합치기** — 기각. scoring.ts 는 "정규화 leaf"(trace 무의존 순수 수식) 계약.
   scorer 는 CandidateEntryTrace 해석에 의존 — 섞으면 ADR-0524 의 leaf 경계가 무너진다.
3. **decompositionReport 를 scanDiagnostics 쪽으로 이동** — 기각. 리포트의 입력·출력 타입이 본 모듈
   types SSOT 에 귀속 — 디렉토리를 넘기면 importer 경로가 흔들리고 책임 귀속이 모호해진다.
4. **types 추가 추출로 줄 수만 확보** — 기각. ADR-0524 가 이미 타입 12종을 추출 — 잔여 인라인 타입은
   함수 반환 타입 리터럴이라 추출 시 가독성/계약 추적성이 떨어지고 확보 줄 수도 미미.

## Migration Plan

> 전 단계 공통: 기능 추가 0 · behavior change 0 · 호출 그래프 불변 (이동 + import 리라우트만).
> PR 1건 원자 머지. 롤백 = PR revert 1회.

1. **(a) 파일 분리** — `traceFieldResolver.ts` → `componentScorers.ts` → `decompositionReport.ts` 순으로
   생성(의존 방향 역순), `@responsibility` 태그 부여, 함수·상수를 텍스트 그대로 move.
2. **(b) 내부 호출 리라우트** — `componentScorers.ts` 가 `traceFieldResolver.js`·`scoring.js`·
   `reversalMomentumCredit.js`·`gatePositiveFeatureMaterializer.js` import. 본체는 scorer 5종 +
   `nestedNumericTraceValue`(advisory 컴포넌트 2종이 사용) named import. 하위 → 본체 역참조 0건 확인.
3. **(c) 원본 re-export 유지** — 기존 `export *`/scoring re-export 무변경 + decompositionReport 2함수
   re-export 추가. 외부 importer 무수정. `npm run lint` EXIT=0 확인.
4. **(d) 가드 테스트 갱신** — 갱신 0건이 설계 목표. 검증 단계로
   `npx vitest run server/trading/signalScanner/operatorActionRouterAdr0480.test.ts
   server/trading/signalScanner/minimumSignalScoreDecompositionAdr0466.test.ts
   server/trading/signalScanner/gate1ReversalMomentumCreditWiringAdr0594.test.ts` green 의무.
   ADR-0480 L180 단언이 깨지면 (= requiredScore 줄이 이동됐다는 뜻) **이동 범위 오류** — scorer 만
   이동했는지 재검토 (단언 수정으로 우회 금지).
5. **검증** — `npm run validate:responsibility` · `npm run validate:complexity` ·
   `npx vitest run server/trading/signalScanner` · `node scripts/check_adr_index_baseline.js` 전부
   EXIT=0 → `precommit` → `docs/ai/10-patch-history-index.md` 한 줄 추가.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.

## References

- ADR-0524 (types/scoring 추출), ADR-0466 (Minimum Signal Score Decomposition 진단 계약)
- ADR-0467 (advisory 컴포넌트), ADR-0594 (reversal momentum credit), ADR-0480 (operator action router 가드)
- ADR-0444 (static-grep-guard concat 패턴), `docs/ai/09-refactor-rules.md`, `scripts/check_complexity.js`
