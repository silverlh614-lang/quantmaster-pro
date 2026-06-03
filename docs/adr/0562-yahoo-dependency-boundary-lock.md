# ADR-0562 — Yahoo(L3) Dependency Boundary Lock: 영구 차용 5건 잠금 + 가드 전수 탐지 확장

> 상태: Accepted (문서/ADR/CLAUDE.md/charter/가드사양 전용 — 런타임 `.ts` 0줄, ENV flag 변경 0).
> 정식 발급 번호 `0562` — 출처: `docs/adr/INDEX.md` §"다음 발급: 0562" (2026-06-03, 마지막 발급 0561).
> 작성: 2026-06-03 / architect
> 분류 SSOT: `docs/audits/2026-06-03-yahoo-dependency-catalog.md` (전수 감사 B/C/D + KIS 대체표).
> 동반 산출물: `_workspace/2026-06-03_yahoo-boundary-lock/architect/` 메모.
> 가드 확장 *구현*은 후속 engine-dev (본 ADR은 경계 확정 + 가드 *사양*만 정의).

---

## Context

ADR-0561 은 **KIS(L1) Primary 절대불변식**("KIS-capable 레이어에서 Yahoo(L3)-first 금지,
Yahoo 는 KIS 대체불가 시에만 최후 fallback")을 §2.3 데이터 신뢰 위계의 엄격·절대 형태로 코드화했다.
그러나 ADR-0561 의 가드 사양·구현(`check_kis_primary_invariant.js`)은 **quote primary 2종
(`fetchYahooQuoteByCode` / `fetchYahooQuote`)만 탐지**한다. 그 2종은 C1(국내 quote/OHLCV)
burn-down 이 완료되어 GRANDFATHER_ALLOWLIST 가 비어 있다.

**문제 — 두더지잡기(whack-a-mole)가 끝나지 않았다.** 전수 감사
(`docs/audits/2026-06-03-yahoo-dependency-catalog.md`)가 확인한 현실:

- 현 가드는 `fetchYahooQuote*` 2종만 본다. 그러나 **나머지 Yahoo-first 진입은 함수명이 아니라
  직접 URL(`query1/query2.finance.yahoo.com`)·`.KS`/`.KQ` raw concat·`fetchCloses('^...')`·
  Yahoo client 직접호출**로 들어온다. 가드 사각지대.
- 사각지대의 산 증거 (현 가드 EXIT 0 통과하지만 실제 Yahoo-first):
  - `server/learning/lateWinEvaluator.ts:68` — `query2.finance.yahoo.com/v8/.../${sym}.KS` 직접 URL (국내 90일 OHLCV).
  - `server/clients/historicalClosePrice.ts:65` — 동일 직접 URL (국내 historical 종가, KIS-first fallback).
  - `server/clients/koreanQuoteBridge.ts:142` — `.KS`/`.KQ` Yahoo chart fallback (KOSPI/KOSDAQ 지수).
  - `server/screener/sectorSources.ts:272` — Yahoo `assetProfile` 직접 fetch (국내 섹터).
  - `server/alerts/reportGenerator.ts:896,905` — `fetchCloses('^KS11')` / `fetchCloses('KRW=X')` (국내 지수·환율).
  - `server/trading/marketDataRefresh.ts:855` — `fetchCloses('KRW=X', ...)` (USD/KRW).
  - `server/trading/exitEngine/helpers/priceHistory.ts:29` · `ma60.ts:42` — `fetchCloses(sym, ...)` 가
    국내 포지션 종목(`.KS`/`.KQ` candidates)의 종가를 **exit 결정에 공급** (catalog 미포착, LIVE exit 경로).
- 신규 PR 이 새 `query1.finance.yahoo.com` 직접 호출을 추가해도 현 가드는 **차단하지 못한다** → drift 재발.

이 ADR 은 전수 감사 결과를 **경계로 명문화**하여 (B/D 영구 정당 차용 5건 잠금, C burn-down 추적)
두더지잡기를 systematic 경계 잠금으로 전환한다. 동시에 ADR-0561 가드를 **모든 Yahoo-first 진입**
탐지로 확장하는 사양을 채택한다.

### 제약 (불변식 정합)

- 본 ADR 은 **문서/정책 선언**이며 런타임 동작을 바꾸지 않는다 (executionImpact=NONE).
- 9대 불변식(§2.1) VERBATIM 0줄 변경 — 본 경계는 §2.3 데이터 신뢰 절대규칙(ADR-0561) 확장.
- ADR-0561 의 D1~D4 (절대불변식·quota 엔지니어링·진짜 대체불가만·가드 사양)를 **계승·강화**한다.
  무효화 0. 본 ADR 은 그 가드의 탐지 범위만 확장하고 B/D 정당 차용 경계를 확정한다.

## Decision

### D1 — (B)+(D) = 5건 영구 정당 차용 잠금 (KIS 미커버 사유 명시)

전수 감사 결과 **KIS 카탈로그 대조로 대체불가가 확정된 5건**을 ADR-0561 D3 정당경계로 영구 등재한다
(재논의 종료). 각 항목의 KIS 미커버 근거:

| # | 데이터 | 사용처(owner) | KIS 미커버 근거 (catalog §3 대조) |
|---|--------|---------------|-----------------------------------|
| **B1** | 애널리스트 컨센서스 (recommendationTrend/earningsTrend/surprise) | `server/clients/yahooConsensusClient.ts` | KIS 카탈로그 전수 grep: consensus/투자의견/목표주가/earnings-estimate **endpoint 0건**. |
| **B2** | 미국/일본/중국 지수 + VIX (`^GSPC`,`^IXIC`,`^DJI`,`^N225`,`000300.SS`,`^VIX`) | `globalScanAgent.ts`, `preMarketSignal.ts`, `macroSectorSync.ts`(`^VIX`), `marketOverviewIndicators.ts`(클라 prefill) | KIS overseas `inquire_daily_chartprice` N=해외지수는 **다우30/나스닥100/S&P500만**. VIX·Nikkei·CSI300 미지원(공식 확인). |
| **B3** | DXY 달러인덱스 (`DX-Y.NYB` 5m + 일별) | `server/alerts/dxyIntradayClient.ts`, `dxyMonitor.ts` | overseas X=환율은 통화쌍만. DX-Y.NYB(ICE 합성지수) endpoint 부재. |
| **B4** | 글로벌 섹터 ETF + WTI 선물 (`EWY`,`SOXX`,`XLE`,`WOOD`,`ITA`,`GC=F`,`CL=F`,`ES=F`,`NQ=F`) | `globalScanAgent.ts`, `preMarketSignal.ts`, `marketOverviewIndicators.ts` | overseas S=금선물은 금만 → **WTI(CL=F) 미커버**. 다지수 일괄·심볼커버 제약. |
| **D1** | AI추천 Tier3 QUANT universe OHLCV | `server/services/quantitativeCandidateGenerator.ts`, `aiUniverseService` Tier3 | ADR-0011/0016 — Google CSE + Yahoo 정량 폴백. 자동매매 경로 import 금지(분리). 발굴용, 매매결정 아님. |

→ **(B) 4 + (D) 1 = 5건 = Yahoo 최소화 최종상태**. 이 5건은 가드 **WHITELIST(영구)** 에 사유 주석과
함께 등재한다 (D3). 신규 *유사* Yahoo 도입은 진짜 대체불가 입증 없이는 차단(WHITELIST 자동 통과 아님).

### D2 — (C) = 5 사용처 burn-down 대상 (목표 0)

KIS/ECOS/KRX 로 대체 가능한 **국내 데이터 5종**은 grandfather → burn-down 한다 (목표 잔존 0):

| # | 데이터 | 현 사용처(file:line) | KIS/ECOS/KRX 대체 | burn-down P |
|---|--------|----------------------|-------------------|:---:|
| **C1** | 국내 quote+OHLCV+기술지표 | `yahooQuoteAdapter.ts`, `universeScanner.ts` | `FHKST03010100` (kisClient wired, R1 technicalQuoteRouter 존재) | P0 — ENV 확대 |
| **C2** | 국내 historical 종가 (학습/exit) | `lateWinEvaluator.ts:68`, `historicalClosePrice.ts:65`(KIS-first), `exitEngine/helpers/priceHistory.ts:29`, `ma60.ts:42` | 동 `FHKST03010100` | P1 |
| **C3** | KOSPI/KOSDAQ 지수 일봉 | `koreanQuoteBridge.ts:142`, `marketDataRefresh.ts`(`fetchCloses('^KS11')`), `reportGenerator.ts:896` | `FHKUP03500100` (wired, ENV OFF); KRX-first→KIS-2차 | P1 |
| **C4** | USD/KRW | `marketDataRefresh.ts:855`(`KRW=X`), `reportGenerator.ts:905` | ECOS(L2) 공식 primary 승격(ADR-0071), KIS overseas X 보조 | P2 |
| **C5** | 국내 섹터 분류 | `sectorSources.ts:272` (Yahoo `assetProfile`) | KRX 업종분류 1차 + KIS 업종코드, Yahoo 3차 제거 | P3 |

→ **(C) 5 사용처는 가드 GRANDFATHER_ALLOWLIST 에 사유 `MIGRATION_PENDING_ADR0561` 로 등재**.
각 마이그레이션 PR 마다 해당 file:line 을 allowlist 에서 제거 → 가드 자동 강화 (D3).

> **catalog 대비 추가 발견 — C2 확대:** catalog C2 는 lateWinEvaluator 만 열거했으나, 전수 grep 결과
> `exitEngine/helpers/priceHistory.ts`·`ma60.ts` 가 `fetchCloses(sym)` 로 **국내 포지션 종목의 종가를
> exit 결정에 공급**한다 (LIVE exit 경로). 본 ADR 은 이를 C2 grandfather 에 명시 등재하여
> exit 경로 Yahoo-first 도 burn-down 추적 대상으로 잠근다.

### D3 — 가드 확장 채택 (모든 Yahoo-first 탐지)

ADR-0561 가드(`check_kis_primary_invariant.js`)를 quote 2종 → **모든 Yahoo-first 진입**으로 확장한다.
**통합(신규 분리 아님)** 을 채택한다 — KIS-primary 절대불변식의 단일 가드가 SSOT 이어야 사각지대·
중복 allowlist 가 생기지 않는다(아래 §"가드 확장 사양" 상세). 핵심:

- **탐지 확대**: `fetchYahooQuote*` + 직접 URL `query1/query2.finance.yahoo.com` + `.KS`/`.KQ` raw concat
  + `fetchCloses('^...'|'...=X')` 국내심볼 + Yahoo client 직접호출.
- **WHITELIST(영구)** = D1 의 (B)4+(D)1 owner 파일 + 라우터/SSOT/policy(파일별 사유 주석).
- **GRANDFATHER(burn-down)** = D2 의 (C)5 사용처 file:line, 사유 `MIGRATION_PENDING_ADR0561`.
- WHITELIST·GRANDFATHER 외 신규 Yahoo-first = **EXIT 1**. 두더지잡기 종료.

### D4 — Yahoo 최소화 최종상태 = 5건 (정의 고정)

> **Yahoo 의존 최소화 후 잔존 = (B) 4건 + (D) 1건 = 5건.** (C) 5 사용처는 burn-down 완료 시 0.

이 5건은 KIS 카탈로그 전수 대조로 대체불가 확정 → **재논의 종료**. 잔존 목표치는 5건이며, 가드
GRANDFATHER 가 0 으로 수렴하면 Yahoo 전체 사용처 = WHITELIST 5건 + 라우터/SSOT/policy(페칭 위임처)
뿐이다.

## Consequences

긍정:
- 신규 Yahoo-first 가 **어디서든**(직접 URL·`.KS` concat·`fetchCloses` 국내심볼·client 직접호출) 커밋타임 차단 →
  drift 영구 예방. fetchYahooQuote 2종 한정 사각지대 폐쇄.
- (B)/(D) 5건 재논의 종료 — KIS 미커버 근거가 ADR 에 박제됨 → "왜 여기는 Yahoo?" 반복 질문 종결.
- (C) 5 사용처가 file:line + 사유로 추적 → 마이그레이션 PR 마다 가드 자동 강화(burn-down 가시화).
- exit 경로 Yahoo-first(priceHistory/ma60) 가 처음으로 경계에 등재 → LIVE exit 데이터 출처 추적 가능.

부정/리스크:
- **가드 false positive 리스크** — `fetchCloses` 는 국내(`^KS11`/`KRW=X`/`.KS`)·글로벌(`^GSPC`/`^VIX`) 공용
  함수다. 심볼-인자 기반 분류 필요(국내심볼=위반후보, 글로벌심볼=B whitelist). 변수 인자(`fetchCloses(sym)`)는
  callsite 파일 단위 grandfather 로 처리(아래 사양 §FP). 정밀 사양 미준수 시 오탐 발생.
- **(C) 마이그레이션은 byte-equivalent 아님** — KIS/ECOS/KRX 값은 Yahoo 와 수정주가·소수점·갱신시점이
  다르다. 각 (C) burn-down 은 **shadow A/B + 허용오차 확정 + 회귀 테스트** 후 별도 실행 ADR/패치
  (본 ADR 의 executionImpact=NONE 와 분리). 무차별 전환 금지.

중립:
- 본 ADR executionImpact=NONE(런타임 0줄, ENV 0건). 가드 확장 *구현*(engine-dev)도 NONE
  (정적 텍스트 검사·매매경로 무접촉·KIS/KRX quota 0·신규위반=커밋차단 마찰만). 롤백=가드 패턴/allowlist 복원.
- 9대 불변식 VERBATIM 0줄. ADR-0561 D1~D4 계승(무효화 0).

## Alternatives Considered

1. **현 가드 유지(fetchYahooQuote 2종만)** — 직접 URL·`fetchCloses` 국내심볼·client 직접호출 사각지대
   잔존 → 두더지잡기 지속. 기각(사용자 "영구 종료" 요구 충족 불가).
2. **신규 별도 가드 신설(`check_yahoo_dependency_boundary.js`)** — KIS-primary 불변식이 가드 2개로
   분산 → allowlist 이원화·사각지대 재발·SSOT 깨짐. 기각(D3 통합 채택 — 단일 가드 SSOT).
3. **Yahoo 전면 금지(B/D 예외 0)** — VIX/DXY/Nikkei/CSI300/컨센서스/WTI 가 KIS 미커버라 데이터 공백
   → Gate/regime 입력 손실. ADR-0558 정당경계 패턴 위배. 기각.
4. **(C)까지 본 ADR 에서 마이그레이션 구현** — byte-equal 불가(수정주가 괴리)·shadow A/B 선행 필요·
   Patch Scope Guard 3도메인 한계. 문서/정책과 실행 분리. 기각(각 C 는 별도 실행 ADR).
5. **(B) 미국지수도 KIS 로 마이그레이션(N=다우/나스닥/S&P)** — VIX/Nikkei/CSI300/DXY 와 동일
   globalScan 배치에서 수집되므로 부분 마이그레이션은 코드 복잡도↑·이득↓. (B)로 일괄 유지하되
   향후 KIS overseas 라우터 도입 시 재평가(C-defer). 기각(현 시점).

## 가드 확장 사양 (engine-dev 인수인계)

대상: `scripts/check_kis_primary_invariant.js` **확장**(신규 파일 신설 아님 — D3 통합).
기존 export(`checkFile`/`YAHOO_PRIMARY_PATTERNS`/`WHITELIST`/`GRANDFATHER_ALLOWLIST`/`isDefinitionLine`/
`isCallLine`)는 **시그니처 보존**(테스트 호환). 검증 모델: 텍스트 정규식, AST 미사용
(`check_ssot_drift_registry.js`/`check_ssot_single_funnel.js` 패턴 재사용).

### 1. 탐지 패턴 확대 (DETECTORS)

기존 `YAHOO_PRIMARY_PATTERNS`(`fetchYahooQuoteByCode`/`fetchYahooQuote`)에 더해 다음 탐지기 추가:

| 탐지기 | 정규식 개념 | 비고 |
|--------|-------------|------|
| **D-URL** | `query1.finance.yahoo.com` · `query2.finance.yahoo.com` · `finance.yahoo.com/v8` · `/v10/finance/quoteSummary` | 직접 URL 호출. 가장 흔한 사각지대. |
| **D-SUFFIX** | `` `${...}.KS` `` · `` `${...}.KQ` `` raw template concat (또는 `+ '.KS'`/`+ '.KQ'`) | 국내 Yahoo 심볼 합성. `yahooSymbolResolver`(WHITELIST) 외 발생 = 위반후보. |
| **D-CLOSES-DOMESTIC** | `fetchCloses(` 호출의 **1번째 인자가 국내심볼 리터럴** (`'^KS11'`,`'^KQ11'`,`'KRW=X'`) | 글로벌심볼(`^GSPC`/`^VIX`/`^N225`/`DX-Y...`/`=F`/`EWY` 등)은 **위반 아님**(B whitelist 심볼셋). |
| **D-YAHOO-CLIENT** | `fetchYahooConsensus(` · `fetchYahooIntradayBars(` · `fetchYahooBundle(` · `fetchYahooSector(` 등 Yahoo client 직접호출 심볼 | 정의처(owner 파일)는 WHITELIST 면제, 외부 호출만 검사. |

**심볼 분류 셋 (export 상수)**:
- `DOMESTIC_YAHOO_SYMBOLS = {'^KS11','^KQ11','KRW=X'}` → D-CLOSES-DOMESTIC 위반후보.
- `GLOBAL_WHITELIST_SYMBOLS = {'^GSPC','^IXIC','^DJI','^VIX','^N225','000300.SS','DX-Y.NYB','EWY','SOXX','XLE','WOOD','ITA','GC=F','CL=F','ES=F','NQ=F'}` → B2/B4, 위반 아님.
- 변수 인자(`fetchCloses(sym)`·`fetchCloses(symbol)`) → 리터럴 분류 불가 → **callsite 파일 단위 grandfather/whitelist** 로 처리(§FP).

### 2. WHITELIST (영구 — B + D + 라우터/SSOT/policy)

파일 전체 면제. 각 사유 주석 의무 (`reason` 필드 또는 인접 주석):

**(B) KIS 미커버 영구 차용:**
- `server/clients/yahooConsensusClient.ts` — `B1 컨센서스: KIS 미커버(투자의견/목표주가 endpoint 0).`
- `server/alerts/dxyIntradayClient.ts` — `B3 DXY: DX-Y.NYB ICE 합성지수 KIS 부재.`
- `server/alerts/dxyMonitor.ts` — `B3 DXY 모니터(fetchCloses DX-Y.NYB/EWY).` (단 `KRW=X` 라인은 C4 grandfather — 파일 whitelist 면제이나 burn-down 노트 명시).
- `server/alerts/globalScanAgent.ts` — `B2/B4 미국지수·VIX·글로벌ETF(fetchCloses ^GSPC/^VIX/EWY/SOXX/XLE/WOOD/ITA).`
- `server/alerts/preMarketSignal.ts` — `B2/B4 Nikkei·VIX·선물(^N225/ES=F/NQ=F/^VIX).`
- `server/trading/macroSectorSync.ts` — `B2 VIX(fetchCloses ^VIX).`
- `src/services/stock/marketOverviewIndicators.ts` — `B2/B4 클라 prefill 글로벌 8지수(^GSPC/^N225/CSI300/GC=F/CL=F 등).`

**(D) ADR-0011 별도 경로:**
- `server/services/quantitativeCandidateGenerator.ts` — `D1 AI추천 Tier3 OHLCV(ADR-0011, 자동매매 분리).`
- (aiUniverseService 본체가 직접 Yahoo fetch 시 동일 사유로 추가.)

**라우터/SSOT/policy (페칭 위임처·정책, 기존 WHITELIST 계승):**
- `server/screener/adapters/technicalQuoteRouter.ts` — `R1 KIS-first 라우터 fallback 위치 Yahoo(합법).`
- `server/screener/adapters/yahooSymbolResolver.ts` — `fetchYahooQuoteByCode SSOT 위임 본체.`
- `server/screener/adapters/yahooQuoteAdapter.ts` — `fetchYahooQuote 정의 본체 + per 전용.`
- (선택) `server/utils/egressGuard.ts`·`yahooProviderGuard.ts`·`yahooRangePolicy.ts`·`yahooFreshnessLedger.ts`·
  `yahooStaleRecovery.ts`·`yahooHistoricalRefresh.ts` — `egress/freshness/range policy(페칭 아님)` →
  탐지 패턴 매칭 시에만 등재(불필요하면 미등재).
- `server/trading/marketDataRefresh.ts` — **부분 whitelist 주의:** `fetchCloses` 정의 + 글로벌심볼
  호출(`^GSPC`/`DX-Y.NYB`)은 합법이나 **`fetchCloses('KRW=X')`(C4)는 grandfather** → 파일 whitelist 면제
  대신 **라인 단위 분류** 권장(§FP, marketDataRefresh 는 D-URL 정의처 면제 + KRW=X 라인 grandfather).

### 3. GRANDFATHER_ALLOWLIST (C burn-down — 사유 `MIGRATION_PENDING_ADR0561`)

파일 단위 grandfather(drift_registry 패턴, 줄이동 false-fail 방지). 라인 번호는 burn-down 추적 진단 메타:

| relPath | lines (진단) | C# | 사유 |
|---------|-------------|----|------|
| `server/learning/lateWinEvaluator.ts` | 68 | C2 | `MIGRATION_PENDING_ADR0561` (국내 90일 OHLCV 직접 URL) |
| `server/clients/historicalClosePrice.ts` | 65 | C2 | `MIGRATION_PENDING_ADR0561` (KIS-first 이나 Yahoo fallback URL 잔존) |
| `server/trading/exitEngine/helpers/priceHistory.ts` | 29 | C2 | `MIGRATION_PENDING_ADR0561` (exit 경로 국내 종가 fetchCloses) |
| `server/trading/exitEngine/helpers/ma60.ts` | 42 | C2 | `MIGRATION_PENDING_ADR0561` (exit 경로 MA60 fetchCloses) |
| `server/clients/koreanQuoteBridge.ts` | 142 | C3 | `MIGRATION_PENDING_ADR0561` (KOSPI/KOSDAQ .KS/.KQ fallback) |
| `server/screener/sectorSources.ts` | 272 | C5 | `MIGRATION_PENDING_ADR0561` (Yahoo assetProfile 섹터) |
| `server/alerts/reportGenerator.ts` | 896, 905 | C3/C4 | `MIGRATION_PENDING_ADR0561` (fetchCloses ^KS11 / KRW=X) |
| `server/trading/marketDataRefresh.ts` | 855 | C4 | `MIGRATION_PENDING_ADR0561` (fetchCloses KRW=X) — 동 파일 글로벌심볼·정의는 whitelist |

> C1(`yahooQuoteAdapter`/`universeScanner` 의 `fetchYahooQuote*`)은 ADR-0561 burn-down 완료(기존
> GRANDFATHER 빈 Map). 본 확장에서 C1 은 WHITELIST(라우터/resolver/adapter)로 흡수되어 grandfather 불요.

각 마이그레이션 PR 은 해당 항목을 GRANDFATHER 에서 제거(burn-down) → 가드 자동 강화.

### 4. False Positive 최소화 (§FP)

기존 가드의 `isCommentLine`/`isImportLine`/`isDefinitionLine`/`isCallLine`(문자열 리터럴 밖 검사) 재사용 +
다음 규칙:
- **주석·import·정의·문자열 리터럴 내부** 제외(기존 함수 계승).
- **WHITELIST 파일 전체 면제** — B/D owner·라우터·resolver·adapter·policy.
- **GRANDFATHER 파일 단위 통과** — C 사용처(줄이동 무관 파일 매칭).
- **`fetchCloses` 변수 인자**(`fetchCloses(sym)`/`(symbol)`) → 리터럴 분류 불가 → 해당 callsite 파일이
  WHITELIST(globalScanAgent/preMarketSignal 등 글로벌 전용)면 통과, GRANDFATHER(exitEngine helpers)면
  통과, 그 외 신규 변수-인자 fetchCloses 도메인 호출은 EXIT 1(보수적 — 신규는 명시 분류 강제).
- **GLOBAL_WHITELIST_SYMBOLS 리터럴 인자**는 어느 파일에서도 위반 아님(B2/B4 심볼셋).

### 5. 에러 메시지 필수 포맷

위반 file:line:symbol + `"Yahoo(L3)-first 금지(ADR-0562/0561). KIS(L1) primary
(fetchTechnicalQuote/KIS endpoint)로 전환하거나, KIS 대체불가 입증 후 WHITELIST 등재(B/D),
또는 마이그레이션 진행 중이면 GRANDFATHER_ALLOWLIST(MIGRATION_PENDING_ADR0561) 등재."` 안내.

### 6. 등재 위치 (기존 유지)

`check_kis_primary_invariant.js` 는 이미 `validate:all` 끝 + `precommit` 에
`check_ssot_drift_registry` 인접 등재됨(`package.json`). 확장은 **동일 파일 내부 로직 확장**이므로
package.json 추가 wiring 불요. export 상수(`DOMESTIC_YAHOO_SYMBOLS`/`GLOBAL_WHITELIST_SYMBOLS`/
확장 `WHITELIST`/`GRANDFATHER_ALLOWLIST`)는 `*.test.ts` 잠금 대상.

**입력 계약 요약(engine-dev):** DETECTORS(D-URL/D-SUFFIX/D-CLOSES-DOMESTIC/D-YAHOO-CLIENT) +
DOMESTIC_YAHOO_SYMBOLS/GLOBAL_WHITELIST_SYMBOLS + WHITELIST(B4+D1+라우터/SSOT/policy) +
GRANDFATHER_ALLOWLIST(C 8 file:line, MIGRATION_PENDING_ADR0561). 가드 executionImpact=NONE.
롤백=확장분 revert byte-equivalent(기존 2종 탐지로 복귀).

## References

- ADR-0561 (`docs/adr/0561-kis-primary-absolute-invariant.md`) — KIS Primary 절대불변식(D1~D4 계승·강화).
- `docs/audits/2026-06-03-yahoo-dependency-catalog.md` — 전수 감사 분류 SSOT(B/C/D + KIS 대체표 §3).
- ADR-0547 — 기술지표 OHLCV KIS-first 본체(§8 ADR-0561 이 개정), R1 technicalQuoteRouter.
- ADR-0558 — 정당경계(LEGITIMATE non-funnel) 패턴(D1 (B)/(D) 영구 허용 근거).
- ADR-0560 — SSOT drift-prevention registry 정적 가드(가드 확장 패턴 재사용).
- ADR-0011/0016 — aiUniverseService Tier3 자동매매 분리(D1 D-category 근거).
- ADR-0071 — ECOS USD/KRW 교차검증(C4 ECOS-primary 승격 근거).
- 현 가드: `scripts/check_kis_primary_invariant.js`(확장 대상).
- CLAUDE.md §2.3(데이터 신뢰 등급 — KIS Primary Absolute 등재) · §2.2(7대 단일통로).
