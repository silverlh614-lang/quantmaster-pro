# ADR-0173 — Shadow 학습 지속성 1차 고도화 (Phase 1 인프라 — MissedLearningQueue + ShadowLearningOnlyScan + LearningFreshnessGuard)

**상태**: Accepted (Phase 1 — 3 SSOT 인프라 + dead code, Phase 2/3/4 wiring 별도 PR)
**날짜**: 2026-05-03
**관련 PR**: PR-Shadow-Learning-Persistence-Phase1
**의존성**:
- ADR-0028b (Rejection Universe Tracker) — `recordRejection` SSOT
- ADR-0029b (Counterfactual Twin Portfolio) — `recordCounterfactual` SSOT
- ADR-0068b (Shadow Learning Hooks Wiring) — 5 학습 채널 영속 정합
- ADR-0114 (Data Trust Layer) — 데이터 품질 우회 금지
- ADR-0117 (Sanity Trade-Block Gate) — `safePctChangeStrict` 통과 의무
- ADR-0146 (PR-Pace Audit Rule) — 4 Phase 시리즈 분리 정합
- ADR-0158 (Wiring SLA Auto-Expiry) — INFRASTRUCTURE_ONLY P1 SLA 45일
- ADR-0162 (Position Sizing Engine Shadow Apply) — Phase 분리 패턴 차용

## 1. 문제

QuantMaster Pro 의 Shadow 학습 시스템은 *매매 금지일·휴일·서버 장애·API 실패* 발생 시 **신규 학습 샘플 생성 자체가 차단**된다. 시스템은 *위험을 피한 날의 기회비용* 과 *막아서 살아남은 효과* 를 구분 학습할 데이터가 부재.

### 1.1 5 early-return 분류 (매매 금지일 — `signalScanner.ts`)

| 라인 | reason | 트리거 | 패턴 | 영향 |
|------|--------|--------|------|------|
| L300~305 | `SELL_ONLY_REJECT` | `sellOnlyExc.allow=false` | `await updateShadowResults(shadows, regime); saveShadowTrades(shadows); return {};` | buyList 루프 미진입 |
| L313~321 | `R6_BLOCK` (사용자 명세 `R0_CRISIS` / `R1_DEFENSIVE` / `RISK_OFF_REGIME` 매핑 포함) | `regime.tradeRegime === 'DEFENSE'` | 동일 | 동일 |
| L326~345 | `VIX_BLOCK` (사용자 명세 `VIX_SPIKE`) | `vixGating.noNewEntry=true` | 동일 | 동일 |
| L359~376 | `FOMC_BLOCK` | `fomcProximity.noNewEntry=true` | 동일 | 동일 |
| L396 | `DATA_DEGRADATION_BLOCK` | 데이터 빈곤 (yahoo 결손 / 매크로 stale) | 동일 | 동일 |

추가 차단 사유 (사용자 §2 명세):
- `LIQUIDITY_BLOCK` — 거래대금 / 시총 임계 미달 (Phase 2 wiring 에서 추가 site 식별)
- `KRX_HOLIDAY_REPLAY` — KRX 휴장일 다음 영업일 MissedLearningQueue replay
- `MANUAL_BLOCK` — 운영자 수동 차단

### 1.2 단절되는 학습 채널 5종

| # | 채널 | SSOT | 영향 |
|---|------|------|------|
| 1 | `recordCounterfactual()` | `server/learning/counterfactualShadow.ts` | 탈락 후보 사후 추적 미기록 |
| 2 | `recordRejection()` | `server/learning/rejectionShadowTracker.ts` | Gate 14~17 near-miss 미기록 |
| 3 | 신규 Shadow trade 생성 | `buildBuyTrade` + `appendShadow` | SHADOW 매매 샘플 0건 |
| 4 | MOMENTUM Shadow 학습 | PR-25 시리즈 | profileType A/B 학습 단절 |
| 5 | `entryConditionScores` 영속 | PR-Phase0-MappingFix (ADR-0149) | 27조건 attribution 입력 단절 |

### 1.3 휴일·장애·배포 시 학습 작업 손실

`maintenanceJobs.ts` ScheduleClass='TRADING_DAY_ONLY' 가드 (PR-D ADR-0045) 가 KRX 휴장일에 다음 7 학습 작업 모두 silent skip:
- `counterfactual_resolve` / `ledger_resolve` / `ghost_portfolio` / `nightly_reflection` / `daily_mini_backtest` / `shadow_live_delta_report` / `safety_gate_attribution`

→ 휴일 후 다음 영업일에도 *복구 메커니즘 부재* — 영구 손실.

## 2. 결정

### 2.1 4 Phase 시리즈 분리 정책

사용자 §"Shadow 학습 지속성 1차 고도화 패치" 7 P0 모듈을 회귀 위험 격리 + ADR-0146 PR 자가 review 정합 위해 4 Phase 분리.

| Phase | Scope | LIVE 결합 | 의존 | SLA |
|-------|-------|-----------|------|-----|
| **Phase 1 (본 PR)** | §1 MissedLearningQueue + §2 ShadowLearningOnlyScan + §5 LearningFreshnessGuard (3 SSOT 인프라, dead code) | 없음 | 독립 | INFRASTRUCTURE_ONLY P1 45일 |
| Phase 2 | §3 Safety Gate Attribution + §4 Shadow vs Live Delta Report + future return resolve cron | 없음 (read-only) | Phase 1 | P1 45일 |
| Phase 3 | §6 ReflectionInjectionBus (mainReflection / scoreBuyCandidate / sizing wiring) + 5 early-return wiring | **LIVE 결합 + ENV gate** | Phase 1+2 | P0 21일 |
| Phase 4 | §7 Learning Sanity Dashboard (UI 11 지표) | 없음 (read-only UI) | Phase 1~3 | P2 120일 |

각 Phase 머지 후 SHADOW 1~2주 검증 → 다음 Phase 진행. ADR-0162 패턴 차용.

### 2.2 §1 MissedLearningQueue (`server/learning/missedLearningQueue.ts` + `server/persistence/missedLearningQueueRepo.ts`)

휴일·장애·배포 시 스킵된 학습 작업을 다음 영업일에 안전하게 복구.

**타입 SSOT**:
```typescript
export type MissedLearningJobName =
  | 'counterfactual_resolve'
  | 'ledger_resolve'
  | 'ghost_portfolio'
  | 'nightly_reflection'
  | 'daily_mini_backtest'
  | 'shadow_live_delta_report'
  | 'safety_gate_attribution';

export type MissedLearningReason =
  | 'KRX_HOLIDAY' | 'SERVER_DOWN' | 'DEPLOYMENT'
  | 'API_FAILURE' | 'MARKET_DATA_MISSING' | 'TIMEOUT' | 'MANUAL_SKIP';

export type ReplayPolicy =
  | 'SAFE_NEXT_TRADING_DAY' | 'REPLAY_IMMEDIATELY'
  | 'DROP_IF_STALE' | 'MANUAL_REVIEW';

export interface MissedLearningJob {
  id: string;
  jobName: MissedLearningJobName;
  reason: MissedLearningReason;
  skippedAt: string;     // ISO
  replayPolicy: ReplayPolicy;
  status: 'PENDING' | 'REPLAYED' | 'DROPPED' | 'FAILED';
  replayedAt?: string;
  failureReason?: string;
  retryCount?: number;   // 재시도 카운트 (default 3 한계)
  idempotencyKey: string;
}

export function enqueueMissedLearningJob(input: Omit<MissedLearningJob, 'id'|'status'>): MissedLearningJob;
export function replayMissedLearningJobs(opts: { tradingDate: string; maxJobsPerRun?: number }): Promise<{ replayed: number; failed: number; dropped: number }>;
export function dropStaleJobs(now?: Date): number;
```

**동작 원칙 (사용자 §1 명세)**:
1. KRX 휴장일이면 학습 작업 PENDING 저장 (DROP 금지)
2. 다음 영업일 안전 시간대 (장 시작 전 / 장 마감 후) replay
3. `idempotencyKey` 멱등성 — 동일 키 enqueue 중복 차단
4. 14일 이상 STALE 자동 DROP_IF_STALE
5. replay 실패 시 FAILED 영속 + 재시도 횟수 제한 (default 3)
6. **실제 주문 경로와 절대 결합 금지** — 학습 복구 전용

**영속 SSOT** (`server/persistence/missedLearningQueueRepo.ts`):
- `data/missed-learning-queue.json` (paths.ts +`MISSED_LEARNING_QUEUE_FILE`)
- atomic write tmp→rename + 손상 JSON 빈 배열 fallback + FIFO 1000 trim

**ENV** `MISSED_LEARNING_QUEUE_ENABLED` (default OFF) — Phase 2 cron wiring 후 활성화.

### 2.3 §2 ShadowLearningOnlyScan (`server/trading/shadowLearningOnlyScan.ts`)

**타입 SSOT** (사용자 §2 명세 정합):
```typescript
export type ShadowLearningOnlyScanReason =
  | 'FOMC_BLOCK' | 'VIX_SPIKE' | 'RISK_OFF_REGIME'
  | 'R0_CRISIS' | 'R1_DEFENSIVE' | 'KRX_HOLIDAY_REPLAY'
  | 'LIQUIDITY_BLOCK' | 'MANUAL_BLOCK';

export interface ShadowLearningOnlyScanInput {
  /** 의무 — false literal type. true 전달 시 즉시 throw (LIVE 주문 경로 격리 invariant). */
  allowRealOrder: false;
  /** 의무 — 호출자 매크로 게이트 우회 의도 명시. */
  bypassMacroEntryBlock: boolean;
  reason: ShadowLearningOnlyScanReason;
  scanDate: string;        // YYYY-MM-DD KST
}

export interface ShadowLearningOnlySignal {
  symbol: string;
  signalDate: string;
  blockedReason: ShadowLearningOnlyScanReason;
  wouldHaveBought: boolean;
  hypotheticalEntryPrice: number;
  hypotheticalStopLoss: number;
  hypotheticalTargetPrice: number;
  signalGrade: 'STRONG_BUY' | 'BUY' | 'WATCH' | 'NONE';
  gateScore: number;
  regime: string;
  macroBlockReason: string;
  dataQualityStatus: 'OK' | 'STALE' | 'INVALID';
  futureReturn1d?: number;
  futureReturn3d?: number;
  futureReturn5d?: number;
  futureReturn20d?: number;
  outcome?: 'WIN' | 'LOSS' | 'BE' | 'PENDING';
}

export type ShadowLearningOnlyScanResult =
  | { skipped: true; reason: 'ENV_DISABLED' }
  | {
      skipped: false;
      reason: ShadowLearningOnlyScanReason;
      candidates: number;
      wouldBuyCount: number;
      signalsRecorded: number;
    };
```

**동작 원칙 (사용자 §2 명세)**:
1. **실제 주문 0건** — `allowRealOrder=true` 전달 시 즉시 throw (literal type + runtime 2중 강제)
2. macro entry block 우회 (`bypassMacroEntryBlock=true`) 하되 **데이터 품질 / 가격 sanity 우회 금지** — `safePctChangeStrict` (ADR-0117) + `getDataTrustTier` (ADR-0114) 통과 의무
3. 후보 종목별 *"만약 금지일이 아니었다면 샀을지"* 판단
4. `shadow_learning_only_signal` 영속 (15+ 필드, 위 schema)
5. 1/3/5/20일 후 future return 계산 → `missedAlpha` 산출 (Phase 2 cron)
6. Safety Gate Attribution + Shadow vs Live Delta Report 의 입력 (Phase 2 결합)

**ENV** `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED` (default OFF) — Phase 3 wiring 후 활성화.

### 2.4 §5 LearningFreshnessGuard (`server/learning/learningFreshnessGuard.ts`)

**타입 SSOT**:
```typescript
export interface LessonWithMeta {
  weight: number;
  ageDays: number;
  regime?: string;
  // ... 호출자 측 추가 필드 자유
}

export const FRESHNESS_DECAY_14D_RATIO = 0.3;
export const FRESHNESS_EXPIRY_30D = 0;
export const REGIME_MISMATCH_RATIO = 0.5;

export function applyFreshnessDecay<T extends LessonWithMeta>(
  lesson: T,
  currentRegime?: string,
  now?: Date,
): T;

export function isFreshnessGuardEnabled(): boolean;
```

**동작 원칙 (사용자 §5 명세)**:
- `ageDays > 30` → `weight = 0` (만료)
- `ageDays > 14` → `weight × 0.3` (감쇠)
- `lesson.regime !== currentRegime` (둘 다 정의 시) → `weight × 0.5` (regime 불일치)
- 다중 조건 동시 충족 시 곱셈 결합 (예: 14일 + regime 불일치 → 0.3 × 0.5 = 0.15)

**적용 대상 (Phase 3 ReflectionInjectionBus 결합)**:
- `recentReflections`
- `conditionLessons`
- `biasHeatmap`
- `counterfactualLessons`
- `gateAttributionLessons`

**ENV** `LEARNING_FRESHNESS_GUARD_ENABLED` (default OFF) — Phase 3 wiring 후 활성화.

## 3. 안전 invariant (Phase 1 절대 규칙)

| # | invariant | 검증 방법 |
|---|-----------|----------|
| 1 | LIVE 매매 본체 0줄 변경 | git diff `signalScanner.ts` + `signalScanner/**` + `entryEngine.ts` + `exitEngine/**` + `kisClient/**` + `orchestrator/**` + `autoTradeEngine*` = 0 줄 |
| 2 | KIS 주문 함수 import 0건 | `placeKisMarketOrder` / `placeKisSellOrder` / `placeStopLossOrder` 등 import 정적 grep = 모듈 자체 + 테스트 0건 |
| 3 | `allowRealOrder=true` throw | runtime + literal type 2중 강제 |
| 4 | ENV default OFF | 3 ENV 모두 미설정 → 호출 시 즉시 skip 또는 no-op |
| 5 | 호출자 0건 (Phase 1 dead code) | grep `runShadowLearningOnlyScan` / `enqueueMissedLearningJob` / `applyFreshnessDecay` = 모듈 자체 + 테스트만 |

## 4. 잘못된 해결 방법 영구 차단

1. ❌ **`allowRealOrder=true` 옵션 도입** — LIVE 주문 격리 invariant 위반
2. ❌ **5 early-return 직접 제거** — LIVE 매매 회귀 위험 (KIS 주문 경로가 매매 금지 가드 우회)
3. ❌ **`runAutoSignalScan` 안에 분기 추가** — god function 강화
4. ❌ **MissedLearningQueue replay 시 LIVE 주문 경로 호출** — 학습 복구 전용 invariant 위반
5. ❌ **ShadowLearningOnlyScan 데이터 sanity 우회** — `safePctChangeStrict` 통과 의무
6. ❌ **Phase 1 단일 PR 통합 (7 모듈 + wiring + UI)** — 회귀 위험 ↑ + ADR-0146 audit 룰 충돌

## 5. Phase 2 wiring 정책 (별도 PR scope)

### 5.1 ShadowLearningOnlyScan 5 early-return wiring
```typescript
if (regime === 'R6_DEFENSE') {
  await updateShadowResults(shadows, regime);
  saveShadowTrades(shadows);

  // ADR-0173 Phase 2 — 학습 샘플 생성 (LIVE 주문 격리)
  if (isShadowLearningOnBlockedDaysEnabled()) {
    await runShadowLearningOnlyScan({
      allowRealOrder: false,
      bypassMacroEntryBlock: true,
      reason: 'R0_CRISIS',  // R6_DEFENSE → R0_CRISIS 매핑
      scanDate: getKstDateString(),
    }).catch(console.error);
  }

  return {};
}
```

5 site 동일 패턴 + reason 매핑 (R6_DEFENSE → R0_CRISIS / VIX_BLOCK → VIX_SPIKE / SELL_ONLY_REJECT 그대로 / FOMC_BLOCK 그대로 / DATA_DEGRADATION_BLOCK → 별도 ENV gate 검토).

### 5.2 MissedLearningQueue cron wiring
- `maintenanceJobs.ts` 다음 영업일 09:30 KST cron + ScheduleClass='TRADING_DAY_ONLY'
- KRX 휴장일 자동 enqueue (jobName 7종 모두) + 휴장 종료 후 replay

### 5.3 Phase 3 ReflectionInjectionBus
- `mainReflection` / `scoreBuyCandidate` / `condition weight engine` / `position sizing adjustment` 에 `recentReflections` / `conditionLessons` / `biasHeatmap` / `counterfactualLessons` 주입
- `applyFreshnessDecay` 호출 wiring
- `reflectionInjectionRate >= 0.8` 목표

## 6. 운영 효과 (Phase 1 머지 후)

- 휴일·장애·배포 시 학습 작업 *영구 손실* 차단의 인프라 마련 (Phase 2 cron wiring 활성화 의무)
- 매매 금지일 *학습 샘플 0건* 결함 차단의 인프라 마련 (Phase 3 wiring 활성화 의무)
- LIVE 매매 영향 0 (Phase 1 dead code + ENV default OFF)

## 7. 후속 PR

| PR | scope | LIVE 영향 | 우선순위 |
|----|-------|-----------|---------|
| Phase 2 | Safety Gate Attribution + Shadow vs Live Delta Report + 1/3/5/20d future return resolve cron | 없음 | P1 SLA 45일 |
| Phase 3 | 5 early-return wiring + ReflectionInjectionBus + ENV `=true` 활성화 | **LIVE 결합** (SHADOW 1주 검증 후) | P0 SLA 21일 |
| Phase 4 | Learning Sanity Dashboard (11 지표 UI) | 없음 (read-only) | P2 SLA 120일 |
