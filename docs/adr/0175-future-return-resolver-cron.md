# ADR-0175 — Future Return Resolver Cron (Phase 2b-1)

**상태**: Accepted (Phase 2b-1 — 영속 갱신 cron + ENV gate)
**날짜**: 2026-05-03
**관련 PR**: PR-Shadow-Learning-Phase2b1
**의존성**:
- ADR-0173 (Shadow Learning Persistence Phase 1) — `ShadowLearningOnlySignal` 영속 schema (futureReturn1d/3d/5d/20d + outcome 필드)
- ADR-0174 (Safety Gate Attribution + Shadow vs Live Delta Phase 2a) — 영속 분석 SSOT 의 입력 데이터 갱신
- ADR-0112 (Breakeven Classification + Circuit Isolation) — outcome 임계 (WIN > +1.0% / LOSS < -0.5% / BE 그 외)
- ADR-0045 (Market Day Classifier + Schedule Guard) — ScheduleClass='TRADING_DAY_ONLY' KRX 휴장일 자동 skip
- ADR-0146 (PR-Pace Audit Rule) — Phase 분리 정합
- ADR-0158 (Wiring SLA Auto-Expiry) — INFRASTRUCTURE_ONLY P1 SLA 45일

## 1. 문제

ADR-0173 Phase 1 의 `ShadowLearningOnlySignal` 영속 schema 에 `futureReturn1d/3d/5d/20d` + `outcome` 필드가 정의됐지만 *갱신 메커니즘 부재* — Phase 2a (ADR-0174) 의 SafetyGateAttribution + ShadowVsLiveDelta 분석 SSOT 가 이 필드들을 입력으로 사용하는데 *영원히 PENDING* 상태라 분석 결과 sampleSize=0 만 반환.

### 1.1 Phase 2b 분할 정책 (2b-1 / 2b-2)

Phase 2b 를 회귀 위험 격리로 2 단계 분리:

| Phase | scope | 회귀 위험 | LIVE 결합 |
|-------|-------|----------|----------|
| **Phase 2b-1 (본 PR)** | future return resolve cron (단일 신규 cron, 영속 갱신 only) | 신규 cron 만 | 없음 |
| Phase 2b-2 (별도 PR) | MissedLearningQueue replay cron + 7 학습 작업 enqueue wiring (기존 cron 변경) | 기존 cron 동작 변경 | cron 결합 |

## 2. 결정

### 2.1 `server/learning/futureReturnResolver.ts` 신규 SSOT

```typescript
export interface FutureReturnResolveResult {
  totalSignals: number;
  resolvedCount: number;
  outcomesUpdated: number;
  errors: number;
  durationMs: number;
}

export interface FutureReturnResolveInput {
  now?: Date;
  priceFetcher?: (symbol: string, asOf: Date) => Promise<number | null>;
  horizons?: Array<1 | 3 | 5 | 20>;
}

export async function resolveFutureReturns(input?: FutureReturnResolveInput): Promise<FutureReturnResolveResult>;
export function isFutureReturnResolverEnabled(): boolean;
```

**동작 결정 트리**:
1. ENV `FUTURE_RETURN_RESOLVER_ENABLED !== 'true'` → 즉시 `{ totalSignals: 0, ... durationMs: 0 }` 반환
2. `loadShadowLearningOnlySignals()` (Phase 1 SSOT) read
3. 각 signal 순회:
   - `signal.outcome ∈ {'WIN', 'LOSS', 'BE'}` 이미 closed → skip
   - signalDate 부터 horizon 영업일 후 *현재 시점 도달* horizon 만 갱신:
     - 1일 도달 (signalDate +1 영업일 ≤ now) AND `futureReturn1d` 부재 → 갱신
     - 3일 도달 AND `futureReturn3d` 부재 → 갱신
     - 5일 도달 AND `futureReturn5d` 부재 → 갱신
     - 20일 도달 AND `futureReturn20d` 부재 → 갱신
   - `priceFetcher(symbol, asOf=signalDate+horizon영업일)` 호출 → `(price - hypotheticalEntryPrice) / hypotheticalEntryPrice * 100` 계산
   - 가격 fetch 실패 (null 반환) → `errors++` + 다음 horizon 시도
   - 20d 도달 + 모든 horizon 갱신 완료 → outcome 분류:
     - `futureReturn20d > +1.0` → `outcome='WIN'`
     - `futureReturn20d < -0.5` → `outcome='LOSS'`
     - 그 외 → `outcome='BE'`
     - ADR-0112 임계 정합 (`EXIT_OUTCOME_THRESHOLDS.WIN_PCT_MIN` / `LOSS_PCT_MAX`)
4. `saveShadowLearningOnlySignals(updated)` 영속
5. 결과 통계 반환

**ENV** `FUTURE_RETURN_RESOLVER_ENABLED` (default OFF) — 운영자 명시 활성화 의무.

### 2.2 cron 등록

```typescript
scheduledJob('30 7 * * 1-5', 'TRADING_DAY_ONLY', 'future_return_resolve', async () => {
  if (!isFutureReturnResolverEnabled()) return;
  const result = await resolveFutureReturns();
  console.log(`[FutureReturnResolver] resolved=${result.resolvedCount}/${result.totalSignals} outcomes=${result.outcomesUpdated} errors=${result.errors} (${result.durationMs}ms)`);
});
```

**cron 시간**: UTC 평일 07:30 = **KST 평일 16:30** (KRX 장 마감 30분 후) + ScheduleClass `'TRADING_DAY_ONLY'` (KRX 휴장일 자동 silent skip).

**등록 위치**: `server/scheduler/learningJobs.ts` (다른 학습 cron 인접).

### 2.3 priceFetcher 의존성 주입

기본 구현: KIS 현재가 조회 (`fetchKisCurrentPrice` from `kisClient/query.ts`) — 절대 규칙 #2 (kisClient 단일 통로) 정합. read-only `kisGet` 만 사용.

대체 가능:
- 테스트: mock `priceFetcher` 주입
- Yahoo: 향후 historical price API 연결 옵션 (현재 KIS 만)

**KIS quota 영향**:
- Phase 1 데이터 0건 (호출자 0건) → cron 호출 시 0건
- Phase 3 wiring 후 데이터 누적 시작 → signal 1건당 horizon 별 1회 호출 (최대 4회)
- 100 signal 누적 시 cron 1회당 최대 400회 KIS 호출 (KIS 일일 한도 충분)

## 3. 안전 invariant (Phase 2b-1 절대 규칙)

| # | invariant | 검증 |
|---|-----------|------|
| 1 | LIVE 매매 본체 0줄 변경 | git diff `signalScanner.ts` + `signalScanner/**` + `entryEngine.ts` + `exitEngine/**` + `kisClient/**` + `orchestrator/**` + `autoTradeEngine*` = 0 줄 |
| 2 | KIS 주문 함수 import 0건 | `placeKisMarketOrder` / `placeKisSellOrder` / `cancelKisOrder` / `placeKisStopLossOrder` / `placeKisTakeProfitOrder` 모두 import 0건 (정적 grep 가드) |
| 3 | KIS 호출은 read-only 만 | `fetchKisCurrentPrice` 등 read-only API 만, 절대 규칙 #2 정합 |
| 4 | ENV default OFF | `FUTURE_RETURN_RESOLVER_ENABLED` 미설정 → cron 진입부 즉시 return + 외부 호출 0건 |
| 5 | 호출자 1건 (cron 만) | grep `resolveFutureReturns` = 모듈 + 테스트 + cron 등록만 |
| 6 | KRX 휴장일 silent skip | ScheduleClass='TRADING_DAY_ONLY' (ADR-0045 정합) |

## 4. 잘못된 해결 방법 영구 차단

1. ❌ **cron 안에서 KIS 주문 호출** — 학습 영속 갱신 전용, LIVE 주문 경로 결합 금지
2. ❌ **ENV default ON** — 운영자 명시 활성화 의무 (KIS quota 영향 인지 후 ENV 활성화)
3. ❌ **outcome 분류 임계 별도 정의** — ADR-0112 임계 그대로 사용 (drift 차단)
4. ❌ **호출자 다수 추가** — Phase 2b-1 은 cron 단일 호출자만, 다른 호출자 (예: HTTP endpoint) 후속 PR
5. ❌ **priceFetcher 외 직접 fetch** — 의존성 주입 패턴 강제 (테스트 격리)
6. ❌ **closed signal 재계산** — outcome 결정된 signal 재방문 금지 (불변성 보장)

## 5. Phase 2b-2/3/4 wiring 정책 (별도 PR scope)

### 5.1 Phase 2b-2 — MissedLearningQueue cron wiring
- `maintenanceJobs.ts` 다음 영업일 KST 09:30 cron + ScheduleClass='TRADING_DAY_ONLY' + `replayMissedLearningJobs` 호출
- `learningJobs.ts` 7 학습 작업 (counterfactual_resolve / ledger_resolve / ghost_portfolio / nightly_reflection / daily_mini_backtest / shadow_live_delta_report / safety_gate_attribution) cron 진입부 KRX 휴장일 감지 후 `enqueueMissedLearningJob` 호출
- ENV `MISSED_LEARNING_QUEUE_ENABLED=true` 활성화

### 5.2 Phase 3 — LIVE 결합
- 5 early-return 직전 `runShadowLearningOnlyScan` wiring (ENV `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED=true`)
- ReflectionInjectionBus — `mainReflection` / `scoreBuyCandidate` / `condition weight engine` / `position sizing` 에 `applyFreshnessDecay` 호출 wiring

### 5.3 Phase 4 — Dashboard
- `SafetyGateAttribution` + `ShadowVsLiveDelta` 결과를 Learning Sanity Dashboard 11 지표 UI 노출
- `/api/learning/safety-gate-attribution` + `/api/learning/shadow-vs-live-delta` HTTP endpoint

## 6. 운영 효과 (Phase 2b-1 머지 후)

- ADR-0174 SafetyGateAttribution + ShadowVsLiveDelta 의 *입력 데이터 갱신 인프라* 활성화 (현재는 dead — Phase 3 wiring 후 데이터 누적 시작)
- 회귀 위험 격리 — 단일 신규 cron + ENV default OFF + LIVE 영향 0 (호출자 1건)
- Phase 2b-2/3/4 후속 PR 의 데이터 흐름 SSOT 확정
