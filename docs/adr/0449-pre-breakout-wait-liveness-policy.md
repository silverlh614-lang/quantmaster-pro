# ADR-0449 — Pre-Breakout WAIT Liveness Policy

**Status**: Accepted
**Date**: 2026-05-08
**Related**: ADR-0115 (failCount 보호), ADR-0118 (waitPreBreakout 카운터),
ADR-0146 (PR 자가 review), ADR-0157 (ENV 정확 비교), ADR-0420 (fresh attribution),
ADR-0436 (Gate Eligibility Split), ADR-0437 (KIS-WS Subscription Priority Queue),
ADR-0448 (Trading Engine Liveness First).

## Problem

ADR-0448 Phase 0 적용 후 매매엔진은 다시 살아났으나, 운영 로그 분석 결과 다수
후보가 **진입가 미도달 pre-breakout WAIT** 상태에서 무한 대기 중. WAIT 자체는
정상 동작 (ADR-0115 — failCount 미증가, REJECT 가 아니라 HOLD/WAIT) 이지만,
세 가지 부작용 발생:

1. **KIS-WS 30 슬롯 점유** — 진입가 미도달 종목이 슬롯을 차지해 보유 종목 / 즉시
   진입 후보가 밀려남.
2. **운영자 진단 가시성 부족** — `/scan_blockers` 에 "waitPreBreakout: N개" 단일
   카운터만 노출 → 어느 종목이 *왜* 대기 중인지 분간 불가.
3. **무한 대기 재발 위험** — 동일 종목이 며칠 연속 WAIT 누적되면 KIS-WS 슬롯이
   다시 LOW priority 종목으로 채워져 ADR-0437 우선순위 큐 정책 효과 저하.

핵심 인용 (사용자 직접 명시):

> ADR-0449는 '후보를 왜 안 샀는가'를 실패가 아니라 상태로 관리하는 패치다.
> 448이 엔진 심장을 살렸다면, 449는 WAIT 후보들이 혈관에 막히지 않게 순환시키는 작업이다.
>
> Pre-Breakout WAIT 는 실패가 아니다. 하지만 무한 대기도 아니다.

## Runtime evidence

운영 로그 (ADR-0448 적용 직후 1주):
- `/scan_blockers` "waitPreBreakout: 30+" 다수 스캔.
- 동일 종목 (예: 005930 Samsung) 의 WAIT 가 며칠 연속 누적 → 운영자가 *왜
  매수 안 되지?* 질문에 진입가 0.5% 차이인지 / 거래량 약함인지 / Gate 재검증
  탈락인지 분간 불가.
- KIS-WS subscriptionManager 가 진입가 미도달 종목까지 priority 500 (WATCHLIST)
  으로 잡고 있어 보유 종목 / liveEligible 신규 후보가 슬롯 부족.

## Decision

**Pre-Breakout WAIT 후보를 7-state 모델로 분류** + **별도 카운터** (waitCount /
recheckFailCount / lastWaitAt) + **KIS-WS priority routing 연동 (ADR-0437)** +
**`/scan_blockers` compact summary** 도입.

### 7-state 모델 (사용자 §"권장 상태")

| State | 의미 |
|-------|------|
| `WAIT_RETRY_ELIGIBLE` | 진입가 근접 + 조건 살아 있음 → 다음 루프 재검증 |
| `WAIT_PRICE_TOO_FAR` | 현재가가 진입가에서 너무 멀다 (3% 초과) |
| `WAIT_VOLUME_WEAK` | 가격 근접하지만 거래량 약함 (40% 미만) |
| `WAIT_GATE_RECHECK_FAILED` | 직전 진입 직전 재검증 탈락 |
| `WAIT_COOLDOWN` | 반복 WAIT (3회 이상) → 일정 시간 관망 |
| `WAIT_SHADOW_ONLY` | Live 후보 아님 + 관측/학습 가치만 |
| `WAIT_REJECTED` | 진입가 괴리 과대 / 리스크 훼손 / 조건 붕괴 |

### 9-value reason union

`ENTRY_PRICE_NOT_REACHED` / `PRICE_DISTANCE_TOO_FAR` / `VOLUME_BELOW_THRESHOLD`
/ `GATE_RECHECK_FAILED` / `REPEATED_WAIT` / `STALE_QUOTE` / `RISK_RULE_BLOCKED`
/ `SHADOW_OBSERVABLE_ONLY` / `UNKNOWN`.

### 결정 트리 우선순위 (절대 변경 금지)

1. ENV DISABLED → 보수 fallback (UNKNOWN + retry false + KIS-WS KEEP)
2. `riskBlocked === true` → `WAIT_REJECTED`
3. `quoteStale === true` → `WAIT_SHADOW_ONLY`
4. `recheckPassed === false` → `WAIT_GATE_RECHECK_FAILED` (recheckFailCount++)
5. `waitCount >= 3` → `WAIT_COOLDOWN`
6. `shadowObservable && !liveEligible` → `WAIT_SHADOW_ONLY`
7. `priceDistance > 3%` → `WAIT_PRICE_TOO_FAR`
8. `volumeRatio < 0.4` → `WAIT_VOLUME_WEAK`
9. `priceDistance ≤ 1% AND gate1Passed` → `WAIT_RETRY_ELIGIBLE`
10. 그 외 → 보수적 `WAIT_RETRY_ELIGIBLE` (default fallback)

### KIS-WS priority adjustment 매핑 (ADR-0437 연동)

| State | KIS-WS 조정 |
|-------|------------|
| RETRY_ELIGIBLE | KEEP |
| PRICE_TOO_FAR | DOWNGRADE_TO_WATCHLIST |
| VOLUME_WEAK | DOWNGRADE_TO_OBSERVE_ONLY |
| GATE_RECHECK_FAILED | DOWNGRADE_TO_WATCHLIST |
| COOLDOWN | DOWNGRADE_TO_OBSERVE_ONLY |
| SHADOW_ONLY | DOWNGRADE_TO_OBSERVE_ONLY |
| REJECTED | UNSUBSCRIBE_IF_LOW_PRIORITY |

본 PR 은 *priority routing decision 진단 정보* 만 영속 — 실제 KIS-WS
`bulkApplySubscriptionsByPriority` 호출자 wiring 은 별도 후속 PR scope.

### failCount vs waitCount 분리 (ADR-0115 보호)

- `entryFailCount`: 진짜 실패 (CRITICAL only — sanity violation, schema 결손).
- `waitCount`: pre-breakout 정상 대기 (NON_CRITICAL — 진입가 미도달).
- `recheckFailCount`: Gate 재검증 탈락 누적 (NON_CRITICAL).

`PreBreakoutWaitDecision.increaseFailCount` 는 **literal type `false`** —
TypeScript 가 컴파일 타임에 강제 (호출자가 true 로 변경 시 컴파일 에러).
ADR-0115 의 진입가 미도달 보호 정책이 본 SSOT 에 코드 레벨로 박제.

## Implementation

### Files

| 파일 | 역할 |
|------|------|
| `server/trading/signalScanner/preBreakoutWaitPolicy.ts` | 신규 SSOT — 결정 트리 + summary + format |
| `server/trading/signalScanner/scanDiagnostics.ts` | ScanCounters / ScanSummary 옵셔널 후방호환 + persistScanResults wiring + formatScanBlockersMessage 섹션 추가 |
| `server/trading/signalScanner/perSymbol/buyListLoop.ts` | 두 WAIT site 에 evaluatePreBreakoutWait 호출 + try/catch 격리 + waitCount/lastWaitAt 갱신 |
| `server/persistence/watchlistRepo.ts` | `waitCount?` / `recheckFailCount?` / `lastWaitAt?` 옵셔널 후방호환 schema 격상 |
| `server/trading/signalScanner/preBreakoutWaitPolicyAdr0449.test.ts` | 신규 회귀 66 케이스 |

### `/scan_blockers` 출력

```
🕒 Pre-Breakout WAIT (ADR-0449)
  • retryEligible 4 / cooldown 8 / shadowOnly 12 / rejected 3
  • priceTooFar 5 / volumeWeak 2 / gateRecheckFailed 7
  • topReason: ENTRY_PRICE_NOT_REACHED 11, GATE_RECHECK_FAILED 7, PRICE_DISTANCE_TOO_FAR 5
  • failCountProtected: 27
```

`failCountProtected` 카운트가 `decisions.length` 와 같음을 운영자에게
가시화 — 본 SSOT 의 모든 decision 이 ADR-0115 보호 (`increaseFailCount: false`).

## ENV rollback

`PRE_BREAKOUT_WAIT_POLICY_DISABLED=true` (default OFF, ADR-0157 정확 비교 의무 —
`'1'` / `'TRUE'` / `'yes'` 모두 거부) → `evaluatePreBreakoutWait` 가 보수 fallback
(UNKNOWN + retry false + KIS-WS KEEP) 반환 → 호출자 측 ADR-0115 단순 WAIT 동작
100% 복원. 회귀 발견 시 1줄 즉시 롤백.

## Invariants (절대 변경 금지)

1. `increaseFailCount: false` literal type 강제 (TypeScript 강제, ADR-0115 보호).
2. `waitCount` / `recheckFailCount` / `lastWaitAt` 별도 카운터 (entryFailCount 와 분리).
3. Live 진입 조건 변경 0 (gate threshold / condition weight / STRONG_BUY 조건 변경 0).
4. SectorEnergy / 수급 / Yahoo / FSS 보수 0 (out of scope, ADR-0445~0448 정합).
5. ADR-0437 KIS-WS subscription priority queue 와 priority routing 만 연동
   (`bulkApplySubscriptionsByPriority` 본 PR 통합 0, decision 진단 정보만 영속).
6. KIS 주문 함수 5종 import 0건 (정적 grep 가드).
7. autoTradeEngine / orderExecutor / trancheExecutor import 0건 (정적 grep 가드).
8. 외부 API (KIS / KRX / Yahoo / Naver) 신규 호출 0건 — 본 SSOT 는 순수 함수.
9. 모든 7-state 의 `decision.increaseFailCount === false` (런타임 검증).
10. ENV `PRE_BREAKOUT_WAIT_POLICY_DISABLED=true` 1줄로 ADR-0115 단순 WAIT 동작 복원.
11. 호출자 측 inline ENV 검사 0건 — `isPreBreakoutWaitPolicyDisabled()` SSOT 위임.
12. try/catch 격리 — 분류 throw 가 매수 흐름 차단 0 (ADR-0146 정합).
13. ADR-0115 `shouldIncrementFailCount('PRE_BREAKOUT_MISS' | 'ENTRY_PRICE_DEVIATION')` 분기 보존.
14. ScanCounters.preBreakoutWaitDecisions / ScanSummary.preBreakoutWaitSummary 옵셔널
    후방호환 — 기존 호출자 무수정 영속 데이터 호환.
15. `riskBlocked` 우선순위 최상위 — 동시 다중 신호 충족 시 항상 REJECTED.
16. SHADOW_ONLY 분기 시 `shadowLearningAllowed=true` + `counterfactualLearningAllowed=true`
    (ADR-0173 ShadowLearningOnlyScan 정합 — 매매 차단 ≠ 학습 차단).

## Out of scope (잔여 후속 PR)

- KIS-WS `bulkApplySubscriptionsByPriority` 호출자 wiring (ADR-0437 후속 PR scope).
- WAIT_COOLDOWN 영속 만료 정책 (`lastWaitAt + 30분` cooldown 자동 해제 별도 ADR).
- Watchlist 자동 정리 — `WAIT_REJECTED` 영구 제거는 ADR-0115 정합으로 별도 ADR
  (사용자 명시 *"WAIT 는 실패가 아니다"* 정합 — 자동 제거 절대 금지).
- 거래량 비율 (`volumeRatio`) 자동 산출 — 호출자 측 reCheckQuote 격상 별도 PR.
- Gate1 통과 여부 (`gate1Passed`) 직접 평가 결합 — 현재 호출자 측 undefined 전달
  (default fallback). 후속 wiring PR 에서 정확 평가 결과 전달.

## Test plan

- `server/trading/signalScanner/preBreakoutWaitPolicyAdr0449.test.ts` — 신규 66 케이스.
- 12 그룹 — A (ENV gate) / B (상수 SSOT) / C (computePriceDistancePct) / D (결정
  트리 우선순위) / E (increaseFailCount false literal — ADR-0115 보호) / F (KIS-WS
  priority adjustment) / G (increaseWaitCount/RecheckFailCount 분리) / H
  (shadowLearning/counterfactualLearning) / I (operatorMessage) / J
  (summarizePreBreakoutWaitDecisions) / K (formatPreBreakoutWaitSummarySection)
  / L (정적 grep 가드 — KIS import 0 / autoTradeEngine 0 / fetch 0 / scanDiagnostics
  wiring / buyListLoop wiring + ADR-0115 분기 보존) / M (통합 시나리오 — 100 후보,
  우선순위 충돌, 30 종목 회귀).
- 인접 회귀 — server/trading/signalScanner 949/949 무회귀, sanitized stash 검증
  사전 baseline 2 fail (scanBlockersKisWsAdr0442) 본 PR 무관 확정.
