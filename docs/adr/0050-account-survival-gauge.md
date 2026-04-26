# ADR-0050 — Account Survival Gauge

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related PRs**: PR-Z2 (Phase 1-2 of UI 재설계 Phase 1)
- **Related ADRs**: ADR-0049 (Context-Adaptive AutoTrade Layout), ADR-0008 (Kelly Time Decay), ADR-0009 (External Call Budget)

## 1. 배경

`AutoTradePage` 의 Hero KPI(매출/포지션/주문/신호) 4-카드는 모두 *기회 지표 (opportunity metrics)* 다. 트레이더가 망하는 이유는 기회를 못 잡아서가 아니라 *생존 지표 (survival metrics)* 를 못 봐서다. 페르소나 SYSTEMATIC ALPHA HUNTER 의 철학 1·2·8 ("필터링 우선 / 생존 가능성 / 손절은 운영비") 핵심.

코드베이스에는 이미 생존 가능성을 측정하는 자산이 분산되어 있지만 UI 단일 위젯으로 통합되어 있지 않다:

- `killSwitch.assessKillSwitch().details.dailyLossPct` + `DAILY_LOSS_LIMIT_PCT` (env 기본 5%) — 일일 손실 한도
- `portfolioRiskEngine.evaluatePortfolioRisk().sectorWeights` — 활성 포지션의 섹터별 비중 (0~1)
- `kellySurfaceMap.computeKellySurface().cells[]` — signalType × regime 별 권고 Kelly (kellyStar)
- `shadowTradeRepo.loadShadowTrades()` 의 `entryKellySnapshot.effectiveKelly` — 진입 시점 Kelly

이를 합성하는 SSOT 가 부재해서 사용자가 "지금 내 계좌가 안전한가?" 라는 단일 질문에 즉답을 받을 수 없다.

## 2. 결정

`AutoTradePage` 최상단에 3개 게이지를 병치한 `<AccountSurvivalGauge>` 카드를 추가한다. 5 컨텍스트 모두에서 priority=1 (PR-Z1 의 ADR-0049 SSOT 위에 올라감). 첫 출시는 **3개 게이지 병치** — 합성 점수(Σ tier × weight 단일 값)는 학습 데이터 누적 후 후속 PR.

### 2.1 SurvivalSnapshot SSOT

```ts
type SurvivalTier = 'OK' | 'WARN' | 'CRITICAL' | 'EMERGENCY';
type SectorTier = 'OK' | 'WARN' | 'CRITICAL' | 'NA';
type KellyTier = 'OK' | 'WARN' | 'CRITICAL' | 'CALIBRATING';

interface SurvivalSnapshot {
  dailyLoss: {
    currentPct: number;       // 절댓값 % (양수 = 손실)
    limitPct: number;         // env DAILY_LOSS_LIMIT_PCT (기본 5)
    bufferPct: number;        // (limit - current) / limit * 100, 0~100 clamp
    tier: SurvivalTier;       // bufferPct ≥ 50 OK / ≥ 25 WARN / > 0 CRITICAL / ≤ 0 EMERGENCY
  };
  sectorConcentration: {
    hhi: number;              // Σ weight² × 10000 (0=완전분산 / 10000=단일섹터 100%)
    topSector: string | null; // 최대 비중 섹터명 (활성 포지션 0건이면 null)
    topWeight: number;        // 최대 비중 (0~1)
    activePositions: number;  // 활성 포지션 수 (분류 입력 기준)
    tier: SectorTier;         // activePositions=0 NA / hhi ≤ 2500 OK / ≤ 4000 WARN / > 4000 CRITICAL
  };
  kellyConcordance: {
    ratio: number | null;     // currentAvgKelly / recommendedKelly (null = CALIBRATING)
    currentAvgKelly: number;  // 활성 포지션 entryKellySnapshot.effectiveKelly 평균
    recommendedKelly: number; // 현재 레짐의 kellySurface cell.kellyStar (signalType=STRONG_BUY 가중)
    sampleSize: number;       // 학습 데이터 표본 수 (수렴 진단)
    tier: KellyTier;          // sampleSize<5 또는 recommendedKelly≤0 CALIBRATING
                              // ratio ≤ 1.0 OK / ≤ 1.5 WARN / > 1.5 CRITICAL (과대 베팅 경고)
  };
  overallTier: SurvivalTier;  // 3개 중 가장 나쁜 tier (max-of-three, NA/CALIBRATING 제외)
  capturedAt: string;         // ISO 시각
}
```

### 2.2 임계값 SSOT

| 게이지 | OK | WARN | CRITICAL | EMERGENCY |
|--------|-----|------|----------|-----------|
| Daily Loss Buffer | bufferPct ≥ 50 | bufferPct ≥ 25 | bufferPct > 0 | bufferPct ≤ 0 |
| Sector HHI (활성 ≥ 1) | hhi ≤ 2500 | hhi ≤ 4000 | hhi > 4000 | — (Sector 는 EMERGENCY 미사용, killSwitch 가 별도 처리) |
| Kelly Ratio (수렴) | ratio ≤ 1.0 | ratio ≤ 1.5 | ratio > 1.5 | — |

**주석**:
- HHI 임계값 (2500/4000): 미국 DOJ 의 시장 집중도 분류 (1500 미만 unconcentrated / 1500~2500 moderate / 2500+ highly concentrated) 와 정합. 자동매매 MAX_SECTOR_WEIGHT 30% 환경에서 단일 섹터 100% 시 HHI=10000.
- Kelly ratio 1.5x: 권고 Kelly 의 1.5배는 "공격적", 2.0x 이상은 "켈리 능선 이탈" — 수학적으로 손실 확률이 비대칭 증가.
- Daily Loss Buffer 25% 임계: 손실 한도 5% 대비 1.25% 손실 = 75% 버퍼 = OK, 2.5% 손실 = 50% 버퍼 = WARN, 3.75% 손실 = 25% 버퍼 = CRITICAL, 5%+ = EMERGENCY.

### 2.3 overallTier 합성 규칙

3개 tier 의 max (worst-of-three). 우선순위:
- EMERGENCY > CRITICAL > WARN > OK
- NA / CALIBRATING 은 합성에서 제외 (활성 포지션 0건이거나 학습 표본 부족 시 다른 게이지로 판정)
- 3개 모두 NA/CALIBRATING 이면 overallTier = OK (안전 기본값 — 노출이 없으니 위험도 없음)

### 2.4 데이터 흐름 (외부 호출 0건)

```
collectSurvivalSnapshot()
  ├─ killSwitch.assessKillSwitch()           → dailyLoss
  ├─ portfolioRiskEngine.evaluatePortfolioRisk()  → sectorWeights (async)
  ├─ kellySurfaceMap.computeKellySurface()   → kellyStar
  ├─ loadShadowTrades() + isOpenShadowStatus  → 활성 entryKellySnapshot 평균
  └─ loadMacroState() + getLiveRegime         → 현재 레짐
```

모두 *기존 영속 데이터* 또는 메모리 state read 만 — KIS / KRX / Yahoo / Gemini 외부 호출 0건. `evaluatePortfolioRisk` 가 내부적으로 `getRealtimePrice` (in-memory ws cache) + `fetchCurrentPrice` (KIS) 를 호출할 수 있으나 이는 *기존* 호출 경로의 재사용일 뿐 본 PR 가 신규로 추가하는 것이 아님. 호출 빈도 통제: 클라이언트는 60s staleTime + retry 2.

### 2.5 신규 모듈

| 파일 | LoC 상한 | 책임 |
|------|---------|------|
| `server/health/survival.ts` | ≤ 200 | `collectSurvivalSnapshot()` SSOT + tier 분류 헬퍼 + HHI 계산 + Kelly 합성 |
| `server/routes/survivalRouter.ts` | ≤ 80 | `GET /api/account/survival` 응답 |
| `src/api/survivalClient.ts` | ≤ 60 | `fetchAccountSurvival()` + 타입 동기 사본 |
| `src/components/autoTrading/AccountSurvivalGauge.tsx` | ≤ 200 | 3 게이지 가로 grid + tier 색상 + skeleton/error |

### 2.6 통합 정책

`AutoTradePage` 변경:
1. `<AutoTradeContextSection id="survival-gauge" priorityByContext={{ PRE_MARKET: 1, LIVE_MARKET: 1, POST_MARKET: 1, OVERNIGHT: 1, WEEKEND_HOLIDAY: 1 }}>` 으로 wrap.
2. `<AutoTradeContextualLayout>` 의 첫 번째 자식으로 배치.
3. 기존 8개 섹션의 priority 무수정 — survival 이 1순위, 나머지가 자연 후순위.

## 3. 검증

### 3.1 자동 검증 (≥ 20 케이스)

- HHI 계산 (4 케이스): 단일 섹터 100% (10000) / 균등 5섹터 (2000) / 빈 입력 (NA tier) / 음수/NaN 안전 fallback
- Daily Loss tier 분기 (4 케이스): bufferPct 75/40/10/-5 → OK/WARN/CRITICAL/EMERGENCY
- Sector tier 분기 (4 케이스): hhi 2000/3000/5000 + activePositions=0 NA
- Kelly tier 분기 (5 케이스): ratio 0.8 OK / 1.3 WARN / 2.0 CRITICAL / sampleSize<5 CALIBRATING / recommendedKelly=0 CALIBRATING
- overallTier 합성 (4 케이스): max-of-three / NA 제외 / 모두 NA → OK / EMERGENCY 우선
- survivalRouter (3 케이스): 정상 응답 / collectSurvivalSnapshot throw → 500 / capturedAt ISO 형식

### 3.2 시각 검증 (DoD)

- AutoTradePage 진입 시 PageHeader 직후 풀폭 카드 1개에 3 게이지 표시
- 5 컨텍스트 모두에서 최상단 (priority=1)
- tier 별 색상 (OK 녹색 / WARN 황색 / CRITICAL 적색 + pulse / EMERGENCY 검정 + 비상정지 권고 / NA·CALIBRATING 회색)

## 4. 영향

### 4.1 영향받는 파일

- 신규: `server/health/survival.ts` + `server/routes/survivalRouter.ts` + `src/api/survivalClient.ts` + `src/components/autoTrading/AccountSurvivalGauge.tsx` + 테스트 파일들
- 수정: `server/index.ts` (+ /api/account 마운트), `src/pages/AutoTradePage.tsx` (1개 섹션 wrap)
- 무수정: 기존 8개 섹션 / killSwitch / portfolioRiskEngine / kellySurfaceMap / shadowTradeRepo / kellyHealthCard

### 4.2 외부 호출 예산

- 신규 외부 호출 0건. evaluatePortfolioRisk 가 호출하는 getRealtimePrice/fetchCurrentPrice 는 기존 자동매매 경로가 이미 매 분 사용 중인 캐시.
- 클라이언트 폴링: 60s staleTime + retry 2 (기존 ApiConnectionLamps 와 동일 정책).
- KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4 준수).

### 4.3 후속 PR

- Phase 1-3 (무효화 조건 미터): 본 PR 의 SurvivalSnapshot 과 별개로 종목별 카드 내부에 InvalidationMeter 추가
- 후속 (peakEquity 영속 추적): 사용자 원안의 "-30% trend death line" 직접 구현 — 본 PR 의 daily loss buffer 위에 30일 drawdown 게이지 추가
- 후속 (합성 점수): 3 게이지 합성 0~100 단일 점수 — 학습 데이터 누적 후

## 5. 결정의 결과

- 사용자가 AutoTradePage 진입 즉시 "지금 안전한가?" 단일 질문에 답을 받음
- 기회 지표 4-카드(Hero KPI) 위에 생존 지표 1-카드를 붙여 페르소나 철학 1·2·8 UI 노출
- 백엔드 자산 재활용으로 새 영속 SSOT 도입 0개 (회귀 위험 격리)
- 후속 PR 들이 본 SurvivalSnapshot 위에 자연 확장 가능
