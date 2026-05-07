# ADR-0422 — Gate2_PASS_ZERO and NO_LEADERSHIP Fresh Attribution

**Status:** Adopted (2026-05-07)
**Context:** PR-Gate2-Leadership-Attribution (PR #682)
**Related ADRs:** ADR-0420 (Fresh Scan Blocker Attribution), ADR-0421 (Investor-Flow Semantic Availability), ADR-0416~0418 (Evaluator Status Semantics 시리즈), ADR-0388 (`inferStatusFromLegacyResult` SSOT), ADR-0125/0127/0396 (sectorEnergy quality lifecycle).
**Boundary:** `server/trading/signalScanner/`

## Context

ADR-0420 가 GATE1_PASS_ZERO 단일 사유 결함을 fresh scan attribution 으로 차단했지만, *Gate1 통과 후 Gate2 에서 전부 탈락* 시나리오는 여전히 단일 사유 (`NO_LEADERSHIP`) 로 분류됐다. 운영 로그 사례:

```
candidates=50, gate1Pass=10, gate2Pass=0, gate3Pass=0, entries=0
sectorEnergy: STALE (validSectorCount=11/12, indexCode missing for sector A,
              symmetry validation failed)
```

이 시점 운영자는 *진짜 주도주 부재* 인지, *섹터 데이터 staleness* 인지, *DATA_UNAVAILABLE 누적* 인지, *evaluator error 누적* 인지, *pre-breakout WAIT 누적* 인지 분간 불가. 잘못된 진단 → 잘못된 운영 의사결정 (예: Gate2 임계 완화 → 데이터 결손 해소 후 STRONG_BUY 폭주 위험).

## Decision

**Gate1 생존자 기준** Gate2 탈락 사유를 조건별로 분해하는 fresh attribution SSOT 모듈 신규 도입. 매매 정책 변경 0 — 진단 only.

### 1. SSOT 모듈

`server/trading/signalScanner/gate2LeadershipAttribution.ts`:

- `Gate2BlockerBucket` — 조건별 카운터 (passed/failed/unavailable/error/skipped/**stale**/**wait**/total + 5 *Rate)
- `Gate2LeadershipDiagnosis` 9-value union (TRUE_NO_LEADERSHIP / SECTOR_DATA_STALE_DOMINANT / DATA_UNAVAILABLE_DOMINANT / EVALUATOR_ERROR_DOMINANT / PRE_BREAKOUT_WAIT_DOMINANT / GATE_RECHECK_DOMINANT / MIXED / NO_GATE1_SURVIVORS / UNKNOWN)
- `SectorEnergyDiagnostic` — sectorEnergy 진단 메타 (수정 금지 — ADR-0423 후속 PR scope)
- `Gate2BlockReasons` — 차단 사유 분해 (gateRecheckMiss / preBreakoutWait / sizingBlocked / driftRemove)
- `Gate2FreshAttribution` — 단일 스캔 snapshot
- `GATE2_DIAGNOSIS_THRESHOLDS` 임계 SSOT (절대 변경 금지)
- 헬퍼: `accumulateGate2Attribution` / `buildGate2FreshAttribution` / `computeGate2LeadershipDiagnosis` / `buildSectorEnergyDiagnostic` / `describeGate2Diagnosis` / `formatGate2AttributionSection` / `detailIndicatesStale` / `finalizeGate2BucketRates`

### 2. 분류 매트릭스 (사용자 §D 정합)

`accumulateGate2Attribution` 우선순위 결정 트리:

1. `waitMarker=true` → wait++ (호출자 명시 신호, output.status 와 별개)
2. `status === 'FIRED'` → passed++
3. `status === 'THRESHOLD_NOT_MET'` → failed++
4. `status === 'PROVIDER_DEGRADED'` + `detailIndicatesStale(detail)` → **stale++** (PROVIDER_DEGRADED 는 STALE 동등 — ADR-0388 정합)
5. `status === 'DATA_UNAVAILABLE'` → unavailable++
6. `status === 'PROVIDER_DEGRADED'` (non-STALE) → unavailable++
7. `status === 'SKIPPED_BY_POLICY' / 'SANITY_REJECTED'` → skipped++
8. `status === 'ERROR'` → error++
9. `output null + context.hadRequiredData=false` → unavailable++ (ADR-0418 정합)
10. `output null + 그 외` → failed++ (legacy fallback)

### 3. 진단 결정 트리 (사용자 §E 정합, 절대 변경 금지)

`computeGate2LeadershipDiagnosis` 우선순위:

1. `gate1Pass === 0` → **NO_GATE1_SURVIVORS** (Gate2 분해 무의미, ADR-0420 우선)
2. `totalRelevant === 0 + sectorEnergy.isStale` → **SECTOR_DATA_STALE_DOMINANT**
3. `totalRelevant === 0` → **UNKNOWN**
4. `stale / totalRelevant > 0.4` OR `sectorEnergy.isStale === true` → **SECTOR_DATA_STALE_DOMINANT**
5. `unavailable / totalRelevant > 0.5` → **DATA_UNAVAILABLE_DOMINANT**
6. `error / totalRelevant > 0.3` → **EVALUATOR_ERROR_DOMINANT**
7. `(preBreakoutWait / max(1, gate1Pass) > 0.5)` OR `(wait / totalRelevant > 0.5)` → **PRE_BREAKOUT_WAIT_DOMINANT**
8. `gateRecheckMiss / max(1, gate1Pass) > 0.5` → **GATE_RECHECK_DOMINANT**
9. `failed / totalRelevant > 0.7` → **TRUE_NO_LEADERSHIP**
10. 그 외 → **MIXED**

`totalRelevant = failed + unavailable + error + stale + wait` (passed 제외).

### 4. 호출자 wiring

`server/trading/signalScanner/perSymbol/buyListLoop.ts` 의 단일 `evaluateServerGate` 호출 site (라인 ~1020) 직후, ADR-0420 fresh attribution 다음 위치:

- Gate1 survivor 판정: `gateEvaluation.gate1Passed === true` OR `stock.gateScore >= 5.0` (ADR-0211 폴백 정합)
- Gate1 survivor 만 `accumulateGate2ConditionOutputs(ctx.scanCounters, ...)` 호출
- try/catch 격리 — Gate2 attribution 실패 시 매수 흐름 차단 안 함

`scanDiagnostics.ts` `persistScanResults` 가 `counters.gate1Pass > 0` 시점에만 build → `summary.freshGate2Attribution?` 영속.

`formatScanBlockersMessage` 가 ADR-0420 fresh section 다음에 ADR-0422 Gate2 section 자동 추가.

### 5. /scan_blockers 표시 정책 (사용자 §G 정합)

- `gate1Pass > 0` AND `gate2Pass === 0` 시점에만 노출 (정상 운영 시 미노출)
- Top 5 condition buckets (failed+unavailable+error+stale+wait 합 내림차순)
- topFailedCondition / topUnavailableCondition / topErrorCondition / topStaleCondition / topWaitCondition
- SectorEnergy 진단 (사용자 §F — *표시 only*, 수정 금지)
- blockReasons (Gate 재검증 미달 / Pre-breakout WAIT / Sizing BLOCKED / Drift REMOVE)
- recommendedDiagnosis + describeGate2Diagnosis 운영자 가이드
- 마지막 라인: *"fresh attribution 은 직전 스캔 snapshot 기준 — last 7 days 누적 audit 와 분리 (/gate_audit 는 누적, /scan_blockers 는 fresh)"* (사용자 §H 정합)

### 6. 운영자 가이드 메시지 SSOT

`describeGate2Diagnosis` — *매매 정책 변경 입력 절대 아님*:

| Diagnosis | Guidance |
|---|---|
| TRUE_NO_LEADERSHIP | Gate2 통과 0개. 시장 안정 + 진짜 주도주 부재. **매매 정책 변경 불필요** — 다음 사이클 자연 대기. |
| SECTOR_DATA_STALE_DOMINANT | sectorEnergy STALE 우세. **Gate2 완화 전 sector data 점검 우선** (ADR-0423 후속 PR scope). |
| DATA_UNAVAILABLE_DOMINANT | DATA_UNAVAILABLE 비중 높음. **Gate2 완화 전 데이터 소스 점검 우선** (KRX/NAVER/CACHE). |
| EVALUATOR_ERROR_DOMINANT | evaluator error 비중 높음. **evaluator patch 가 우선** — Gate2 임계 변경 부적합. |
| PRE_BREAKOUT_WAIT_DOMINANT | Pre-breakout WAIT 우세. 후보는 있으나 진입 트리거 미발동 — 다음 사이클 재시도. |
| GATE_RECHECK_DOMINANT | Gate 재검증 미달 우세. minGate 임계 또는 sectorBoost 검토 (ADR-0075/0125 정합). |
| MIXED | failed/unavailable/error/stale/wait 가 혼재. **단일 임계 변경 권고 부적합** — 운영자 종합 검토 필요. |
| NO_GATE1_SURVIVORS | Gate1 통과자 0 — Gate2 분해 무의미. /scan_blockers GATE1_PASS_ZERO 우선 확인 (ADR-0420). |
| UNKNOWN | Gate2 attribution 데이터 부족 — 다음 스캔 후 재검토. |

## Key Invariants (사용자 명시)

1. **Gate2_PASS_ZERO 는 단일 원인이 아니다** — 조건별 분해 의무.
2. **NO_LEADERSHIP 은 *진짜 주도주 부재* 와 *섹터/수급/성장 데이터 품질 문제* 를 구분**해야 한다.
3. **DATA_UNAVAILABLE 은 failed 가 아니다** (ADR-0416 정합).
4. **STALE 은 진짜 failed 와 분리**해 표시 (별도 stale 카운터).
5. **fresh scan attribution 과 last 7 days 누적 audit 분리.**
6. **매매 정책 변경 0** — 진단 only (Gate threshold / weight / STRONG_BUY 변경 본 PR scope 외).
7. **gate1Pass=0 시 Gate2 분해 무의미** — NO_GATE1_SURVIVORS 진단 + 섹션 미노출.

## Out of Scope (사용자 명시)

- Gate threshold 변경 / sector_alignment / momentum_quality / earnings_quality weight 변경 — 진단 only.
- STRONG_BUY confidence gate 변경 (ADR-0398/0415 보존).
- SELL_ONLY / VolumeClock / R6 / VIX / FOMC streak skip 정책 변경 (ADR-0419 보존).
- **sectorEnergy 수리** — *표시* 만, **ADR-0423 후속 PR scope**.
- ADR-0416/0417/0418 (Evaluator Status Semantics) 수정.
- ADR-0420 (fresh scan blocker attribution) 본체 변경.
- ADR-0421 (investor-flow semantic availability) 변경.
- 신규 ENV 도입 (회귀 발견 시 호출자 측 wiring 제거로 effective rollback).

## 잘못된 해결 방법 영구 차단

1. **Gate2 임계 완화** (사용자 명시 §H — fresh attribution 은 진단, 정책 변경 입력 아님).
2. **DATA_UNAVAILABLE 을 failed 합산** (ADR-0416 위반).
3. **STALE 을 unavailable 단일 카운터로 통합** (사용자 §D — 별도 stale 카운터 의무).
4. **호출자 측 inline status 분류** (drift 위험, `inferStatusFromLegacyResult` SSOT 의무).
5. **fresh 와 7d audit 통합** (사용자 §H — 분리 표시 의무).
6. **gate1Pass=0 시점 Gate2 섹션 노출** (NO_GATE1_SURVIVORS — ADR-0420 fresh attribution 우선).
7. **sectorEnergy 본체 수정** (사용자 §F — 표시 only, ADR-0423 후속 PR scope).
8. **describeGate2Diagnosis 메시지에 "Gate threshold 완화" / "임계 낮추기"** 표현 (정적 grep 회귀 가드).

## Consequences

### Positive

- 운영자가 `/scan_blockers` 한 명령으로 Gate2_PASS_ZERO 9분기 진단 + 조건별 Top 5 + sectorEnergy 진단 + 차단 사유 분해 즉시 인지.
- DATA_UNAVAILABLE / STALE 우세 시 잘못된 *Gate2 임계 완화* 운영 의사결정 영구 차단.
- ADR-0420 (Gate1) + ADR-0422 (Gate2) 결합으로 GATE1_PASS_ZERO + Gate2_PASS_ZERO 양쪽 시나리오 모두 진단 가능.
- last 7 days `/gate_audit` 와 fresh `/scan_blockers` 분리 명시 → 패치 전 오염 데이터 혼동 차단.

### Negative

- Gate2 precise survivor-level tagging 한계 — 서버 측 명시적 Gate1/Gate2/Gate3 condition-key 분류 SSOT 부재 (클라이언트만 보유). 본 PR 은 *all outputs 기준 + survivor denominator* 로 구현. 후속 PR 에서 server-side stage tagging 도입 시 정확도 향상.
- sectorEnergy 본체 수리 미포함 — `STALE` / `validSectorCount=11/12` / `indexCode missing` / `symmetry validation failed` 같은 *진짜 결함* 은 ADR-0423 후속 PR 수리 의무.

### Neutral

- ENV 신규 0종 — 회귀 발견 시 호출자 측 wiring 제거 (try/catch 격리 + ADR-0420 패턴) 또는 `gate2ConditionBuckets` Map 비우기로 effective rollback.

## Validation

- 회귀 28 케이스 (`gate2LeadershipAttributionAdr0422.test.ts`):
  - 사용자 §I 9 케이스 (1. Gate1 survivor 누적 / 2. DATA_UNAVAILABLE ≠ failed / 3. STALE 분리 / 4. topX 5 fields / 5. SECTOR_DATA_STALE_DOMINANT / 6. DATA_UNAVAILABLE_DOMINANT / 7. PRE_BREAKOUT_WAIT_DOMINANT / 8. TRUE_NO_LEADERSHIP / 9. /scan_blockers 표시 정책)
  - §E 결정 트리 6 분기 (NO_GATE1_SURVIVORS / UNKNOWN / UNKNOWN→SECTOR_DATA_STALE / GATE_RECHECK_DOMINANT / EVALUATOR_ERROR_DOMINANT / MIXED)
  - 헬퍼 SSOT 검증 5 (detailIndicatesStale / finalizeGate2BucketRates / GATE2_DIAGNOSIS_THRESHOLDS 정합 / buildSectorEnergyDiagnostic / describeGate2Diagnosis 9분기 + ADR-0423 명시)
  - 매매 정책 변경 0 정적 grep 가드 2
  - buyListLoop wiring 정적 가드 2 (accumulateGate2ConditionOutputs import + isGate1Survivor + try/catch + scanDiagnostics gate1Pass>0 분기)
  - 안전 invariant 회귀 가드 3 (PROVIDER_DEGRADED+STALE 분리 / waitMarker 우선 / hadRequiredData=false → unavailable)
- 인접 server/trading/signalScanner 53 files **657/657 무회귀**.
- LIVE 매매 본체 0줄 변경 (signalScanner.ts / entryEngine.ts / exitEngine/** / kisClient/** / orchestrator/** / autoTradeEngine* 모두 0 LoC).
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4 보존).

## 잔여 후속 PR (scope 외)

- **ADR-0423** — sectorEnergy 본체 수리 (validSectorCount<12 / indexCode missing for sector A / symmetry validation failed 직접 차단). *진짜 데이터 품질* 결함 수리.
- Gate1/Gate2/Gate3 server-side stage tagging — 클라이언트 `CHECKLIST_TO_CONDITION_ID` 와 정합한 서버 SSOT 도입 후 precise survivor-level Gate2 trace 가능.
- `/gate_audit since_deploy` 옵션 — 배포 이후 누적만 표시 (패치 검증).
- KRX/NAVER/CACHE investor-flow router 복구 (ADR-0421 후속).
