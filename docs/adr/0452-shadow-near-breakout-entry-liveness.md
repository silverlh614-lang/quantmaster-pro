# ADR-0452 — Shadow Entry Liveness for Near-Breakout Candidates

- **Status**: Accepted
- **Date**: 2026-05-08
- **Related**: ADR-0115 (failCount 보호) / ADR-0157 (정확 비교) / ADR-0173 (Shadow Learning Only Scan) / ADR-0437 (KIS WebSocket Subscription Priority Queue) / ADR-0448 (Trading Engine Liveness First) / ADR-0449 (Pre-Breakout WAIT 7-state Liveness Policy) / ADR-0450 (KIS-WS Pre-Breakout Priority Routing) / ADR-0451 (Empty Scan Liveness Policy)
- **Pattern**: Shadow Learning Lane separate from Live Execution

## 한 줄 정의 (사용자 §1, 절대 변경 금지)

> "ADR-0452 는 Live 매수 조건은 그대로 유지하되, near-breakout 후보가 Live 에서는 WAIT
> 이더라도 Shadow 에서는 가상 진입을 생성하여 학습을 지속하게 만드는 패치다."

ADR-0449 가 도입한 7-state Pre-Breakout WAIT 분류 위에서, *near-breakout 학습 가치가 큰
WAIT 후보* 만 Shadow virtual buy 로 기록한다. **Live 매매 조건은 절대 변경하지 않는다**.

## Context

ADR-0449 (Pre-Breakout WAIT 7-state Liveness Policy) 가 단순히 매수 흐름을 통과시키지
않고 *상태 분류 + 카운터 분리 + 진단 가시화* 로 격상한 결과:

- WAIT_RETRY_ELIGIBLE 후보가 다음 사이클로 자연 순환 (ADR-0115 failCount 보호)
- WAIT_PRICE_TOO_FAR / VOLUME_WEAK 후보가 진단 layer 에서만 표시
- WAIT_REJECTED 후보가 KIS-WS 호출 자체 차단 (ADR-0450 priority routing)

**남은 결함**: 학습 데이터 손실. *Live 진입가 1% 미만으로 근접한 near-breakout 후보* 가
Live 모드에서 WAIT 인 동안 — 실제로는 큰 학습 가치를 가진다 — 어떤 영속 trade 도
생성되지 않아 후속 Counterfactual / Provisional 분석 표본이 0 으로 누적.

ADR-0173 (Shadow Learning Only Scan) 가 5 early-return site 에서 universe-level
학습을 하지만 *후보 단위* 학습 lane 은 별개 — 사용자 핵심 의도 *"매수 조건은 절대 완화하지
않고, Shadow 매수만 near-breakout 후보에 별도 liveness lane 을 연다."*

## 사용자 핵심 의도 (사용자 §2, 절대 변경 금지)

1. **Live 매수 조건 완화 금지** — Gate threshold / STRONG_BUY 조건 / 진입가 변경 0건.
2. **Shadow 매수만 near-breakout 후보에 별도 liveness lane 개방.**
3. **executionImpact 반드시 NONE** — literal type 강제 (TypeScript 컴파일 타임).
4. **실제 KIS 주문 / paper 주문 / approval queue 와 절대 연결 금지.**

## Decision

### 1. SSOT — `server/trading/signalScanner/shadowNearBreakoutEntryPolicy.ts`

순수 함수만, 외부 의존성 0 (KIS / Yahoo / approval queue / autoTradeEngine import 0건).

### 2. Schema (사용자 §4 정합 — 절대 변경 금지)

```typescript
// 5-value cause union
type ShadowNearBreakoutEntryCause =
  | 'NEAR_ENTRY_PRICE'
  | 'RETRY_ELIGIBLE_WAIT'
  | 'LIVE_WAIT_BUT_SHADOW_OBSERVABLE'
  | 'GATE_RECHECK_SOFT_FAIL'
  | 'UNKNOWN';

// 9-value blockReason union
type ShadowNearBreakoutBlockReason =
  | 'RISK_BLOCKED' | 'PRICE_TOO_FAR' | 'VOLUME_TOO_WEAK'
  | 'QUOTE_STALE' | 'DUPLICATE_SHADOW_ENTRY' | 'DAILY_CAP_REACHED'
  | 'LIVE_ALREADY_ENTERED' | 'NOT_SHADOW_MODE' | 'UNKNOWN';

interface ShadowNearBreakoutEntryDecision {
  allowed: boolean;
  cause?: ShadowNearBreakoutEntryCause;
  blockReason?: ShadowNearBreakoutBlockReason;
  executionImpact: 'NONE';                          // literal
  createShadowTrade: boolean;
  createLiveOrder: false;                            // literal
  createPaperOrder: false;                           // literal
  learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY';        // literal
  operatorMessage: string;
}
```

### 3. 정책 임계 SSOT (사용자 §5 — 절대 변경 금지)

```typescript
SHADOW_NEAR_BREAKOUT_ENTRY_POLICY = Object.freeze({
  MAX_DISTANCE_PCT: 1.5,        // near-breakout 임계 (Live 진입가 1.5% 이내)
  SOFT_DISTANCE_PCT: 2.0,       // soft near-breakout (Gate recheck soft fail 케이스만)
  MIN_LIVE_GATE_SCORE: 5.0,     // Shadow 학습 가치 임계 (Live 진입 임계 보다 낮음)
  MIN_CONDITIONS_PASSED: 5,     // 27조건 중 최소 통과 수
  MIN_VOLUME_RATIO: 0.25,       // 거래량 비율 최소치
  DAILY_CAP: 3,                 // 일일 Shadow near-breakout entry 최대 생성 수
});
```

### 4. 결정 트리 우선순위 (사용자 §5 정합 — 절대 변경 금지)

1. ENV `SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED=true` → blocked (UNKNOWN)
2. `!shadowMode` → NOT_SHADOW_MODE (Live 모드 무관)
3. `riskBlocked === true` → RISK_BLOCKED
4. `quoteStale === true` → QUOTE_STALE
5. `alreadyHasOpenShadow || alreadyEnteredToday` → DUPLICATE_SHADOW_ENTRY
6. `dailyCreatedCount >= DAILY_CAP (3)` → DAILY_CAP_REACHED
7. preBreakoutState 분기:
   - `WAIT_REJECTED` → RISK_BLOCKED
   - `WAIT_PRICE_TOO_FAR` → PRICE_TOO_FAR
   - `WAIT_VOLUME_WEAK` → VOLUME_TOO_WEAK
   - `WAIT_COOLDOWN` / `WAIT_GATE_RECHECK_FAILED` + soft distance + recheckPassed=false →
     GATE_RECHECK_SOFT_FAIL allowed
   - `WAIT_RETRY_ELIGIBLE` / `WAIT_SHADOW_ONLY` + 모든 임계 통과 →
     NEAR_ENTRY_PRICE 또는 LIVE_WAIT_BUT_SHADOW_OBSERVABLE allowed
8. preBreakoutState 미상 → UNKNOWN blocked

### 5. wiring (호출자 0건 dead code 금지 — `buyListLoop.ts` 두 WAIT site 활성화)

**PRE_BREAKOUT_MISS site** (라인 ~989) + **ENTRY_PRICE_DEVIATION site** (라인 ~1140)
모두 동일 패턴:

```typescript
try {
  const todayKst = new Date().toISOString().split('T')[0];
  const distancePct = Math.abs(((currentPrice - stock.entryPrice) / stock.entryPrice) * 100);
  const alreadyHasOpenShadow = ctx.shadows.some(...);
  const alreadyEnteredToday = ctx.shadows.some(...);
  const dailyCreatedCount = ctx.shadows.filter(...).length;
  const shadowDecision = evaluateShadowNearBreakoutEntry({...});
  if (shadowDecision.allowed && shadowDecision.createShadowTrade) {
    const shadowTrade = buildBuyTrade({
      idPrefix: 'shadow-near-breakout',
      ...,
      shadowMode: true,                          // 강제 — Live 주문 방지
      watchlistSource: 'SHADOW_NEAR_BREAKOUT',  // ADR-0452 marker
    });
    ctx.shadows.push(shadowTrade);
    saveShadowTrades(ctx.shadows);                // 영속
    ctx.scanCounters.shadowNearBreakoutCreated++;
  } else if (...) {
    ctx.scanCounters.shadowNearBreakoutBlocked++;
    // accumulate blockReason
  }
} catch (e) {
  console.warn(`[ADR-0452] ... 분류 실패 ${stock.code}:`, e);
}
```

### 6. 영속 schema 격상 (사용자 §7 정합 — 후방호환)

`ServerShadowTrade.watchlistSource` 5-value union (옵셔널, 후방호환):

```typescript
watchlistSource?: 'PRE_MARKET' | 'INTRADAY' | 'PRE_BREAKOUT'
                | 'PRE_BREAKOUT_FOLLOWTHROUGH' | 'SHADOW_NEAR_BREAKOUT';
```

### 7. ScanCounters / ScanSummary 카운터 3종 (옵셔널, 후방호환)

```typescript
shadowNearBreakoutCreated?: number;
shadowNearBreakoutBlocked?: number;
shadowNearBreakoutBlockReasons?: Partial<Record<ShadowNearBreakoutBlockReason, number>>;
```

### 8. /scan_blockers compact section (사용자 §9)

```
🌘 Shadow Near-Breakout (ADR-0452)
  • created N / blocked M
  • topBlock: PRICE_TOO_FAR 5, VOLUME_TOO_WEAK 3, DAILY_CAP_REACHED 1
  • executionImpact: NONE
```

`created+blocked === 0` 시 미노출 (잡음 차단). Telegram HTML raw 태그 금지.

### 9. ENV 우회

`SHADOW_NEAR_BREAKOUT_ENTRY_DISABLED=true` (default OFF, ADR-0157 정확 비교 — `'1'` /
`'TRUE'` / `'yes'` 모두 거부) — 1줄 즉시 ADR-0449 동작 100% 복원.

## 절대 불변식 (literal type 강제 + 정적 grep 가드)

1. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` /
   `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` 모두
   0줄 (정적 grep 가드).
2. **executionImpact: 'NONE'** — literal type, TypeScript 컴파일 타임 강제.
3. **createLiveOrder: false** — literal type 강제.
4. **createPaperOrder: false** — literal type 강제.
5. **learningTag: 'SHADOW_NEAR_BREAKOUT_ENTRY'** — literal type 강제.
6. **KIS 주문 함수 5종 import 0건** (정적 grep 가드).
7. **autoTradeEngine / orderExecutor / trancheExecutor import 0건** (정적 grep 가드).
8. **외부 fetch / axios / node-fetch import 0건** (정적 grep 가드).
9. **approvalQueue / requestBuyApproval 호출 0건** (정적 grep 가드).
10. **Gate threshold + condition weight + STRONG_BUY 조건 변경 0**.
11. **shadowMode: true 강제** — buildBuyTrade 호출 시 (정적 grep 가드).
12. **watchlistSource: 'SHADOW_NEAR_BREAKOUT'** marker — Counterfactual / Provisional
    분석 시 SHADOW_NEAR_BREAKOUT 표본 별도 분리 가능.
13. **DAILY_CAP=3** 일일 cap 강제 — 학습 표본 폭주 차단.
14. **try/catch 격리** — 분류 throw 가 매수 흐름 차단 절대 금지.
15. **ENV 정확 비교 의무** (`=== 'true'`, ADR-0157 정합).

## 잘못된 해결 방법 영구 차단

1. **Live 진입 조건 완화** — Gate threshold / STRONG_BUY 조건 / 진입가 변경 (사용자 §2 위반).
2. **Live + Shadow 동시 진입** — `shadowMode: true` literal 강제로 차단.
3. **executionImpact: 'PARTIAL' / 'FULL'** — literal type 강제로 차단.
4. **createLiveOrder: true 또는 createPaperOrder: true** — literal type 강제로 차단.
5. **DAILY_CAP 무시 또는 임의 임계 변경** — Object.freeze drift 가드.
6. **호출자 측 inline ENV 검사** — `isShadowNearBreakoutEntryDisabled()` SSOT 위임 의무.
7. **KIS / approval queue / orderExecutor 경로 연결** — 정적 grep 가드.
8. **fetch / axios 외부 API 신규 호출** — SSOT 는 순수 함수만.
9. **decision.cause / decision.blockReason 외 신규 enum 추가** — drift 위험.
10. **PreBreakoutWaitState union 무관 분기 추가** — ADR-0449 schema 무수정 의무.

## 운영 효과 (배포 직후)

- **학습 표본 격상** — 기존 0 / Live WAIT 후보 N → SHADOW_NEAR_BREAKOUT 표본 일일 최대 3건.
- **사용자 모드별 효과**:
  - SHADOW 모드: 기존 매수 0건 → SHADOW_NEAR_BREAKOUT virtual buy 일일 최대 3건 추가.
  - LIVE 모드: 변경 0건 (사용자 §2 핵심 의도 정합).
- **Counterfactual / Provisional 분석** — `watchlistSource='SHADOW_NEAR_BREAKOUT'`
  marker 로 별도 표본 분리 가능 (후속 PR).

## 회귀 테스트 (74/74 PASS)

`server/trading/signalScanner/shadowNearBreakoutEntryPolicyAdr0452.test.ts`:

- Group A — ENV gate (default OFF, ADR-0157 정확 비교) — 6 케이스
- Group B — 절대 불변식 literal type — 5 케이스
- Group C — 정책 임계 SSOT (절대 변경 금지) — 2 케이스
- Group D — shadowMode 우선 차단 — 2 케이스
- Group E — riskBlocked / quoteStale 우선 차단 — 3 케이스
- Group F — 중복 / dailyCap 차단 — 5 케이스
- Group G — preBreakoutState 분기 — 8 케이스
- Group H — 임계 boundary — 10 케이스
- Group I — formatShadowNearBreakoutSection — 7 케이스
- Group J — buyListLoop wiring 정적 grep 가드 — 8 케이스
- Group K — scanDiagnostics formatScanBlockersMessage wiring — 5 케이스
- Group L — ServerShadowTrade.watchlistSource union 격상 — 2 케이스
- Group M — 정적 grep 안전 invariant — 5 케이스
- Group N — 통합 시나리오 — 6 케이스

## 잔여 후속 PR (scope 외)

- Counterfactual / Provisional 분석 모듈에서 `watchlistSource='SHADOW_NEAR_BREAKOUT'`
  표본 별도 분리 + 학습 가중치 적용.
- DAILY_CAP=3 운영 데이터 누적 후 재조정 (별도 ADR — 절대 임계 변경은 데이터 기반 의무).
- Shadow virtual buy 시점 quantity 정밀화 (현재 1주 고정).
- KIS-WS 슬롯 재배치 자동 (Shadow Near-Breakout 진입 시 priority 재평가, ADR-0437 후속).
