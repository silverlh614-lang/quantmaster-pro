# ADR-0420: Decompose GATE1_PASS_ZERO with Fresh Scan Blocker Attribution

## Status
Accepted — 2026-05-07

## Context
ADR-0416/0417/0418 시리즈로 DATA_UNAVAILABLE 의미론, postmortem action taxonomy,
registry evaluator.inputs 기반 data availability context 자동화가 적용되었다.
ADR-0419 로 SELL_ONLY / VolumeClock closed / R6 / VIX / FOMC / data-starved 시점의
R3 SHADOW_ONLY streak 오탐 누적도 차단되었다.

그러나 운영 로그에서 다음 패턴이 반복된다:
```
candidates=49 entries=0
gate1Pass=0 gate2Pass=0 gate3Pass=0 lastTriggerPass=0
```

운영자는 "후보 49개가 *왜* Gate1 에서 전부 탈락했는지" 알 수 없다. `GATE1_PASS_ZERO`
는 너무 뭉뚱그린 사유다. Gate 완화 여부를 판단하기 전에 fresh scan 기준으로
조건별 failed / unavailable / error / passed 분포를 분해해야 한다. 또한 last 7 days
누적 audit (`/gate_audit`) 은 패치 전 데이터가 섞여 있어 직전 스캔 진단에 부적합.

## Decision

### 1. Fresh Scan Blocker Attribution SSOT 신설
`server/trading/signalScanner/freshScanBlockerAttribution.ts`:
- `ConditionBlockerBucket` 타입 — 조건별 passed/failed/unavailable/error/skipped/total + 3 rate.
- `FreshScanBlockerAttribution` 타입 — 단일 스캔 snapshot (candidates/entries/gate*Pass + buckets + topX + diagnosis).
- `FreshScanDiagnosis` 6값 union — TRUE_GATE1_REJECTION / DATA_UNAVAILABLE_DOMINANT / EVALUATOR_ERROR_DOMINANT / MIXED / NO_CANDIDATES / UNKNOWN.
- `FRESH_DIAGNOSIS_THRESHOLDS` 상수 SSOT — 0.5 / 0.3 / 0.7.

### 2. status 분류 SSOT 재사용 (중복 구현 금지)
- `inferStatusFromLegacyResult` (gateAuditRepo.ts, ADR-0388) 위임.
- `accumulateFreshAttribution` 헬퍼가 단일 후보 outputs 를 conditionKey 별 bucket 에 가산.
- 분류 매트릭스 (사용자 §C 정합):
  - FIRED → passed++
  - THRESHOLD_NOT_MET → failed++
  - DATA_UNAVAILABLE / PROVIDER_DEGRADED → unavailable++
  - SKIPPED_BY_POLICY / SANITY_REJECTED → skipped++
  - ERROR → error++
  - output null + context.hadRequiredData=false → unavailable++
  - output null + 그 외 → failed++ (legacy fallback)

### 3. 결정 트리 (사용자 §H 정합, 절대 변경 금지 임계)
1. `candidates === 0` → NO_CANDIDATES
2. `totalRelevant (failed+unavailable+error) === 0` → UNKNOWN
3. `unavailable / totalRelevant > 0.5` → DATA_UNAVAILABLE_DOMINANT
4. `error / totalRelevant > 0.3` → EVALUATOR_ERROR_DOMINANT
5. `failed / totalRelevant > 0.7` → TRUE_GATE1_REJECTION
6. 그 외 → MIXED

### 4. ScanCounters 누적기 + ScanSummary 영속
- `ScanCounters.freshConditionBuckets: Map<string, ConditionBlockerBucket>` 신규 필드.
- `accumulateFreshConditionOutputs(counters, outputs)` 헬퍼 export.
- `persistScanResults` 에서 `buildFreshScanBlockerAttribution` 호출 후
  `ScanSummary.freshConditionAttribution?` 옵셔널 필드에 영속 (후방호환).

### 5. buyListLoop wiring
`buyListLoop.ts` 의 단일 `evaluateServerGate` 호출 site (라인 ~1017) 직후에
`accumulateFreshConditionOutputs(ctx.scanCounters, reCheckGate.outputs)` 추가.
try/catch 격리 — fresh attribution 실패 시 매수 흐름 차단 안 함.

### 6. /scan_blockers 메시지 강화
`formatFreshAttributionSection(attribution)` SSOT 헬퍼:
- `gate1Pass=0 + candidates>0` 시점에만 노출 (잡음 차단).
- candidates / gate1Pass + Top blockers (failed/unavailable/error 분리) +
  topFailedCondition / topUnavailableCondition / topErrorCondition + diagnosis +
  운영자 가이드 메시지.
- last 7 days 누적 audit 와 분리 명시 (사용자 명시 핵심 불변식 #4).

### 7. /gate_audit 7d 안내 추가
`formatGateAuditMessage` 끝에 안내 문구 추가:
> *이 화면은 최근 7일 누적입니다. 배포 전 audit 도 포함될 수 있으므로,
> 직전 스캔 원인은 `/scan_blockers` fresh 를 우선 확인하십시오.*

### 8. Gate1 stage tagging 한계 (사용자 §D 옵션 3)
서버 측에는 명시적 Gate1/Gate2/Gate3 condition-key 분류가 없다 (클라이언트만 보유 —
`CHECKLIST_TO_CONDITION_ID` + `GATE1_CONDITION_IDS` 등). 따라서 본 모듈은
*all outputs 기준 fresh condition attribution* 으로 명명. Gate1 precise stage
tagging 은 후속 PR scope (TODO).

## Consequences

### 운영 효과
- 운영자가 `/scan_blockers` 한 명령으로 GATE1_PASS_ZERO 의 *조건별 분해* 즉시 인지.
- DATA_UNAVAILABLE 우세 시 "데이터 소스 점검 우선" 가이드, evaluator error 우세 시
  "evaluator patch 우선" 가이드 → Gate threshold 완화 회귀 영구 차단.
- last 7 days `/gate_audit` 와 fresh `/scan_blockers` 분리 명시 → 패치 전 오염
  데이터 혼동 영구 차단.

### 안전 invariant 7종 (사용자 명시 핵심 불변식)
1. GATE1_PASS_ZERO 는 단일 원인이 아님 — 조건별 분해 의무.
2. DATA_UNAVAILABLE 은 failed 가 아님 — 별도 unavailable 카운터 (ADR-0416 정합).
3. unavailable/error 우세 시 Gate threshold 검토 권고 절대 금지.
4. fresh scan 과 last 7 days 누적 audit 분리.
5. 매매 정책 변경 0 — 진단 only.
6. 호출자 측 inline 결정 트리 0건 (SSOT 위임).
7. 외부 의존성 0 (gateAuditRepo + types 만 import).

### LIVE 매매 본체 0줄 변경
- `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` /
  `orchestrator/**` / `autoTradeEngine*` 모두 0 LoC.
- `buyListLoop.ts` 의 wiring 은 *진단 누적기 호출 1 블록* (try/catch 격리) — 의사결정/주문 로직 무관.

### 잘못된 해결 방법 영구 차단 7종
1. status 분류 중복 구현 — `inferStatusFromLegacyResult` SSOT 위반 (ADR-0388 정합).
2. DATA_UNAVAILABLE 을 failed 로 합산 — ADR-0416 핵심 불변식 위반.
3. fresh attribution 과 last 7 days audit 통합 — 사용자 명시 #4 위반.
4. Gate1 stage tagging 본 PR 통합 — 서버 측 condition-key 매핑 SSOT 부재, 회귀 위험.
5. recommendedDiagnosis 임계 ENV 화 — 운영 가이드만 결정, 매매 무관.
6. gate1Pass>0 정상 운영 시 fresh section 노출 — 잡음 차단 정책 위반.
7. 텔레그램 메시지 길이 제한 초과 (사용자 §L 권장) — Top 4 절삭 의무.

### ENV 우회
신규 ENV 0종. 회귀 발견 시 `ScanCounters.freshConditionBuckets.size === 0` 시
attribution 미생성 자연 fallback (graceful).

## Test Plan
회귀 테스트 34 케이스 신규 (`freshScanBlockerAttributionAdr0420.test.ts`):
- 사용자 §I 명시 6 케이스 (분리 / DATA_UNAVAILABLE / topX / unavailable 우세 /
  failed 우세 / formatter).
- §H 결정 트리 5 분기 (NO_CANDIDATES / UNKNOWN / EVALUATOR_ERROR_DOMINANT /
  MIXED / boundary 0.5).
- SSOT 임계 정합 + finalizeBucketRates 산식.
- accumulateFreshAttribution status 분류 7 분기.
- buildFreshScanBlockerAttribution 정렬 + topX undefined + 메타 propagate.
- formatFreshAttributionSection 표시 정책 (null / candidates=0 / gate1Pass>0 /
  정상 노출 / topN default).
- describeFreshDiagnosis 운영자 가이드 6 분기 (불변식 #5 정적 가드 — "Gate
  threshold 완화" 같은 위험 권고 영구 차단).

## References
- ADR-0388 — `inferStatusFromLegacyResult` SSOT (status 분류).
- ADR-0416 — DATA_UNAVAILABLE 의미론 wiring (failed 와 분리).
- ADR-0417 — postmortem action taxonomy (LOOSEN_GATE 폐기 + REVIEW_GATE_THRESHOLD).
- ADR-0418 — registry.run evaluator.inputs 기반 data availability context.
- ADR-0419 — R3 Sanity Streak excludes SELL_ONLY / VolumeClock closed.
- ADR-0146 — PR 자가 review 5 카테고리.

## Out of Scope (후속 PR)
- Gate1 precise stage tagging — 서버 측 condition-key 분류 SSOT 도입 후.
- `/gate_audit today` 또는 `/gate_audit since_deploy` 옵션.
- KRX/NAVER/CACHE 수급 라우터 복구.
- Investor-flow semantic availability — ADR-0421 후속 PR scope.
