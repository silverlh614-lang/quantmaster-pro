# ADR-0448 — Trading Engine Liveness First: Auxiliary Data Must Not Hard-Block Execution

- **Status**: Accepted (2026-05-08)
- **Phase**: 0 (foundation — 후속 ADR 들이 본 원칙 위에서 확장)

## 1. Problem

ADR-0445~0447 시리즈에서 KRX parser diagnostic / SectorEnergy recovery / sanity
diagnostic / alias expansion / non-sector aggregate filtering 을 연속으로 추가했다.
각 패치는 *개별적으로는 안전* 했지만, 운영상 **SectorEnergy 진단이 매매엔진 전체의
전역 차단처럼 작동** 하면서 live 매매엔진이 사실상 멈췄다.

운영 증상 (사용자 보고):
- SectorEnergy `dataQuality: STALE / DEGRADED`
- `sourceTier: STOCK_DAILY` (일부 sector indexCode 미회복)
- `freshness: FRESH` 인데 `confidence: 0.0%`
- `leadershipConfidence: BLOCKED`
- sanity `confidenceImpact: BLOCKED`
- `indexCodeCoverage: 18.7%`
- `backfilledByAliasExpansion: 0`
- `sourceTierBreakdown: UNKNOWN` 다수
- SELL_ONLY / LUNCH_BREAK / KRX DATA_UNAVAILABLE 와 겹침
- `liveStrongBuyAllowed: false`
- `shadowObservableAllowed: true`
- Counterfactual Universe Learning 은 살아 있음
- **그러나 실매매 후보 평가가 SectorEnergy BLOCKED / R3 streak 누적으로 과도하게 멈춤**

## 2. Runtime Evidence

본 결함의 두 가지 경로 (audit 결과):

1. **R3 streak 누적**: SectorEnergy STALE/DEGRADED/FAILED 시점 매 스캔마다 streak +1.
   `r3SanityProfiles.shadowOnlyAt` 도달 시 `preflight.ts:493 ` SHADOW_ONLY pre-scan
   abort → buyList 루프 미진입 → 실매매 후보 평가 중단.

2. **운영자 인지 부족**: 3층 분리 (진단 / 점수 / 실행) 가 코드 레벨에는 비공식적으로
   존재 — `applySectorScoreBoost` (점수 0), `evaluateSectorEnergyStrongBuyGate`
   (STRONG_BUY 강등), `evaluateGuards` (R3 HARD_BLOCK 차단) — 하지만 운영자가
   `/scan_blockers` 등으로 "왜 매매가 멈췄는가" 를 즉시 인지할 SSOT 부재.

## 3. Decision — 새 시스템 원칙

**모든 데이터 신호를 두 종류로 분리한다**:

### 3.1 Core Execution Signals
매매 차단 판단축 — 오류/위험 시 hard block 가능.
- 가격 / 거래량
- 캔들 / 추세
- 손절 / 리스크
- 시장 개장 여부 (`isMarketOpen`)
- SELL_ONLY 모드
- `emergencyStop`
- 주문 안전장치 (회로차단기 / 24h endpoint blacklist)
- R6_DEFENSE
- VIX / FOMC 게이팅 (블랙스완 방어)
- Position / risk limit

### 3.2 Auxiliary Signals
보조 가산점·감점·진단축 — 오염 시 *score boost 제거 / STRONG_BUY 제한 / 운영자
warning* 까지만 가능. **단독으로 매매엔진 전체 정지 절대 금지**.
- 섹터에너지 (SectorEnergy)
- 수급 (KRX/Naver/KIS investor flow)
- 외국인 / 기관 세부 흐름
- 뉴스 / 공시
- sanity diagnostic (sector pct / stock volume / stock return outliers)
- macro confidence (provider degraded 등)
- alias / indexCode recovery

### 3.3 핵심 규칙
> **Core 신호 오류/위험 → 매매 차단 가능**.
> **Auxiliary 신호 오류/오염 → 가산점 제거, 경고, STRONG_BUY 제한까지만 가능**.

## 4. 3층 분리 — diagnostic / scoring / execution

`SectorEnergy` 가 본 원칙의 첫 reference implementation. SSOT:
`server/clients/sectorEnergyExecutionImpact.ts`.

```ts
type SectorEnergyDiagnosticStatus =
  | 'OK' | 'DEGRADED' | 'STALE' | 'BLOCKED' | 'DATA_UNAVAILABLE';

type SectorEnergyScoringImpact =
  | 'ALLOW_SECTOR_BOOST' | 'ZERO_SECTOR_BOOST'
  | 'SECTOR_SCORE_NEUTRAL' | 'SECTOR_PENALTY_ONLY';

type SectorEnergyExecutionImpact =
  | 'NO_EXECUTION_BLOCK' | 'DISALLOW_STRONG_BUY_ONLY' | 'HARD_BLOCK';
```

**핵심 불변식**: `hardBlockAllowed: false` literal type 강제 — SectorEnergy 유래에서는
*절대* `executionImpact = 'HARD_BLOCK'` 발생 0건. 진짜 HARD_BLOCK 은 §3.1 Core Signals
에서만.

권장 결정 (절대 변경 금지):
- **OK** → ALLOW_SECTOR_BOOST + NO_EXECUTION_BLOCK
- **DEGRADED / STALE / STOCK_DAILY / UNKNOWN / fallback != NONE** → ZERO_SECTOR_BOOST + DISALLOW_STRONG_BUY_ONLY
- **BLOCKED (FAILED / sanity BLOCKED / leadership BLOCKED + sanity BLOCKED)** → ZERO_SECTOR_BOOST + DISALLOW_STRONG_BUY_ONLY
- **DATA_UNAVAILABLE** (입력 부재) → SECTOR_SCORE_NEUTRAL + DISALLOW_STRONG_BUY_ONLY (보수)

## 5. SectorEnergy Execution Decoupler

SSOT: `server/clients/sectorEnergyExecutionImpact.ts`

핵심:
- `deriveSectorEnergyExecutionImpact(input)` 결정 트리 SSOT.
- 모든 분기에서 `hardBlockAllowed: false` literal type 강제 (TypeScript 강제).
- `formatSectorEnergyExecutionImpactCompactLine(result)` Telegram plain text
  (`<b>` 태그 0).
- `isSectorEnergyExecutionDecouplingDisabled()` ENV 우회 (`SECTOR_ENERGY_EXECUTION_DECOUPLING_DISABLED=true`,
  default OFF, ADR-0157 정확 비교).

기존 코드와의 관계 — *비공식적으로 이미 작동 중* 이던 3층 분리를 **단일 SSOT 로
공식화** (호출자 본체 무수정):
- `applySectorScoreBoost` (`sectorScoreBoost.ts`) — STALE/DEGRADED/FAILED → 0 자동 적용.
- `evaluateSectorEnergyStrongBuyGate` (`sectorEnergyStrongBuyGate.ts`) — STALE/DEGRADED/FAILED → STRONG_BUY 강등.
- `evaluateGuards` (`r3ViolationStateMachine.ts`) — DEGRADED/FAILED → R3 HARD_BLOCK 차단.

본 SSOT 는 기존 기능을 *교체하지 않고 진단 layer 만 추가*. /scan_blockers 운영자
가시성 격상 + 향후 다른 Auxiliary signal (수급 / sanity / alias) 도 동일 패턴으로 확장.

## 6. R3 Noise Governor

SSOT: `server/trading/signalScanner/r3NoiseGovernor.ts`

문제: ADR-0419 `evaluateStreakIncrementAllowed` 가 SELL_ONLY / VIX / FOMC /
volumeClock / KRX_NON_TRADING_DAY 등 11 reason 의 streak 갱신 skip 을 처리하지만,
SectorEnergy diagnostic BLOCKED + shadowObservable 존재 시점 처리 부재 → 매 스캔마다
streak +1 → SHADOW_ONLY 발동.

해결:
```ts
type R3Gate1ZeroCause =
  | 'TRUE_GATE1_ZERO'                   // provider healthy + 모든 게이트 통과 + gate1Pass=0
  | 'SELL_ONLY_GATE1_ZERO'              // SELL_ONLY 모드
  | 'LUNCH_BREAK_GATE1_ZERO'            // volumeClock CLOSED
  | 'DATA_UNAVAILABLE_GATE1_ZERO'       // dataStarved / FrozenQuote STALE
  | 'SECTOR_ENERGY_DIAGNOSTIC_BLOCKED'  // SectorEnergy 진단 BLOCKED (신규)
  | 'PROVIDER_DEGRADED_GATE1_ZERO'      // KRX/Yahoo 일시 장애 (신규)
  | 'SHADOW_OBSERVABLE_EXISTS'          // counterfactual 학습 후보 존재 (신규)
  | 'UNKNOWN';

interface R3NoiseGovernorDecision {
  cause: R3Gate1ZeroCause;
  streakImpact: 0 | 1;          // 0 = streak skip, 1 = 정상 누적
  action: 'KEEP_COUNTERFACTUAL_LEARNING' | 'KEEP_SHADOW_OBSERVATION'
        | 'PATCH_PROVIDER' | 'R3_TRUE_EMPTY_SCAN';
  liveBlockPreserved: true;     // literal — Live 차단은 기존 규칙 그대로
  reason: string;
}
```

핵심 불변식 (사용자 §"중요" 직접 매핑):
- `liveBlockPreserved: true` literal — `streakImpact=0` 이어도 SELL_ONLY/risk 기존 차단 그대로.
- Provider healthy + 모든 게이트 통과 + gate1Pass=0 + no shadow observable → `streakImpact=1` (정상 누적).

ENV 우회: `R3_NOISE_GOVERNOR_DISABLED=true` (default OFF).

Wiring: `scanDiagnostics.persistScanResults` 가 `evaluateR3NoiseGovernor` 호출 →
`streakImpact === 0` 시 R3 state machine 의 `evaluateR3ViolationState` 호출 자체 skip
(영속 streak 무영향 + 24h decay 보존). ScanSummary 에 `r3NoiseDecision` 영속 →
/scan_blockers compact line 자동 노출.

## 7. /scan_blockers Telegram 표시

운영자 가시성 격상 (사용자 §"권장 텔레그램 표시"):

```
🧩 SectorEnergy: diagnostic BLOCKED · sectorBoost=0 · STRONG_BUY blocked · execution HARD_BLOCK=no
🛡️ R3 Noise: cause SECTOR_ENERGY_DIAGNOSTIC_BLOCKED · streakImpact=0 · shadow observed
```

핵심: 마지막 필드 `execution HARD_BLOCK=no` 가 **항상** 표시 — 운영자가 *"SectorEnergy
가 매매엔진을 멈추지 않는다"* 를 즉시 인지.

기술 요구사항:
- plain text (no `<b>` raw tags — Telegram HTML parse failure 방지).
- 부재 시 미노출 (gate1Pass>0 또는 ENV DISABLED 시 — 후방호환).
- try/catch 격리 (진단 throw 가 base 메시지 차단 안 함).

## 8. Invariants (절대 불변식)

1. **LIVE 주문 경로 변경 0건** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**`
   / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts`
   / `buyPipeline.ts` 모두 0줄.
2. **KIS 주문 함수 5종 import 0건** (`placeKisMarketBuyOrder` / `placeKisSellOrder` /
   `placeKisStopLossOrder` / `placeKisTakeProfitOrder` / `cancelKisOrder`) — 정적 grep 가드.
3. `autoTradeEngine` / `orderExecutor` / `trancheExecutor` import 0건.
4. **Gate threshold 변경 0건** / **condition weight 변경 0건** / **STRONG_BUY 조건
   완화 0건**.
5. **SELL_ONLY 해제 금지** / **EmergencyStop / R6 defense / true hard risk block 그대로 유지**.
6. **SectorEnergy STALE/DEGRADED/BLOCKED 를 OK 로 승격 금지**.
7. **STOCK_DAILY fallback 을 trusted leadership 으로 승격 금지**.
8. **UNKNOWN sourceTier outlier 를 leadership 계산에 사용 금지**.
9. **SectorEnergy BLOCKED 는 diagnostic BLOCKED 로 유지**.
10. **SectorEnergy BLOCKED 는 sectorBoost=0**.
11. **SectorEnergy BLOCKED 는 STRONG_BUY 금지**.
12. **SectorEnergy BLOCKED 만으로 전체 evaluation HARD_BLOCK 금지** (`hardBlockAllowed: false`
    literal type 강제).
13. **DATA_UNAVAILABLE 을 failed 로 계산 금지** (ADR-0416 정합).
14. **Shadow / counterfactual learning 차단 금지**.
15. **R3 `streakImpact=0` 이어도 `liveBlockPreserved: true`**.
16. **외부 API 신규 호출 0건** (정적 grep 가드 — `fetch` / `axios` / `node-fetch`).
17. **raw payload 전체 영속 금지**.
18. **ENV 정확 비교 의무** (ADR-0157) — `=== 'true'` 만, `'1'` / `'TRUE'` / `'yes'` 거부.
19. **호출자 측 inline ENV 검사 0건** — SSOT 헬퍼 위임.

## 9. Rollback ENV (default OFF)

```
SECTOR_ENERGY_EXECUTION_DECOUPLING_DISABLED=true
R3_NOISE_GOVERNOR_DISABLED=true
```

응급 ENV (사용자 §"지금 당장 코딩 없이 할 수 있는 조치", 별도 ADR 도입 SSOT):
```
SECTOR_ENERGY_SANITY_DIAGNOSTIC_DISABLED=true        # ADR-0446
SECTOR_ENERGY_RECOVERY_PHASE2_DISABLED=true          # ADR-0446
SECTOR_ENERGY_ALIAS_REGISTRY_EXPANSION_DISABLED=true # ADR-0447
```

`disabled=true` 시 본 PR 의 SSOT 는 보수 fallback (기존 ADR-0419/0436 동작) 으로 복원.
회귀 발견 시 1줄 즉시 롤백.

## 10. Out of Scope

본 ADR 은 *생존성 복구* 만. 다음은 **하지 않는다**:
- SectorRegistry 만들지 않는다 (ADR-0448 Phase 1 별도 PR).
- metaIndexClassifier 만들지 않는다.
- alias seed 추가하지 않는다.
- alias suggestion 만들지 않는다.
- `validate:sector_alias_coverage` 만들지 않는다.
- FSS / ADR-0140 연동하지 않는다.
- KRX endpoint 복구하지 않는다.
- NAVER / Semantic NetBuy wiring 하지 않는다.
- 신규 외부 API 호출 0.
- R3 기준 자체 완화 0.
- Gate threshold 완화 0.
- STRONG_BUY 조건 완화 0.
- Live / Paper promotion 0.

## 11. Test Plan

### 신규 회귀 (89/89 PASS)
- `server/clients/sectorEnergyExecutionImpactAdr0448.test.ts` — 33 케이스
  - ENV gate 6 (default / 'true' / '1' 거부 / 'TRUE' 거부 / 'yes' 거부 / 'false')
  - 결정 트리 14 (OK / DEGRADED / STALE / FAILED / sanity BLOCKED / leadership+sanity BLOCKED /
    STOCK_DAILY / UNKNOWN sourceTier / fallback / PARTIAL_VOLUME / PARTIAL / null /
    빈 객체 / 알 수 없는 dataQuality)
  - 절대 불변식 17 (15 입력 매트릭스 × hardBlockAllowed=false / OK 외 strongBuy=false /
    OK 외 sectorBoost=false)
  - formatCompactLine 3 (HARD_BLOCK=no 표시 / BLOCKED 분기 / `<b>` 부재)
- `server/trading/signalScanner/r3NoiseGovernorAdr0448.test.ts` — 31 케이스
  - ENV gate 6
  - 결정 트리 11 (SELL_ONLY / LUNCH_BREAK / DATA_STARVED / FrozenQuote STALE /
    SectorEnergy BLOCKED / shadowObservableExists / providerDegraded / TRUE_GATE1_ZERO /
    R6_DEFENSE / VIX_BLOCK / FOMC_BLOCK)
  - 불변식 5 (liveBlockPreserved literal × 6 / streakImpact 0 또는 1 / 우선순위 ENV
    최우선 / ADR-0419 우선 / shadowObservable > sectorEnergy / sectorEnergy > provider)
  - formatCompactLine 5 (4 cause × tail 분기 / `<b>` 부재)
- `server/telegram/commands/system/scanBlockersAdr0448.test.ts` — 25 케이스
  - SectorEnergy execution impact wiring 5
  - R3 Noise wiring (scanDiagnostics) 5
  - 절대 불변식 (LIVE 차단 전파 0) 9 (5 KIS 함수 + autoTradeEngine + orderExecutor +
    trancheExecutor + setGateThreshold/GATE_RELAX/STRONG_BUY_OVERRIDE / fetch / axios)
  - HTML 안전 1

### 인접 회귀
- `server/clients/sectorEnergy*` 무회귀 (sectorScoreBoost / sectorEnergyStrongBuyGate
  / sectorEnergyQualityDiagnostic 본체 변경 0).
- `server/trading/signalScanner/r3*` 무회귀 (r3StreakSkipPolicy / r3ViolationStateMachine
  본체 변경 0).
- `server/trading/signalScanner/scanDiagnostics` 무회귀 (`r3StreakSkipped` / R3 streak
  state machine wiring 그대로, ADR-0448 추가 분기만).
- counterfactual universe learning / gate eligibility / adaptive scheduler 무영향.

### 검증
```
npm run lint
npm run validate:all
ALLOW_DEPLOY_WINDOW=1 npm run precommit
npx vitest run server/clients/sectorEnergyExecutionImpactAdr0448.test.ts \
              server/trading/signalScanner/r3NoiseGovernorAdr0448.test.ts \
              server/telegram/commands/system/scanBlockersAdr0448.test.ts
```

## 12. 기대 동작 (배포 직후)

운영 시나리오 (사용자 보고 정확 재현):

**Before**:
```
SectorEnergy STALE / DEGRADED / leadershipConfidence BLOCKED
→ R3 streak 누적 → SHADOW_ONLY pre-scan abort
→ buyList 루프 미진입 → 실매매 후보 평가 중단
→ 운영자 진단: 왜 멈췄는지 즉시 인지 불가
```

**After (ADR-0448 Phase 0 적용)**:
```
SectorEnergy STALE / DEGRADED / leadershipConfidence BLOCKED
→ R3 Noise Governor: cause SECTOR_ENERGY_DIAGNOSTIC_BLOCKED · streakImpact=0
→ R3 streak 누적 차단 → SHADOW_ONLY pre-scan 미발동
→ buyList 루프 정상 진입
→ Core Signals (가격/거래량/추세/리스크) 기반 BUY/HOLD 평가 계속
→ STRONG_BUY 만 차단 (sectorBoost=0 + STRONG_BUY blocked)
→ Shadow / counterfactual learning 계속
→ /scan_blockers 운영자 인지: "execution HARD_BLOCK=no"
```

핵심 결과: **나쁜 보조 데이터 때문에 매매엔진이 멈추지 않는다**.
