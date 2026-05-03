# ADR-0174 — Safety Gate Attribution + Shadow vs Live Delta Report (Phase 2a 영속 분석 SSOT)

**상태**: Accepted (Phase 2a — 영속 분석 SSOT + 호출자 0건 dead code)
**날짜**: 2026-05-03
**관련 PR**: PR-Shadow-Learning-Phase2a
**의존성**:
- ADR-0173 (Shadow Learning Persistence Phase 1) — `ShadowLearningOnlySignal` 영속 schema + `loadShadowLearningOnlySignals` SSOT
- ADR-0162 (Position Sizing Engine Shadow Apply) — `sizingEngineSnapshot` 영속 read
- ADR-0166 (Regime Exposure Budget) — `cappedByBudget` 영속 read
- ADR-0146 (PR-Pace Audit Rule) — Phase 분리 정합
- ADR-0158 (Wiring SLA Auto-Expiry) — INFRASTRUCTURE_ONLY P1 SLA 45일

## 1. 문제

ADR-0173 Phase 1 이 *학습 샘플 생성 인프라* (3 SSOT) 를 도입했지만 *각 게이트의 사후 효과* 와 *Shadow vs Live 의 missedAlpha* 측정 SSOT 부재. 사용자 §3 Safety Gate Attribution + §4 Shadow vs Live Delta Report — Phase 1 영속 데이터 위에 *read-only 분석* 을 SSOT 로 분리.

### 1.1 Phase 2 분할 정책 (2a / 2b)

Phase 2 (사용자 §3 + §4 + future return resolve cron + MissedLearningQueue cron wiring) 를 회귀 위험 격리로 2 단계 분리:

| Phase | scope | 회귀 위험 | LIVE 결합 |
|-------|-------|----------|----------|
| **Phase 2a (본 PR)** | SafetyGateAttribution + ShadowVsLiveDelta (영속 분석 SSOT, 호출자 0건 dead code) | 0 | 없음 |
| Phase 2b (별도 PR) | future return resolve cron + MissedLearningQueue cron wiring (LIVE cron 결합) | LIVE cron 등록 | cron 결합 |

## 2. 결정

### 2.1 SafetyGateAttribution (사용자 §3)

**파일**: `server/learning/safetyGateAttribution.ts` (신규 SSOT)

**타입**:
```typescript
export type GateName = 'FOMC' | 'VIX' | 'R0_R1_REGIME' | 'LIQUIDITY'
  | 'DATA_SANITY' | 'EXPOSURE_BUDGET' | 'ENEMY_CHECKLIST';

export interface GateAttributionResult {
  gate: GateName;
  avoidedLoss: number;           // 양수 (절댓값) — 차단된 종목 중 future return < 0 의 |sum|
  missedGain: number;             // 양수 — 차단된 종목 중 future return > 0 의 sum
  netGateImpact: number;          // 양수=손실 방지 / 음수=과보호
  blockedWinnerCount: number;
  blockedLoserCount: number;
  gatePrecision: number;          // 0~1 — blockedLoser / (blockedWinner + blockedLoser)
  sampleSize: number;
}

export interface SafetyGateAttributionOptions {
  lookbackDays?: number;          // default 90
  futureReturnHorizon?: 1 | 3 | 5 | 20;  // default 5
}

export function computeSafetyGateAttribution(
  signals: ShadowLearningOnlySignal[],
  options?: SafetyGateAttributionOptions,
): GateAttributionResult[];

export function isSafetyGateAttributionEnabled(): boolean;
```

**게이트 매핑** (Phase 1 `ShadowLearningOnlyScanReason` 8 union → 5 GateName):
- `FOMC_BLOCK` → `FOMC`
- `VIX_SPIKE` → `VIX`
- `RISK_OFF_REGIME` / `R0_CRISIS` / `R1_DEFENSIVE` → `R0_R1_REGIME` (3:1 통합)
- `LIQUIDITY_BLOCK` → `LIQUIDITY`
- `MANUAL_BLOCK` / `KRX_HOLIDAY_REPLAY` → 게이트 분류 제외 (운영자 수동 / 휴장일 replay 는 학습 게이트가 아님)

**잔여 2 게이트** (`DATA_SANITY` / `EXPOSURE_BUDGET` / `ENEMY_CHECKLIST`):
- ShadowLearningOnlyScanReason 8 union 에 직접 매핑 부재
- Phase 3 ReflectionInjectionBus wiring 시 ShadowLearningOnlyScan 호출자가 추가 reason 컨텍스트 전달 후 활성화
- 본 PR 은 *5 게이트 활성 + 2 게이트 dead* (sampleSize=0 반환)

**해석** (사용자 §3 정합):
- `netGateImpact > 0` — 게이트가 손실 방지에 기여
- `netGateImpact < 0` — 과보호 가능성 (게이트 완화 검토)
- `blockedWinnerCount` 급증 → 게이트 완화 후보
- `blockedLoserCount` 급증 → 게이트 유지 또는 강화

**ENV** `SAFETY_GATE_ATTRIBUTION_ENABLED` (default OFF) — Phase 4 Dashboard 또는 Phase 2b cron read 후 활성화.

### 2.2 ShadowVsLiveDelta (사용자 §4)

**파일**: `server/learning/shadowVsLiveDelta.ts` (신규 SSOT)

**타입**:
```typescript
export type DeltaCategory =
  | 'SHADOW_BUY_LIVE_BLOCKED'
  | 'LIVE_BUY_SHADOW_BETTER_SIZE'
  | 'EXPOSURE_CAP_REDUCED'
  | 'MACRO_GATE_BLOCKED'
  | 'LIQUIDITY_GATE_BLOCKED';

export interface DeltaCategoryResult {
  category: DeltaCategory;
  sampleSize: number;
  shadowReturnSum: number;
  liveReturnSum: number;
  missedAlpha: number;            // shadowReturn - liveReturn
  missedAlphaAvg: number;         // 평균 (sampleSize=0 시 0)
}

export interface ShadowVsLiveDeltaInput {
  shadowSignals: ShadowLearningOnlySignal[];
  liveTrades: ServerShadowTrade[];
  options?: { lookbackDays?: number; futureReturnHorizon?: 1 | 3 | 5 | 20 };
}

export function computeShadowVsLiveDelta(input: ShadowVsLiveDeltaInput): DeltaCategoryResult[];
export function isShadowVsLiveDeltaEnabled(): boolean;
```

**5 카테고리 분류 SSOT** (사용자 §4 정합):

| 카테고리 | 분류 조건 |
|----------|----------|
| `SHADOW_BUY_LIVE_BLOCKED` | `signal.wouldHaveBought=true` AND LIVE trade 부재 (KST 일자 매칭) |
| `LIVE_BUY_SHADOW_BETTER_SIZE` | LIVE trade 존재 + `sizingEngineSnapshot` 비교 시 Shadow 의 finalPositionPct > LIVE 적용 size (Phase 1 plumbing only — Phase 3 wiring 후 활성) |
| `EXPOSURE_CAP_REDUCED` | LIVE trade 존재 + `cappedByBudget=true` (ADR-0166) |
| `MACRO_GATE_BLOCKED` | `signal.blockedReason ∈ {FOMC_BLOCK / VIX_SPIKE / RISK_OFF_REGIME / R0_CRISIS / R1_DEFENSIVE}` |
| `LIQUIDITY_GATE_BLOCKED` | `signal.blockedReason === 'LIQUIDITY_BLOCK'` |

**`missedAlpha = shadowReturn - liveReturn`** — 사용자 §4 명시:
- `missedAlpha > 0` — 보수적으로 막아서 *돈을 못 번 경우* (손실 방지가 아니라 기회 손실)
- `missedAlpha < 0` — *살아남은 효과* (Shadow 가 샀더라면 손실)

**ENV** `SHADOW_LIVE_DELTA_REPORT_ENABLED` (default OFF) — Phase 4 Dashboard 또는 Phase 2b cron read 후 활성화.

## 3. 안전 invariant (Phase 2a 절대 규칙)

| # | invariant | 검증 방법 |
|---|-----------|----------|
| 1 | LIVE 매매 본체 0줄 변경 | git diff `signalScanner.ts` + `signalScanner/**` + `entryEngine.ts` + `exitEngine/**` + `kisClient/**` + `orchestrator/**` + `autoTradeEngine*` = 0 줄 |
| 2 | KIS 주문 함수 import 0건 | `placeKisMarketOrder` / `placeKisSellOrder` / `cancelKisOrder` / `placeKisStopLossOrder` / `placeKisTakeProfitOrder` 모두 import 0건 (정적 grep 가드) |
| 3 | 외부 의존성 0 | 2 신규 모듈 fs/외부 API/zustand store 모두 미사용 (순수 함수, 입력은 호출자 read 결과만) |
| 4 | ENV default OFF | 2 ENV 모두 `=== 'true'` 정확 비교 |
| 5 | 호출자 0건 (Phase 2a dead code) | grep `computeSafetyGateAttribution` / `computeShadowVsLiveDelta` = 모듈 자체 + 테스트만 |

## 4. 잘못된 해결 방법 영구 차단

1. ❌ **분석 결과 cache 영속** — 본 PR 은 순수 함수만, 영속 cache 도입 시 stale data 결함
2. ❌ **게이트 식별 알고리즘이 LIVE 주문 호출** — 학습 분석 전용 invariant 위반
3. ❌ **Phase 1 dead code wiring 본 PR 통합** — Phase 2a scope 외 (Phase 3 LIVE 결합 별도 PR)
4. ❌ **호출자 추가** — Phase 2a 는 *분석 SSOT 만*, 호출자 wiring 은 Phase 4 Dashboard / Phase 2b cron
5. ❌ **외부 fs/API 의존** — 순수 함수 invariant (영속 read 는 호출자 책임)
6. ❌ **GateName union 임의 확장** — Phase 1 `ShadowLearningOnlyScanReason` 매핑 정합 위반

## 5. Phase 2b/3/4 wiring 정책 (별도 PR scope)

### 5.1 Phase 2b — cron wiring
- `maintenanceJobs.ts` 다음 영업일 09:30 KST cron + ScheduleClass='TRADING_DAY_ONLY'
- KRX 휴장일 자동 enqueue + 휴장 종료 후 `replayMissedLearningJobs` 호출
- future return resolve cron — `ShadowLearningOnlySignal` 의 1/3/5/20일 후 future return 계산 + 영속 갱신

### 5.2 Phase 3 — LIVE 결합
- 5 early-return 직전 `runShadowLearningOnlyScan` wiring (ENV `SHADOW_LEARNING_ON_BLOCKED_DAYS_ENABLED=true` 활성화)
- ReflectionInjectionBus — `mainReflection` / `scoreBuyCandidate` / `condition weight engine` / `position sizing` 에 `applyFreshnessDecay` 호출 wiring
- DATA_SANITY / EXPOSURE_BUDGET / ENEMY_CHECKLIST 게이트 추가 reason 컨텍스트 전달 (5 → 7 활성)

### 5.3 Phase 4 — Dashboard
- `SafetyGateAttribution` + `ShadowVsLiveDelta` 결과를 Learning Sanity Dashboard 11 지표 UI 에 노출
- read-only API endpoint 추가 (`/api/learning/safety-gate-attribution` + `/api/learning/shadow-vs-live-delta`)

## 6. 운영 효과 (Phase 2a 머지 후)

- 사용자 §3 + §4 분석 SSOT 인프라 마련 (호출자 0건 dead code, LIVE 영향 0)
- Phase 2b/3/4 후속 PR 의 SSOT 진입점 확정
- 회귀 위험 격리 — Phase 1 동일 패턴 (dead code + ENV default OFF + 외부 의존성 0)
