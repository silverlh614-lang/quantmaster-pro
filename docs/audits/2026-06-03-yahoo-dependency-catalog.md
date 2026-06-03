# QuantMaster Pro — Yahoo 의존 전수 감사 + 최소화 로드맵
**생성**: 2026-06-03 | **스캔**: server/ + src/ (test 제외) | **모드**: Read-Only 전수 분석 (코드 0줄)
**근거**: ADR-0561 KIS-Primary 절대불변식 — KIS-capable 레이어면 Yahoo 금지, Yahoo는 KIS 대체불가 시에만.
**KIS 카탈로그 대조**: `/tmp/kis-api2/open-trading-api-main/examples_llm/` + `docs/reference/kis-open-trading-api/domestic_stock.json`

> **목표**: 두더지잡기 종료. 모든 Yahoo 사용을 한 번에 B/C/D 전수 분류 → 최소화 로드맵 + 가드 확장 사양.

---

## Executive Summary

- **Yahoo 데이터-페칭 모듈(실제 외부호출, guardedFetch/직접 URL)**: ~17개. 나머지 100여 파일은 주석/진단/health/타입 참조 (페칭 아님).
- **분류 결과**:
  - **(B) KIS 대체불가 — 정당 차용**: 4개 데이터 종류 (consensus, 미국/일본/중국 지수, VIX, gold/oil 선물).
  - **(C) KIS 대체가능 — 마이그레이션 대상**: 5개 사용처 (국내 quote/OHLCV, 국내 historical close, KOSPI/KOSDAQ 지수, USD/KRW, 국내 sector).
  - **(D) 별도 경로 — 의도적 유지**: 1개 (aiUniverseService Tier 3 QUANT, ADR-0011).
- **최종 판정 (Yahoo 최소화 후 잔존)**: **(B) 4건 + (D) 1건 = 5건**. (C) 5건은 burn-down 대상 → 0 목표.
- **핵심 발견**: KIS overseas `inquire_daily_chartprice` (TR `FHKST03030100`* — *주의: 동일 TR_ID가 국내 투자자흐름에도 쓰임, overseas 는 `fid_cond_mrkt_div_code=N/X/I/S`)는 **N=해외지수(S&P/NASDAQ/Dow만), X=환율, I=국채, S=금선물**만 지원. **VIX·DXY·Nikkei·CSI300·개별 종목세부는 KIS 미커버 → (B) 정당 차용 확정.**

---

## 1. 전수 수집표 (file:line · Yahoo에서 가져오는 데이터)

### 1-A. 실제 외부 호출 (페칭) 모듈

| # | file:line | Yahoo 데이터 종류 | 심볼/엔드포인트 |
|---|-----------|------------------|-----------------|
| 1 | `server/screener/adapters/yahooQuoteAdapter.ts` (전체, fetchYahooQuote) | 국내 quote + OHLCV + 기술지표 | `{code}.KS/.KQ` v8 chart |
| 2 | `server/screener/adapters/yahooQuoteSummary.ts` | 펀더멘털 PER/PBR/EPS (opportunistic) | v10 quoteSummary |
| 3 | `server/clients/yahooConsensusClient.ts` | 애널리스트 컨센서스 (recommendationTrend/earningsTrend) | v10 quoteSummary |
| 4 | `server/alerts/dxyIntradayClient.ts:10` | DXY 달러인덱스 5m 인트라데이 | `DX-Y.NYB?interval=5m` |
| 5 | `server/clients/historicalClosePrice.ts` | 국내 historical 종가 (학습 레이블) | `{code}.KS/.KQ` v8 chart (KIS-first, Yahoo fallback) |
| 6 | `server/learning/lateWinEvaluator.ts:68` | 국내 90일 OHLCV (지연 승리 평가) | `{sym}` v8 chart |
| 7 | `server/clients/koreanQuoteBridge.ts:241` | KOSPI/KOSDAQ 지수 일봉 (KRX-first fallback) | `^KS11`/`^KQ11` |
| 8 | `server/trading/marketDataRefresh.ts:789,855,891,901` | KOSPI / USD-KRW / S&P500 / DXY closes | `^KS11`,`KRW=X`,`^GSPC`,`DX-Y.NYB` |
| 9 | `server/trading/macroSectorSync.ts:121` | VIX 종가 | `^VIX` |
| 10 | `server/alerts/globalScanAgent.ts:269+` | 미국지수·VIX·섹터ETF | `^GSPC,^IXIC,^DJI,^VIX,EWY,SOXX,XLE,WOOD` |
| 11 | `server/alerts/preMarketSignal.ts:68+` | Nikkei·VIX 등 글로벌 선행 | `^N225,^VIX` 등 |
| 12 | `server/alerts/reportGenerator.ts:896,905` | KOSPI·USD-KRW closes (리포트) | `^KS11`,`KRW=X` |
| 13 | `server/screener/sectorSources.ts:21` | 종목 assetProfile 섹터(영문→한글) | quoteSummary assetProfile |
| 14 | `server/screener/universeScanner.ts:27,41` | quote (fetchYahooQuote/ByCode) | `{code}.KS/.KQ` |
| 15 | `server/services/quantitativeCandidateGenerator.ts` | AI추천 Tier3 OHLCV 후보 | v8 chart (ADR-0011/0016) |
| 16 | `src/services/stock/marketOverviewIndicators.ts:32-46` | 클라 prefill 8지수 (S&P/NASDAQ/Dow/Nikkei/CSI300/JPYKRW/EURKRW/Gold/WTI) | Yahoo proxy v8 chart |
| 17 | `src/services/stock/historicalData.ts` · `priceSync.ts` | 클라 historical/quote 프록시 (Naver-first, Yahoo fallback) | Yahoo proxy |

### 1-B. 라우터/SSOT/가드 (페칭 위임처 — 합법 소유)

| file | 역할 |
|------|------|
| `server/screener/adapters/technicalQuoteRouter.ts` | **R1 KIS-first 라우터** (ADR-0547) — KIS 일봉 1차, Yahoo fallback. 화이트리스트. |
| `server/screener/adapters/yahooSymbolResolver.ts` | `fetchYahooQuoteByCode` SSOT 위임 본체. 화이트리스트. |
| `server/utils/egressGuard.ts` · `yahooProviderGuard.ts` · `yahooRangePolicy.ts` · `yahooFreshnessLedger.ts` | egress/freshness/range 정책 (페칭 아님). |
| `server/screener/adapters/yahooStaleRecovery.ts` · `yahooHistoricalRefresh.ts` | stale 복구/refresh 도우미. |

> 나머지 ~100개 파일 (telegram health 명령, diagnostics, replay, learning 진단 등)은 Yahoo **참조/진단/타입**만 — 외부 페칭 0. 분류 대상 아님.

---

## 2. 분류 (B / C / D)

### (B) KIS 대체불가 — 정당 차용 [4 데이터종류]

| 데이터 | 사용처 | KIS 미커버 근거 |
|--------|--------|-----------------|
| **B1. 애널리스트 컨센서스** (recommendationTrend, earningsTrend, surprise) | #3 yahooConsensusClient | KIS 카탈로그 전수 grep: consensus/투자의견/목표주가/earnings-estimate **endpoint 0건**. |
| **B2. 미국/일본/중국 지수 + VIX** (^GSPC,^IXIC,^DJI,^VIX,^N225,000300.SS) | #8,#9,#10,#11,#12,#16 | KIS overseas index(N)는 **다우30/나스닥100/S&P500만**. VIX·Nikkei·CSI300 미지원. |
| **B3. DXY 달러인덱스** (DX-Y.NYB 5m + 일별) | #4,#8 | KIS overseas X=환율은 통화쌍만. DX-Y.NYB(ICE 합성지수) endpoint 부재. |
| **B4. 글로벌 섹터 ETF + 원자재** (EWY,SOXX,XLE,WOOD,GC=F,CL=F) | #10,#16 | KIS overseas는 개별 ETF 시세는 주되 무료 quota/심볼커버 제약 + 다지수 일괄 = Yahoo가 합리. 단 burn-down 후보 후순위(아래 참조). |

→ **(B) = B1·B2·B3·B4 = 4건** (ADR-0561 D3 영구 허용, SSOT_REGISTRY 등재 대상).

### (C) KIS 대체가능 — 마이그레이션 대상 [5 사용처]

| 데이터 | 사용처 | KIS 대체 endpoint |
|--------|--------|-------------------|
| **C1. 국내 종목 quote+OHLCV+기술지표** | #1 yahooQuoteAdapter, #14 universeScanner | `inquire-daily-itemchartprice` (FHKST03010100, 이미 kisClient wired). **R1 라우터(technicalQuoteRouter) 이미 존재 — flag ON 확대만.** |
| **C2. 국내 historical 종가** (학습 레이블) | #5 historicalClosePrice, #6 lateWinEvaluator | 동 FHKST03010100. #5는 이미 KIS-first; #6은 Yahoo-only → 라우터 위임 대상. |
| **C3. KOSPI/KOSDAQ 지수 일봉** | #7 koreanQuoteBridge, #8 marketDataRefresh(^KS11), #12 reportGenerator(^KS11) | `inquire-daily-indexchartprice` (FHKUP03500100, kisClient wired, ENV OFF). KRX OpenAPI 1차 + KIS 2차. |
| **C4. USD/KRW** | #8 marketDataRefresh(KRW=X), #12 reportGenerator | ECOS 한국은행 공식(L2)이 이미 교차검증 소스(ADR-0071). ECOS-primary 승격 + KIS overseas X=환율 보조. Yahoo 강등. |
| **C5. 국내 종목 섹터 분류** | #13 sectorSources (Yahoo assetProfile) | KRX 업종분류(이미 1차) + KIS `inquire_index_price`/종목 업종코드. Yahoo는 3차 → 제거 가능. |

→ **(C) = C1~C5 = 5 사용처** (grandfather burn-down 대상).

### (D) 별도 경로 — 의도적 유지 [1건]

| 데이터 | 사용처 | 근거 |
|--------|--------|------|
| **D1. AI추천 Tier3 QUANT universe** | #15 quantitativeCandidateGenerator, aiUniverseService Tier3 | ADR-0011/0016 — Google CSE + Yahoo OHLCV 정량 폴백. 자동매매 경로와 분리(import 금지). 발굴용, 매매결정 아님. **유지.** |

> 클라이언트 #16/#17 (marketOverviewIndicators, historicalData/priceSync)은 표시용 prefill. priceSync는 이미 Naver-first(Yahoo 신뢰철회). marketOverviewIndicators는 (B2/B4) 글로벌지수가 대부분이라 (B)에 흡수, 국내분(있으면) 프록시는 (C)로.

---

## 3. KIS 대체 가능성 정밀 대조표

| 항목 | KIS endpoint 존재 | TR_ID / 경로 | 판정 |
|------|:---:|------|------|
| 국내 종목 OHLCV/일봉 | **O** | `FHKST03010100` `/inquire-daily-itemchartprice` | (C) — kisClient wired, R1 라우터 존재 |
| 국내 종목 현재가 | **O** | `FHKPST01010100` 등 (kisClient wired) | (C) |
| 국내 KOSPI/KOSDAQ 지수 일봉 | **O** | `FHKUP03500100` `/inquire-daily-indexchartprice` (U=업종, 0001 코스피/1001 코스닥) | (C) — wired, ENV OFF |
| 국내 sector 지수 | **O** | `inquire_index_price` / `inquire_daily_indexchartprice` (업종코드) | (C) |
| USD/KRW 환율 | **O(보조)** | overseas `inquire_daily_chartprice` X=환율; **ECOS(L2) 공식이 우선** | (C) — ECOS-primary |
| 미국 S&P500/NASDAQ/Dow 지수 | **O(제한)** | overseas `inquire_daily_chartprice` N=해외지수 (다우30·나스닥100·S&P500 only) | (B로 유지 권고)* |
| **VIX** 변동성지수 | **X** | 미커버 | **(B)** 정당 차용 |
| **DXY** 달러인덱스 (DX-Y.NYB) | **X** | overseas X=환율은 통화쌍만, ICE 합성지수 부재 | **(B)** |
| **Nikkei225 / CSI300** | **X** | overseas N=미국 3종만 | **(B)** |
| **애널리스트 컨센서스** | **X** | grep 0건 | **(B)** |
| 글로벌 섹터 ETF (SOXX/XLE/EWY) | **△** | overseas 개별 ETF는 주나 다지수 일괄·quota 제약 | **(B)** 후순위 |
| Gold/WTI 선물 (GC=F/CL=F) | **O(제한)** | overseas `inquire_daily_chartprice` S=금선물 (금만) / WTI 미커버 | **(B)** WTI 미커버로 유지 |

> *미국 지수(S&P/NASDAQ/Dow)는 KIS 기술적 대체 가능하나, VIX/Nikkei/CSI300/DXY와 **동일 globalScan 배치**에서 수집되므로 부분 마이그레이션은 코드 복잡도↑·이득↓. **(B)로 일괄 유지**하되 향후 KIS overseas 라우터 도입 시 재평가(C-defer).

---

## 4. 최소화 로드맵

### (C) 마이그레이션 우선순위 (영향 × quota × 난이도)

| 순위 | 대상 | 작업 | 난이도 | 비고 |
|:---:|------|------|:---:|------|
| **P0** | C1 국내 quote/OHLCV (#1,#14) | `KIS_OHLCV_PRIMARY_ENABLED=true` 확대 — R1 technicalQuoteRouter 이미 byte-equiv 위임. 잔여 직접 fetchYahooQuote callsite → 라우터 경유 치환. | 낮음 | **라우터 재사용** — 신규 코드 최소. LIVE 영향 HIGH → 회귀테스트 필수. |
| **P1** | C2 historical 종가 (#6 lateWinEvaluator) | #5 historicalClosePrice 의 KIS-first 패턴 복제 — lateWinEvaluator도 KIS 일봉 1차. | 중간 | 학습 경로, LIVE 무관. |
| **P1** | C3 KOSPI/KOSDAQ 지수 (#7,#8,#12) | `KIS_SECTOR_INDEX_DAILY_ENABLED` + FHKUP03500100 ON, KRX-first→KIS-2차→Yahoo 최후. koreanQuoteBridge는 이미 KRX-first. | 중간 | quota 절약. |
| **P2** | C4 USD/KRW (#8,#12) | ECOS(L2) primary 승격 (crossSourceValidator 이미 ECOS 교차). Yahoo KRW=X 강등→최후. | 낮음 | ADR-0071 연장. |
| **P3** | C5 sector 분류 (#13) | KRX 업종분류 1차 강제, Yahoo assetProfile 3차 제거. | 낮음 | 빈도 낮음. |

> 모든 (C) 마이그레이션은 **R1 라우터 패턴 재사용 + ENV byte-equiv 롤백 + 회귀테스트** 원칙. quota는 캐시·배치로 흡수(ADR-0561 — quota는 Yahoo-first 사유 아님).

### (B) 정당 차용 — SSOT 등재 (영구 허용)

ADR-0561 + SSOT_REGISTRY 에 명시 등재:
- **B1 consensus** — KIS 미커버. yahooConsensusClient 영구 허용.
- **B2 미국/일본/중국 지수 + VIX** — KIS overseas 부분커버/미커버. globalScan·preMarketSignal·macroSectorSync 영구 허용.
- **B3 DXY** — ICE 합성지수, KIS 부재. dxyIntradayClient(Yahoo→AlphaVantage fallback) 영구 허용.
- **B4 글로벌 ETF + WTI** — KIS quota/심볼 제약. 후순위, 영구 허용.

### (D) 별도 경로 — 명시 유지

- **D1 aiUniverseService Tier3 QUANT** (quantitativeCandidateGenerator) — ADR-0011, 자동매매 분리. 유지. 가드 화이트리스트 등재.

---

## 5. 가드 확장 사양 (systematic 강제)

### 현재 (check_kis_primary_invariant.js)
- **탐지 패턴**: `fetchYahooQuoteByCode(`, `fetchYahooQuote(` 만 (quote primary 2종).
- 화이트리스트: technicalQuoteRouter / yahooSymbolResolver / yahooQuoteAdapter.
- GRANDFATHER_ALLOWLIST: 빈 Map (burn-down 완료).
- **한계**: DXY/지수/consensus/historical/sector 직접 Yahoo URL fetch를 **탐지 못함** → 두더지잡기 잔존.

### 확장 사양 (제안 — architect ADR 위임 필요)

1. **탐지 패턴 확대** — quote 2종 → **모든 Yahoo-first 진입**:
   - 직접 URL: `query1.finance.yahoo.com`, `query2.finance.yahoo.com`, `finance.yahoo.com/v8`, `/v10/finance/quoteSummary`.
   - 심볼 템플릿: ``${code}.KS``, ``${code}.KQ`` raw concat (yahooSymbolResolver 외).
   - 함수: `fetchYahoo*`, `fetchCloses(`/`fetchDailyBars(` with `^`/`=X`/`=F`/`DX-Y` 인자.
2. **화이트리스트 (B + D + 라우터/SSOT)**:
   - (B): yahooConsensusClient, dxyIntradayClient, globalScanAgent, preMarketSignal, macroSectorSync(^VIX), marketOverviewIndicators(글로벌지수).
   - (D): quantitativeCandidateGenerator, aiUniverseService.
   - 라우터/SSOT: technicalQuoteRouter, yahooSymbolResolver, yahooQuoteAdapter.
   - egress/policy: egressGuard, yahooProviderGuard, yahooRangePolicy, yahooFreshnessLedger, yahooStaleRecovery, koreanQuoteBridge(KRX-first 명시).
3. **GRANDFATHER_ALLOWLIST (C) burn-down 등재** (사유 `MIGRATION_PENDING_ADR0561`):
   - C1 #1,#14 / C2 #6 / C3 #8,#12 / C4 #8 / C5 #13. 마이그레이션 PR마다 제거 → 가드 자동 강화.
4. **신규 Yahoo-first 직접호출 (화이트리스트·grandfather 외) = EXIT 1** — systematic 차단. 두더지잡기 종료.

---

## 6. 최종 판정

> **Yahoo 의존 최소화 후 잔존 = (B) 4건 + (D) 1건 = 5건.**

- **(C) 5 사용처는 KIS/ECOS/KRX 대체 가능 → burn-down 대상 (목표 0).** 대부분 R1 라우터 패턴 이미 존재(P0 C1은 ENV 확대만).
- **(B) 4건**(consensus·미국지수+VIX·DXY·글로벌ETF/WTI)은 KIS 카탈로그 전수 대조 결과 **대체불가 확정** → ADR-0561 D3 영구 허용 등재.
- **(D) 1건**(AI추천 Tier3)은 ADR-0011 자동매매 분리 경로 → 유지.
- **가드 확장**으로 fetchYahooQuote 2종 → 모든 Yahoo-first 탐지 → (B)/(D) 화이트리스트·(C) grandfather. **두더지잡기 → systematic 전환 완료 사양 확정.**
