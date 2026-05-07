# ADR-0421: Enforce Semantic Availability for Investor-Flow Inputs

## Status
Accepted — 2026-05-07

## Context
ADR-0416/0417/0418 시리즈로 DATA_UNAVAILABLE 의미론, postmortem action taxonomy,
registry evaluator.inputs 기반 data availability context 자동화가 적용되었다.
ADR-0419 로 R3 Sanity Streak 가 SELL_ONLY / VolumeClock closed / R6 / VIX / FOMC /
data-starved 시점에 오탐 누적되지 않도록 수정되었다. ADR-0420 으로 GATE1_PASS_ZERO
fresh blocker attribution 이 도입되었다.

그러나 운영 관찰 시 `/supply_health` 의 *기관/외인 수급* 축이 다음 상태로 표시된다:

```
route: KRX > NAVER > CACHE
source: POLICY_ROUTER
status: NEUTRAL          ← 결함: success=0/missing=10 인데 NEUTRAL 표시
success: 0/10
missing: 10/10
providerTried:
  - KRX_INVESTOR_FLOW: ERROR
  - NAVER_INVESTOR_TREND: NOT_WIRED
  - CACHE: CACHE_EMPTY
  - KIS_API: PROVIDER_MISMATCH
판정: KRX/NAVER/CACHE 미연결 — KIS는 진단용, 점수 제외
```

이 상태는 *중립* 이 아니라 **평가 불가** (DATA_UNAVAILABLE) 또는 **저품질/퇴화**
(DEGRADED) 다. 운영자는 status=NEUTRAL 을 보고 "수급이 중립" 으로 오해할 수 있다.

핵심 결함:
`Boolean(ctx.kisFlow)` 또는 객체 존재 여부만으로는 investor-flow 데이터 가용성을
판단할 수 없다. 객체가 있어도 `foreignNetBuy` / `institutionalNetBuy` 같은 실제
scoring 에 필요한 *semantic field* 가 없으면 `hadRequiredData=true` 로 판정해서는
안 된다.

## Decision

### 1. Investor-Flow Semantic Availability SSOT 신설
`server/supply/investorFlowSemanticAvailability.ts`:

**타입**:
- `InvestorFlowSemanticStatus` 10값 union (OK / DATA_UNAVAILABLE / DEGRADED /
  PROVIDER_MISMATCH / KRX_ERROR / NAVER_NOT_WIRED / CACHE_EMPTY /
  KIS_DIAGNOSTIC_ONLY / FIELD_MISSING / UNKNOWN)
- `InvestorFlowSemanticAvailability` 결과 (available / status / reason /
  missingFields / provider? / providerTried?)

**SSOT 상수**:
- `INVESTOR_FLOW_REQUIRED_FIELDS = ['foreignNetBuy', 'institutionalNetBuy']`
- `INVESTOR_FLOW_FIELD_ALIASES` — 다른 provider 가 다른 이름 쓸 때 fallback
  매핑 (예: `foreignerNetBuy` / `institutionNetBuy` / `foreignNetAmount`)

**핵심 함수**:
- `evaluateInvestorFlowSemanticAvailability(input)` — 결정 트리 5 분기:
  1. null/undefined → DATA_UNAVAILABLE
  2. non-object → UNKNOWN
  3. 둘 다 부재 → FIELD_MISSING
  4. 일부만 부재 → DEGRADED + missingFields
  5. 둘 다 number-like → OK
- `hasNumberLikeField(input, candidates)` — `Number.isFinite` 검증 (NaN/Infinity → false, 0 은 유효).
- `classifyInvestorFlowMarker(input)` — supply_health marker 분류 SSOT (NEUTRAL 폐기).
- `describeInvestorFlowMarker(marker)` — 운영자 가이드 문구 SSOT.

### 2. registry.isExternalDataAvailable kisFlow override
`server/quant/conditions/registry.ts:135` 의 `isExternalDataAvailable` 함수에서
`key === 'kisFlow'` 시 `evaluateInvestorFlowSemanticAvailability(value).available`
위임. 객체 truthy 만으로 available 판정 차단 (사용자 명시 핵심 불변식 #1).

### 3. supplyConfluenceEvaluator wiring
`server/quant/conditions/evaluators.ts:658`:
- 기존 `if (!kisFlow) return DATA_UNAVAILABLE` 분기를
  `evaluateInvestorFlowSemanticAvailability(kisFlow)` 위임으로 격상.
- semantic.available=false 시 score=0 + status='DATA_UNAVAILABLE' + detail 에
  `Investor flow unavailable: ${semantic.status} — ${semantic.reason}` 노출.
- ADR-0416 핵심 불변식 보존 — DATA_UNAVAILABLE 은 failed 가 아님.

### 4. /supply_health marker NEUTRAL 폐기 (success=0+missing>0 영역)
`server/telegram/commands/system/supplyHealth.cmd.ts:145`:
- 인라인 `success === 0 ? 'NEUTRAL' : ...` 분기를
  `classifyInvestorFlowMarker(input)` SSOT 위임으로 격상.
- `Marker` union 에 `'DATA_UNAVAILABLE'` 추가 (NEUTRAL 은 호환성 보존).
- `markerIcon('DATA_UNAVAILABLE')` 🔴 (MISSING 과 시각적 동등).
- `riskReason` 에 DATA_UNAVAILABLE 분기 명시 추가.
- `renderInvestorFlowDecision` SSOT 위임 (`describeInvestorFlowMarker`).

### 5. SourceHealth.status union 확장
`server/learning/supplyHealthLearning.ts:33`:
- `status` union 에 `'DATA_UNAVAILABLE'` 추가 (후방호환).
- `sourceHealthFromChannel` 에 DATA_UNAVAILABLE → DATA_UNAVAILABLE 분기 추가.

### 6. Status 용어 정리 (사용자 §G 정합)
- **NEUTRAL**: real investor-flow data 존재 + direction weak 시점에만 사용.
- **DATA_UNAVAILABLE**: 평가 가능한 수급 데이터 자체가 없음.
- **DEGRADED**: 일부 데이터는 있으나 source coverage / semantic field 불완전.

NEUTRAL 은 본 SSOT 가 *반환하지 않음* — 호출자가 명시적으로 사용해야 함.

## Consequences

### 운영 효과
- 운영자가 `/supply_health` 로 *기관/외인 수급* 상태를 정확히 인지:
  - success=0+missing>0 → 🔴 DATA_UNAVAILABLE (이전엔 ⚪ NEUTRAL).
  - reason 라인에 "scoring-eligible investor flow semantic fields unavailable" 명시.
- 잘못된 *수급 중립* 오해 영구 차단.
- 후속 PR (KRX HTTP400 복구 / NAVER collector wiring / CACHE warm-up) 의 효과를
  직접 측정 가능 (DATA_UNAVAILABLE → OK 전환).

### 안전 invariant 8종 (사용자 명시 핵심 불변식)
1. Investor flow 객체가 존재해도 scoring 에 필요한 의미 필드가 없으면 available 아님.
2. success 0/10 + missing 10/10 은 NEUTRAL 이 아님.
3. PROVIDER_MISMATCH / NOT_WIRED / CACHE_EMPTY / KRX_ERROR 명시 노출.
4. DATA_UNAVAILABLE 은 failed 가 아님 (ADR-0416 정합).
5. 매매 정책 변경 0 — semantic availability 진단 PR.
6. NEUTRAL 은 본 SSOT 가 반환하지 않음 (호출자 영역).
7. 외부 의존성 0 (KIS/Yahoo/외부 API 호출 0건).
8. KIS diagnostic-only 정책 보존 (scoring source 승격 금지).

### LIVE 매매 본체 0줄 변경
- `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` /
  `orchestrator/**` / `autoTradeEngine*` 모두 0 LoC.
- supplyConfluenceEvaluator 본체는 *분류 layer* 만 변경 (semantic checker 위임) —
  scoring 산식·임계 0 변경.

### 잘못된 해결 방법 영구 차단 8종
1. `Boolean(kisFlow)` 단순 검사 — semantic field 검증 의무 위반.
2. NAVER collector 신규 구현 (사용자 명시 후속 PR scope).
3. KRX HTTP400 복구 로직 대개편 (사용자 명시 후속 PR scope).
4. KIS diagnostic-only 정책을 scoring source 로 승격.
5. supply_confluence weight 변경 (사용자 명시 절대 금지).
6. STRONG_BUY 조건 변경 (사용자 명시 절대 금지).
7. last 7 days gate_audit 카운터 reset.
8. ADR-0419 / ADR-0420 로직 재수정.

### ENV 우회
신규 ENV 0종. 회귀 발견 시 supplyConfluenceEvaluator 가 DATA_UNAVAILABLE 로 분류
되어 ADR-0420 fresh attribution 이 자동 unavailable 카운트 → 운영자 즉시 인지.

## Test Plan
회귀 테스트 39 케이스 신규 (`investorFlowSemanticAvailabilityAdr0421.test.ts`):
- 사용자 §I 명시 7 케이스 (null / 객체+필드부재 / OK / supplyConfluence DATA_UNAVAILABLE /
  registry override / supply_health success=0 / NEUTRAL 미반환).
- 결정 트리 9 분기 (null / undefined / non-object / 빈 객체 / 일부만 부재 / NaN /
  Infinity / 0 유효 / alias / source propagate).
- hasNumberLikeField 안전 가드 5 분기.
- classifyInvestorFlowMarker 7 분기 (total=0 / success=0+missing>0 / partial /
  zeroSuspicious / staleCacheCount / 정상 / 우선순위 충돌).
- supplyConfluenceEvaluator wiring 4 분기 (semantic unavailable / 양쪽 양수 /
  양쪽 0 음수 / kisFlow null).
- 안전 invariant 정적 grep 가드 6 (describe SSOT / SSOT 상수 / registry.ts
  override / evaluators.ts wiring / supply_health classifyInvestorFlowMarker).

## References
- ADR-0416 — DATA_UNAVAILABLE 의미론 wiring (Phase 1).
- ADR-0417 — Postmortem Action Taxonomy.
- ADR-0418 — Evaluator Data Availability Metadata Automation (registry.run).
- ADR-0419 — R3 Sanity Streak Excludes SELL_ONLY / VolumeClock.
- ADR-0420 — Fresh Scan Blocker Attribution.
- ADR-0388 — `inferStatusFromLegacyResult` SSOT.
- ADR-0146 — PR 자가 review 5 카테고리.

## Out of Scope (후속 PR)
- KRX HTTP400 원인 분리 + 복구 로직 (별도 PR).
- NAVER investor trend collector wiring (별도 PR).
- CACHE warm-up 경로 (별도 PR).
- KIS diagnostic-only 정책 재검토 (별도 PR).
- Gate1 precise stage tagging (ADR-0420 후속).
