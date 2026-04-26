# ADR-0031 — signalScanner Phase B Part 2: RevalidationStep + SizingDecider patterns

- **Status**: Accepted (2026-04-26, PoC scope: 1 step only — entryRevalidationStep)
- **Owner**: server-refactor-orchestrator (engine-dev)
- **Continues**: ADR-0030 (EntryGate Chain Phase B PoC + Phase B 확장 — 7 gates 추출 완료)

## Context

ADR-0030 PR-57/58 로 evaluateBuyList 의 9개 진입 게이트 중 7개(blacklist / addBuyBlock / RRR / cooldown / sectorConcentration / sectorPreGuard / portfolioRisk)가 EntryGate Chain 으로 추출됐다. 그러나 잔여 영역 — KIS 실시간 보정, liveGate 재검증, MTAS gate, SellOnly 예외, 신뢰도 티어 사이징, KellyBudget, 손절 정책, 승인큐 등록 — 은 다음 이유로 **EntryGate 패턴(차단/통과 boolean)에 부적합**:

1. **Mutating pipeline**: KIS 보정·liveGate 재검증은 `reCheckQuote` / `reCheckGate` 등 staging 컨텍스트를 점진적으로 mutate한다. 단순 boolean 결과로는 표현 불가.
2. **Decision producer**: KellyBudget·신뢰도 티어는 차단/통과가 아니라 `quantity` / `signalGrade` / `tranchePlan` 같은 **수치 결정**을 산출한다.
3. **Slot reservation 강결합**: 승인큐 등록(approvalQueue.ts)은 chain 마지막에 `reservedSlots`/`reservedSectorValues`/`orderableCash` 를 동시 mutate한다 — chain 중간 실패 시 슬롯이 점유되면 안 된다.

## Decision

3 패턴으로 분리:

### (1) RevalidationStep — 다단계 mutating pipeline

```typescript
export interface EntryRevalidationContext {
  stock: WatchlistEntry;            // mutate 가능 (stock.entryFailCount 등)
  currentPrice: number;
  reCheckQuote: YahooQuoteExtended | null;
  reCheckGate: GateEvaluation | null;
  regime: keyof typeof REGIME_CONFIGS;
}

export type EntryRevalidationResult =
  | { proceed: true }
  | {
      proceed: false;
      logMessage: string;
      failReasons: string[];                // counterfactual 기록용 (skipReason 합성)
      counter: 'gateMisses' | 'yahooFails'; // ScanCounters 키
      stageLog: { key: 'gate'; value: string };
      mutateEntryFailCount?: boolean;       // stock.entryFailCount++ 여부 (caller 가 적용)
    };

export type EntryRevalidationStep = (ctx: EntryRevalidationContext) => Promise<EntryRevalidationResult>;
```

**원칙**: step 자체는 외부 mutation·부수효과 0건. fail 시 diagnostic 만 반환. caller(evaluateBuyList)가 stock.entryFailCount, watchlistMutated.value, scanCounters[counter]++, stageLog 갱신, pushTrace, counterfactual 기록을 일괄 적용한다. 이로써 step 단위 테스트가 외부 mock 0건으로 가능.

**확장 경로** (후속 PR): kisIntradayCorrectionStep / mtasGateStep / sellOnlyExceptionStep / yahooUnavailableStep — 모두 동일 시그니처 union 으로 표현 가능.

### (2) SizingDecider — 수치 결정 산출

```typescript
export interface SizingContext {
  stock: WatchlistEntry;
  shadowEntryPrice: number;
  liveGateScore: number;
  mtas: number;
  signalGrade: 'STRONG_BUY' | 'BUY' | 'PROBING' | 'HOLD';
  positionPct: number;
  totalAssets: number;
  shadows: ServerShadowTrade[];
  budget: AccountRiskBudget;
}

export type SizingDecision =
  | { ok: true; quantity: number; effectiveBudget: number; effectiveKelly: number; kellyWasCapped: boolean }
  | { ok: false; reason: string };

export type SizingDecider = (ctx: SizingContext) => SizingDecision;
```

후속 PR 에서 `kellyBudgetSizingDecider` / `confidenceTierSizingDecider` 추출 예정. 본 ADR scope 외.

### (3) Commit 단계 — chain 외부 유지

승인큐 등록(`createBuyTask` + `approvalQueue.enqueue`)은 모든 RevalidationStep 통과 + 모든 SizingDecider 산출 완료 직후 **단일 지점**에서 실행. `reserveSlot()` 도 동일 지점에서 호출되어 chain 중간 실패가 슬롯을 점유하지 않는다.

```typescript
// 가상 코드 (후속 PR)
for (const step of REVALIDATION_STEPS) {
  const r = await step(revalCtx);
  if (!r.proceed) { applyDiagnostic(r); continue; }  // chain 중단, slot 미점유
}
const sizing = sizingDecider(sizingCtx);
if (!sizing.ok) { ... continue; }
// ★ 이 지점에서만 reserveSlot + enqueue. 실패 시 rollback 1지점에서 처리.
const task = createBuyTask({ ... });
mutables.liveBuyQueue.push(task);
mutables.reservedSlots.value += 1;
```

## PR-59 본 PR scope (PoC)

**최소 위험 PoC — 1 step 만 추출**: `entryRevalidationStep` (라인 692-732, 약 40줄).

선정 사유:
- 외부 의존성 단순 (evaluateEntryRevalidation + getMinGateScore + getKstMarketElapsedMinutes 모두 entryEngine.js 순수 함수)
- 차단/통과 1:1
- mutate 대상 명확 (stock.entryFailCount)
- 부수효과 격리 (counterfactual 기록은 caller 가 처리)
- byte-equivalent 추출 — 메시지·counter·stageLog 값 100% 보존

### 시그니처

```typescript
export interface EntryRevalidationStepInput {
  stock: { name: string; code: string; entryFailCount?: number };
  currentPrice: number;
  reCheckQuote: { dayOpen?: number; prevClose?: number; volume?: number; avgVolume?: number } | null;
  reCheckGate: { gateScore?: number; signalType?: string } | null;
  regime: keyof typeof REGIME_CONFIGS;
  marketElapsedMinutes: number;
}

export interface EntryRevalidationStepFail {
  proceed: false;
  logMessage: string;             // "[AutoTrade] {name} 진입 직전 재검증 탈락: {reasons}"
  failReasons: string[];          // entryRevalidation.reasons (counterfactual skipReason 합성)
  stageLogValue: string;          // "FAIL({reasons})"
}
export interface EntryRevalidationStepPass { proceed: true; }
export type EntryRevalidationStepResult = EntryRevalidationStepPass | EntryRevalidationStepFail;

export function entryRevalidationStep(input: EntryRevalidationStepInput): EntryRevalidationStepResult;
```

동기 함수로 정의 — `evaluateEntryRevalidation` 자체가 동기. `getMinGateScore`/`getKstMarketElapsedMinutes` 도 동기. caller 가 `marketElapsedMinutes` 를 전달.

### caller (evaluateBuyList) 변경

기존 41줄 (라인 692-732) 을 약 25줄로 축소:

```typescript
const revalResult = entryRevalidationStep({
  stock, currentPrice, reCheckQuote, reCheckGate,
  regime: ctx.regime,
  marketElapsedMinutes: getKstMarketElapsedMinutes(),
});
if (!revalResult.proceed) {
  console.log(revalResult.logMessage);
  stock.entryFailCount = (stock.entryFailCount ?? 0) + 1;
  ctx.mutables.watchlistMutated.value = true;
  ctx.scanCounters.gateMisses++;
  stageLog.gate = revalResult.stageLogValue;
  pushTrace();
  if (ctx.scanCounters.counterfactualRecordedToday < COUNTERFACTUAL_DAILY_CAP) {
    try {
      const recorded = recordCounterfactual({
        stockCode: stock.code, stockName: stock.name, priceAtSignal: currentPrice,
        gateScore: stock.gateScore ?? 0, regime: ctx.regime,
        conditionKeys: stock.conditionKeys ?? [],
        skipReason: `entryRevalidation:${revalResult.failReasons.join(',')}`,
      });
      if (recorded) ctx.scanCounters.counterfactualRecordedToday++;
    } catch (e) {
      console.warn(`[Counterfactual] record 실패 ${stock.code}:`, e instanceof Error ? e.message : e);
    }
  }
  continue;
}
```

원본 동작과 byte-equivalent. `skipReason` 합성 형식 동일.

## 후속 PR 잔여 (ADR-0031 §2~3)

- PR-60: `kisIntradayCorrectionStep` 추출 (라인 645-681, dayOpen·prevClose 보정 mutating step)
- PR-61: `mtasGateStep` + `sellOnlyExceptionStep` 추출 (라인 752-773, RevalidationStep union 확장)
- PR-62: `sizingTierDecider` 추출 (라인 775-805, SizingDecider 패턴 도입)
- PR-63: `kellyBudgetDecider` 추출 (라인 878-922, SizingDecider 확장)
- PR-64: `stopLossPolicyResolver` 추출 (라인 954-965, 순수 헬퍼)
- PR-65: 승인큐 commit 단계 분리 + slot reservation rollback SSOT

## Trade-offs

- (+) 패턴 시드 확보 — 후속 PR 5종이 본 PR 시그니처를 그대로 차용
- (+) PoC 가 byte-equivalent 추출 → LIVE 회귀 위험 0
- (-) 패턴 3종(EntryGate / RevalidationStep / SizingDecider) 공존 — 신규 게이트 추가 시 패턴 판정 인지 부담
- (-) PoC 에서 caller 가 여전히 부수효과를 처리 → step 자체는 순수해도 evaluateBuyList 길이 감축 폭은 -16줄 수준 (1317 → ~1300)

후속 PR 5건 누적 시 evaluateBuyList 약 800 → 200줄 예상.

## Validation 요건

- vitest server/trading/signalScanner/revalidationSteps 신규 ≥ 8 케이스 (proceed / 단일 fail / 다중 fail / boundary / 빈 reasons / quote=null / gate=null / regime 분기)
- vitest server/trading 전체 무회귀 (PR-58 기준 408/408 pass)
- precommit + validate:all 6종 통과
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4 준수 — kisClient/orchestrator/signalScanner 본체 무수정, evaluateEntryRevalidation 재사용)
