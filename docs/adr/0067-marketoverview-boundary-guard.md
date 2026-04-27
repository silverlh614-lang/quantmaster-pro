# ADR-0067: marketOverview ↔ 자동매매 경로 boundary 가드

**상태**: Accepted
**날짜**: 2026-04-27
**관련**: ADR-0064 (marketOverview prefill overlay), ADR-0065 (market-indicators disk snapshot), ADR-0066 (marketOverview SWR), 후속 ADR-0068 (자동매매 stale 차단)

---

## 1. 배경

ADR-0064 (PR-α) 가 `getMarketOverview` 의 가격성 데이터 AI 위임을 prefill overlay 로
차단했지만, *분석/서술/예측* 영역 (sectorRotation / dynamicWeights / regimeShiftDetector
/ globalEtfMonitoring / euphoriaSignals / snsSentiment / marketPhase / activeStrategy)
은 여전히 AI 가 추정한다. 이 데이터가 자동매매 결정 (signalScanner / autoTradeEngine
/ entryEngine / preflight) 에 들어가면 AI hallucination 이 LIVE 주문 의사결정을 오염
시킨다.

### 1.1 현재 baseline (조사 결과)

`grep -rn "marketOverview\|MarketOverview" server/` 결과 — **0건**.
자동매매 경로는 `macroState` (`server/persistence/macroStateRepo.ts`) SSOT 만 사용한다.

본 ADR 은 *현재 baseline 을 코드 레벨에서 강제* 한다 — 향후 신규 코드가 무심코
`server/trading/`, `server/orchestrator/`, `server/scheduler/`, `server/services/aiUniverseService.ts`
에서 `marketOverview` / `useMarketData` / `useMarketStore` 를 import 하면 lint 가
자동 차단.

---

## 2. 결정

### 2.1 신규 lint script — `scripts/check_market_overview_boundary.js`

`server/` 전체를 walk 후 `FORBIDDEN_PREFIXES`/`FORBIDDEN_EXACT` 매칭 파일에서
`FORBIDDEN_IMPORT_PATTERNS` (6 패턴) 발견 시 `process.exit(1)`.

### 2.2 차단 경로 SSOT

```
FORBIDDEN_PREFIXES = [
  'server/trading/',
  'server/orchestrator/',
  'server/scheduler/',
];

FORBIDDEN_EXACT = new Set([
  'server/services/aiUniverseService.ts',  // ADR-0011 KIS/KRX 격리
]);
```

`server/services/aiUniverseService.ts` 는 AI 추천 universe 발굴 SSOT 라 marketOverview
와 별개 데이터 소스 (Google CSE / Naver Finance / Yahoo OHLCV) 사용. 본 모듈 import
도 차단해 ADR-0011 격리 정책 일관성 유지.

### 2.3 차단 패턴 SSOT

```
FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"][^'"]*marketOverview['"]/,
  /from\s+['"][^'"]*marketOverviewCache['"]/,
  /from\s+['"][^'"]*marketOverviewIndicators['"]/,
  /from\s+['"][^'"]*useMarketData['"]/,
  /from\s+['"][^'"]*useMarketStore['"]/,
  /import\s*\(\s*['"][^'"]*marketOverview['"]/,  // dynamic import
];
```

주석 라인 (`//` / `*`) 무시 — 의도적 ADR 참조 금지하지 않는다.

### 2.4 정상 호출자 (UI 화이트리스트)

- `src/components/**` (UI 시각화)
- `src/pages/**` (페이지)
- `src/layout/**` (레이아웃)
- `src/hooks/useMarketData.ts` (UI hook)
- `src/stores/useMarketStore.ts` (UI store)
- `src/services/stockService.ts` (barrel)
- `src/services/stock/marketOverview*.ts` (자체 모듈)
- `src/services/stock/momentumRecommendations.ts` (AI 추천 UI)
- `src/services/stock/batchIntel.ts` (UI 데이터 layer, `fetchMarketIndicators` 만)

본 lint 는 `server/` 만 검사 — `src/` 영역 import 는 모두 허용 (UI 정상).

### 2.5 package.json 통합

- `validate:marketOverviewBoundary` 신규 script
- `validate:all` 8종 → 9종 확장
- `precommit` 추가

---

## 3. 자동매매 데이터 SSOT 정책 명문화

자동매매 경로의 시장 데이터 read 는 *반드시* 다음 SSOT 만 사용:

| 영역 | SSOT | 갱신 cron |
|------|------|-----------|
| 거시지표 | `server/persistence/macroStateRepo.ts` (`MACRO_STATE_FILE`) | 다양 (marketDataRefresh / ECOS / FRED / KRX) |
| 회로차단·블랙리스트 | `server/clients/kisClient.ts` 내부 상태 | KIS 응답 자동 갱신 |
| 섹터맵 | `server/persistence/sectorMapStore.ts` | 매주 월 03:00 KST + 평일 04:00 retry |
| 휴장일 | `server/trading/krxHolidays.ts` | 정적 + krxHolidayRepo patch |
| Yahoo health | `server/trading/marketDataRefresh.ts` `getYahooHealthSnapshot()` | 매 분 (cron 누적 통계) |

`marketOverview` (UI) 와 `aiUniverseService` (AI 추천) 는 위 표에 *없음* — 자동매매
참조 금지.

---

## 4. 회귀 위험

본 PR baseline 은 0건 위반. 신규 코드가 자동매매 경로에서 marketOverview import 시도
하면 `npm run validate:marketOverviewBoundary` (또는 precommit) 이 차단. 우회 시도는
`scripts/check_market_overview_boundary.js` 를 수정해야 하므로 명시적 의도 표시.

긴급 우회가 필요한 경우:
1. 본 ADR 갱신 (정책 변경 명문화)
2. lint script 의 `FORBIDDEN_EXACT` / `FORBIDDEN_PREFIXES` 수정
3. 회귀 테스트 추가 (해당 import 의 안전성 검증)

---

## 5. 후속 ADR

- **ADR-0068**: `macroState` 가 24h+ stale 일 때 자동매매 진입 차단 + 운영자 알림
- **ADR-0069**: `X-Field-Stale` 헤더 → 클라이언트 store + UI 배지
- **ADR-0070**: MarketDataHealthScore SSOT — 시장 데이터 전체 품질 점수
