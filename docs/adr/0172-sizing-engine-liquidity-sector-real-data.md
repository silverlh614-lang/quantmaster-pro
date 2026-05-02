---
date: 2026-05-02
status: accepted
related: ADR-0162 (Phase 2-D SHADOW only sizing engine wiring), ADR-0163 (Phase 2-D Extension 3 paths), ADR-0166 (Regime Exposure Budget), ADR-0167 (currentEquityExposureAmount accurate)
---

# ADR-0172 — Position Sizing Engine: 유동성·섹터 실데이터 wiring

## Context

ADR-0162 (Phase 2-D, PR #519) + ADR-0163 (3 진입 경로 확장, PR #520) 이 신규 6 티어 × 7축
사이징 엔진을 4 매수 경로 (메인 buyList / PRE_BREAKOUT_FOLLOWTHROUGH / PRE_BREAKOUT 30% /
INTRADAY_STRONG) 모두에 wiring 했지만 **2 입력 필드를 dummy 값으로 박제**하던 한계 잔존:

```ts
// 4 호출자 모두 동일 패턴
applyPositionSizingEngine(shadowMode, {
  // ...
  marketCap: 1_000_000_000_000_000,        // dummy 큰 수
  avgDailyVolume20d: 1_000_000_000_000_000, // dummy 큰 수
  currentSectorWeight: 0,                   // dummy 0
  // ...
});
```

ADR-0162 §4 명시: *"marketCap/avgDailyVolume20d 미수집 — universe 차단 회피 위해 큰 수 전달.
본 PR scope = 사이징 매트릭스 검증, universe 결합은 후속 PR (preScreenStocks 결과 ctx 노출)"*.

결과: `liquidityAndSectorGuard` (positionSizingEngine 7 axis 중 2개) 감쇄 정책이 **영원히 비활성**
— `liquidityMultiplier=1.0` / `sectorExposureMultiplier=1.0` 으로 평가되어 SHADOW 학습 표본의
*유동성 부족 종목* + *섹터 집중 보유* 두 위험 신호가 가중치 결정에 반영 안 됨.

`reCheckQuote` (Yahoo `vol20dAvg` 이미 산출) + `ctx.shadows` (영속 활성 trade) 양 데이터 모두
호출 시점에 가용함에도 단순 매핑 SSOT 부재로 dummy 값 박제 유지.

## Decision

**유동성·섹터 실데이터 매핑 SSOT** `computeSizingLiquidityInputs(quote, code, sector, shadows)`
헬퍼 신설 (`server/trading/signalScanner/perSymbol/helpers.ts`). 4 호출자 (buyListLoop 3 +
intradayLoop 1) 가 동일 SSOT 사용 — drift 차단.

### 산출 정책 SSOT

**1. `avgDailyVolume20d` (원, 거래대금)**:

- `quote.vol20dAvg × quote.price` (거래량 → 거래대금 환산)
- `vol20dAvg` 는 YahooQuoteExtended 에 이미 계산된 20일 평균 거래량 (주)
- `quote==null` 또는 `vol20dAvg<=0` 또는 `price<=0` → `1_000_000_000_000_000` fallback (universe 차단 회피)

**2. `currentSectorWeight` (0~1)**:

- `sectorConcentrationGate` 와 동일 로직 — `shadows.filter(isOpenShadowStatus)` 기준 활성
  포지션 수 대비 동일 섹터 수의 비율
- `candidateSector = stock.sector ?? getSectorByCode(code) ?? null` 우선순위
- candidateSector 부재 또는 활성 trade 0 → `0` fallback (감쇄 없음)
- `getSectorByCode` 를 양쪽에 적용 — `ServerShadowTrade` 에 sector 직접 영속 부재 보완

### 4 호출자 wiring 패턴

```ts
// PRE_BREAKOUT_FOLLOWTHROUGH (buyListLoop)
const _sizingInputFollow = computeSizingLiquidityInputs(
  reCheckQuoteFollow ?? null, stock.code, stock.sector, ctx.shadows,
);
applyPositionSizingEngine(ctx.shadowMode, {
  // ...
  avgDailyVolume20d: _sizingInputFollow.avgDailyVolume20d,
  currentSectorWeight: _sizingInputFollow.currentSectorWeight,
});
```

**INTRADAY_STRONG 예외**: Yahoo quote 미조회 → `null` 전달, `currentSectorWeight` 만 실데이터
(stock.code + shadows 가용). `avgDailyVolume20d` 은 fallback 큰 수 유지 — INTRADAY 본질이
RRR=0 이라 engine 차단 → legacy quantity fallback 경로라 큰 영향 없음.

### marketCap

본 PR scope 외 — Yahoo Finance chart API 가 `marketCap` 미제공. 후속 PR 에서 KIS 기업 정보 API
(CTPF1002R) 결합 후 실값 전달 예정. dummy 큰 수 유지.

## Consequences

### LIVE 매매 안전성

- **0줄 변경** — 본 PR 은 SHADOW 학습 입력 정확도 격상만, LIVE 본체 무영향
- ADR-0162 4 보호층 그대로 (default OFF + LIVE skip + INPUT_MAPPING_FAILED fallback + legacy)
- ENV `POSITION_SIZING_ENGINE_SHADOW_APPLY=true` 활성 시에만 실데이터 영향

### SHADOW 학습 효과

- **유동성 부족 종목 자동 감쇄** — vol20dAvg 가 작으면 `liquidityMultiplier<1.0` 적용
- **섹터 집중 자동 감쇄** — 동일 섹터 5+ 보유 시 `sectorExposureMultiplier<1.0` 적용
- 본 모듈 결정 quantity 가 SHADOW trade `sizingEngineSnapshot.liquidityMultiplier` /
  `sectorExposureMultiplier` 영속 → 사후 attribution 분석 정확도 ↑

### KIS/KRX 자동매매 quota

- **0 침범** — 절대 규칙 #2/#3/#4 — kisClient/orchestrator/autoTradeEngine 본체 무수정
- `getSectorByCode` 는 영속 sector map (`data/sector-map.json`) read-only — KIS 호출 0건
- `quote.vol20dAvg` 는 reCheckQuote 의 기존 산출값 재사용 — Yahoo 추가 호출 0건

### 회귀 위험 격리

- helpers.ts 의 SSOT 함수 신설 + 4 호출자 인자 매핑만 — 기존 함수 시그니처 무변경
- `computeSizingLiquidityInputs` 자체는 외부 호출 0 (state/persistence read-only)
- ENV default OFF (`POSITION_SIZING_ENGINE_SHADOW_APPLY` 미설정) 시 본 PR 영향 0

## 잘못된 해결 방법 영구 차단

(1) **호출자 측 매핑 인라인 거부** — 4 호출자 동일 산출 식 복제 시 drift 위험 (한 위치만 변경 시
회귀). SSOT 단일 진입점 의무.

(2) **marketCap 본 PR 통합 거부** — Yahoo chart API 미제공이라 KIS 추가 호출 의존.
ADR-0162 §4 명시 후속 PR scope.

(3) **`shadowTradeRepo.sector` 직접 영속 거부** — 본 PR scope 외. `getSectorByCode` fallback
로 조회 시점 충분 (호출 빈도 sizing 결정 시 1회 + sectorConcentrationGate 1회).

(4) **INTRADAY_STRONG 의 Yahoo quote 호출 추가 거부** — INTRADAY 는 KIS 실시간 가격만 사용
(5초 cron, ADR-0058 IntentTag REALTIME). Yahoo 호출 추가 시 회로차단 부담 + 시장 시간 게이트.
`null` 전달로 avgDailyVolume20d fallback 유지.

## 검증

### 테스트

- 신규 `computeSizingLiquidityInputs` 단위 테스트는 후속 PR 분리 (본 PR 은 byte-equivalent
  wiring 만 — 사용자 첨부 지침 정확 적용).
- 4 호출자 wiring 정합성: `helpers.ts` ↔ 사용자 첨부본 byte-equivalent diff 0 / `buyListLoop.ts`
  3 위치 + `intradayLoop.ts` 1 위치 모두 사용자 첨부본 byte-equivalent diff 0.

### 운영 효과

- 다음 SHADOW 매수 시점부터 `sizingEngineSnapshot.liquidityMultiplier` /
  `sectorExposureMultiplier` 가 실데이터 기반 정확값 영속.
- 운영자가 `data/shadow-trades.json` 의 `sizingEngineSnapshot` 영속 조회로 본 모듈 결정의
  유동성·섹터 영향도 직접 추적 가능.

## 후속 PR (scope 외)

- `marketCap` 실데이터 wiring (KIS CTPF1002R 결합) — 7축 중 마지막 dummy 제거
- `computeSizingLiquidityInputs` 단위 테스트 신설 (NaN/0/음수 fallback / 활성 trade 0건 / 다중
  섹터 분포 / vol20dAvg=0 / quote=null 등 분기)
- `ServerShadowTrade.sector` 직접 영속 (PR-Z1 ADR-0060 정합) — `getSectorByCode` fallback 부담 제거
