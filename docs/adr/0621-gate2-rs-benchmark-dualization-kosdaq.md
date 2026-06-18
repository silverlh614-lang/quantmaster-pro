# ADR-0621 — Gate2 RS 벤치마크 이원화 (KOSDAQ 종목 KOSDAQ 벤치마크 채택)

- **Status:** Proposed (Phase 0 — 경계·타입·ADR. flag default OFF byte-equivalent. 구현은 engine-dev 인계.)
- **Date:** 2026-06-16
- **Branch:** `claude/gate2-growth-snapshot-rzifv0`
- **계보:** 0612 / 0616 / 0617 / 0618 (디버전스 편향 문제 계보) · 0561 (KIS Primary Absolute) · 0157 (default OFF) · 0599 / 0600 (flag-gated dry-run·결손 fallback 선례) · 0526 (per-candidate Gate eval SSOT) · 0146 (PR 자가 review)

---

## Context (문제 — 운영 실측 2026-06-16)

코스피 강세(+1.55%) / 코스닥 약세(−1.60%) **디버전스 국면**에서 Gate2 `GATE2_PASS_STRONG` 0건.

`server/quant/gate2ConfluenceScore.ts` 의 `buildRsAxis`(line ~315~395)는 RS 상대강도 축을 산출할 때
fallback 계단의 핵심 분기(`RETURN20D_MINUS_INDEX`, line 360~380)에서 **KOSPI 20일 수익률 단일 벤치마크**
(`indexReturn20d` ← `kospi20dReturn` 만)로 `excess = stockReturn20d − kospi20dReturn` 를 계산한다.

코스닥 종목을 **강한 KOSPI 대비** 재면 초과수익이 구조적으로 압축된다 (코스닥이 −1.6% 빠질 때 코스닥
종목이 시장을 이겨도 KOSPI(+1.55%) 대비로는 음(−)의 excess 가 나오기 쉬움). 그 결과:

- `rsScoreFromExcess(excess)` 가 BULLISH RS(score ≥ 85, excess ≥ +8%p) 도달 불가
- `bullishAxisCount` 가 1 줄어듦
- STRONG 승격 조건(`coverageAdjustedScore ≥ 80 AND bullishAxisCount ≥ requiredConfluenceAxisCount`,
  gate2ConfluenceScore.ts:787) 차단 → 디버전스 장에서 코스닥 주도주가 구조적으로 STRONG 에 못 오름

이는 ADR-0612 / 0616 / 0617 가 진단·완화해 온 "코스닥 편향·코스피 대형주 미발굴" 문제와 동일 계보의
**Gate2 채점 측 잔존 갭**이다. 발굴(0616/0617)은 후보를 풀에 넣어도, Gate2 RS 축이 잘못된 벤치마크로
재단하면 STRONG 승격에서 다시 탈락한다.

---

## Root Cause (근본원인)

1. `buildRsAxis` 의 `RETURN20D_MINUS_INDEX` 분기가 **시장 구분 없이 KOSPI 20일 수익률만** 벤치마크로 사용.
2. 시장별 벤치마크 선택 인프라(`server/clients/benchmarkReturnNormalizer.ts`)는 **이미 완성**돼 있으나
   `gate2Diagnostics` 관측 경로에서만 가동 중이고, **LIVE Gate2 채점 공식(`buildRsAxis`)에 미배선**.
   코드에 갭 명시 주석 존재: `CURRENT_GATE2_FORMULA_STILL_USES_CTX_KOSPI20D_RETURN`,
   `SYMBOL_MARKET_KOSDAQ_BUT_CURRENT_FORMULA_USES_KOSPI_BENCHMARK_FALLBACK`.
3. **Carry 갭(신규 발견·핵심):** `buildRsAxis` 가 소비하는 candidate trace
   (`entryFilterDecomposition.decompositionBuilder.ts` 생산 → `buildGate2ConfluenceSummary` 소비)는
   `kospi20dReturn` 만 carry 하고 `kosdaq20dReturn`·`market` 을 **carry 하지 않는다**. LIVE 스캔 caller
   (`universeScanner.ts`, `stockScreener.ts:700·709`)도 `kospi20dReturn` 만 전달한다.
4. **Source 갭(신규 발견):** `kosdaq20dReturn` (코스닥 지수 20일 수익률) 은 `MacroState`(src/types/core.ts:109
   에 `kospi20dReturn` 만 존재) 및 `indexMacroSections.refreshKospiSection`(KOSPI 만 산출) 어디에도 산출/영속
   되지 않는다. 즉 본 처방은 carry 배선 외에 **upstream source 1건**(KOSDAQ 지수 20d return 산출)을 동반한다.

**결론:** 두 번째 RS 공식 신설 0 · 새 RS 임계 0. `benchmarkReturnNormalizer` 단일 통로 재사용 +
carry 배선 + kosdaq20dReturn source 1건 + flag-gated 정책 변경. ADR-0616 의 "두 번째 RS 공식 신설 금지"
컨벤션 준수.

---

## Decision (처방)

### D1. `benchmarkReturnNormalizer` 단일 통로 재사용 (두 번째 RS 공식 신설 금지)

`buildRsAxis` 의 `RETURN20D_MINUS_INDEX` 분기를, flag ON 시 `normalizeBenchmarkReturnForGate2({symbol, market,
quote, stockMaster, kospi20dReturn, kosdaq20dReturn, stockReturn20d, period:'20D'})` 결과의
`relativeReturn`(= stockReturn − 시장 맞는 benchmarkReturn) 을 RS excess 로 사용하도록 배선한다.

- KOSDAQ 종목 → `benchmarkKey: 'KOSDAQ'` → `excess = stockReturn20d − kosdaq20dReturn`
- KOSPI 종목 → `benchmarkKey: 'KOSPI'` → `excess = stockReturn20d − kospi20dReturn` (현행 동치)
- `rsScoreFromExcess(excess)` 산식·구간·임계 **무변경** (동일 함수에 올바른 excess 만 주입).
- evidence 에 `benchmarkKey` / `source` 라벨 노출 (예 `source: 'RETURN20D_MINUS_KOSDAQ'`).

### D2. Flag (default OFF, ADR-0157)

- ENV: `GATE2_RS_KOSDAQ_BENCHMARK_ENABLED === 'true'` (default OFF — opt-in)
- SSOT 함수: `isGate2RsKosdaqBenchmarkEnabled(env = process.env)` —
  `server/quant/gate2ConfluenceScore.ts` 거주(기존 `isGate2ProportionalBullishEnabled`·
  `isGate2AxisCoverageFallbackEnabled` 동거). **두 번째 enum/flag 위치 신설 금지.**
- OFF → `buildRsAxis` 가 현행 `kospi20dReturn` 단일 벤치마크 경로를 100% 보존 (byte-equivalent).

### D3. Dry-run 상시 관측 필드 (flag 무관, ADR-0599 `wouldPass*Proportional` 선례 동형)

flag OFF/ON 무관하게, KOSDAQ 종목이었다면 KOSDAQ 벤치마크로 RS status/score 가 **어떻게 바뀌었을지**를
항상 산출해 관측한다. 운영자가 디버전스 장에서 효과 크기를 flip 전에 직접 본다.

- `Gate2AxisScore.rsKosdaqBenchmarkDryRun?` (RS 축에만 stamp) — additive optional:
  - `benchmarkKey`: `'KOSPI' | 'KOSDAQ' | 'UNKNOWN'`
  - `benchmarkReturn20d`: number | null
  - `excess`: number | null (stockReturn − kosdaqBenchmark)
  - `score`: number | null / `status`: Gate2AxisStatus (KOSDAQ 벤치마크 가정 시)
  - `appliedSource`: 실제 적용된 source (`'RETURN20D_MINUS_INDEX' | 'RETURN20D_MINUS_KOSDAQ'`)
  - `wouldChangeStatus`: boolean (현행 KOSPI 경로 status 와 다른가)
- `Gate2EvaluationResult.rsKosdaqBenchmarkDryRun?` (per-symbol roll-up 용 동일 요약) — additive optional.
- `Gate2ConfluenceSummary.wouldStrongIfKosdaqBenchmark?` (집계 — flag OFF 일 때 KOSDAQ 벤치마크였다면
  도달했을 STRONG 수) — additive optional, ADR-0599 `wouldStrongProportional` 동형.

### D4. kosdaq20dReturn source (신규 fetch 0 — 기존 인프라 재사용)

`fetchKoreanIndexDaily('KOSDAQ')`(`koreanQuoteBridge`, KIS-first → Yahoo `^KQ11` fallback)·
`fetchKosdaqIndexDaily`(이미 `sectorEnergyProvider.ts:878·890` 에서 macro/sector energy 사이클에 fetch 됨)를
재사용해, `refreshKospiSection` 가 KOSPI 에 쓰는 동일 `nDayReturn(closes, 20)` 헬퍼로 `kosdaq20dReturn` 을
산출·`MacroState` 에 영속한다.

- **신규 KIS/KRX/Yahoo fetch 0** 가 목표 — engine-dev 는 sector energy 사이클이 이미 fetch 한 KOSDAQ 지수
  일봉을 재사용하거나, 그 재사용이 불가하면 KIS-Primary(ADR-0561) 통로로 1건 추가 fetch 한다(quota 무시 사유
  아님 — 캐시·배치로 흡수). **신규 raw KIS REST 금지·kisClient 단일 통로(불변식 #9).**
- KOSDAQ source 결손 시 → `normalizeBenchmarkReturnForGate2` 가 이미 구현한 **KOSPI fallback +
  진단노트**(`KOSDAQ_BENCHMARK_MISSING_KOSPI_FALLBACK_DIAGNOSTIC_ONLY`) 경로 유지 (결손 ≠ bearish, 불변식 #6).

### D5. Carry 배선 (market + kosdaq20dReturn 을 RS 축까지 흘림)

`buildRsAxis` 가 trace 에서 읽을 수 있도록 다음 carry 를 추가한다 (신규 fetch 0):

1. **`market` 출처 확정:** `symbolMarketRegistry.classifySymbol` 은 KRX 여부만 주고 KOSPI/KOSDAQ 미구분이므로
   **사용 불가**. 시장 구분 SSOT = (a) KRX master 의 `entry.market`(`universeScanner.ts:177` 이 이미
   `.KQ`/`.KS` suffix 로 사용) → `getStockByCode(code).market`, 또는 (b) `quote.market` / `stockMaster.market`.
   `selectBenchmarkForSymbol` 의 `marketFromInput` 이 이미 이 3소스 우선순위를 처리하므로 **그대로 재사용**.
   `.KQ`/`.KS` symbol suffix 도 보조 신호로 활용 가능.
2. **`kosdaq20dReturn` carry:** `MacroState.kosdaq20dReturn`(D4 source) → 스캔 caller(`universeScanner` /
   `stockScreener`)가 candidate trace 의 `macroState.kosdaq20dReturn` / `symbolFeatures.kosdaq20dReturn`
   으로 carry → `decompositionBuilder.ts:186` 인근에 `kosdaq20dReturn` 한 줄 추가(기존 `kospi20dReturn`
   line 동형) → `buildRsAxis` 가 trace 에서 read.
3. **`market` carry:** candidate trace 에 `market` 필드(또는 `getStockByCode` 로 RS 축 내부 해석) carry.

상세 배선 경로·carry 지점·소스 우선순위는 `_workspace/2026-06-16_gate2-rs-benchmark-dualization/architect/
wiring-design.md` 참조.

### D6. byte-equivalent 보장

flag OFF → `buildRsAxis` 가 `kospi20dReturn` 단일 벤치마크 `RETURN20D_MINUS_INDEX` 경로 그대로 →
모든 KOSPI/KOSDAQ 종목 RS score/status 현행과 동일. carry 추가 필드는 OFF 경로에서 미소비(dry-run 산출에만
사용). dry-run 필드는 additive optional 이라 기존 소비처 무영향.

---

## 타입 계약 (additive optional — 기존 필드/임계 불변)

`server/quant/gate2ConfluenceScore.ts`(타입 SSOT 거주) 의 `Gate2AxisScore` / `Gate2EvaluationResult` /
`Gate2ConfluenceSummary` 에 **additive optional** 필드만 추가. 기존 필드·`rsScoreFromExcess` 구간·
`AXIS_WEIGHTS`·`GATE2_PASS_*_MIN_SCORE`·`GATE2_WATCH_MIN_SCORE`·Gate1 `requiredScore=70` **전부 불변**.

```ts
// Gate2AxisScore (RS 축에 stamp)
interface Gate2RsKosdaqBenchmarkDryRun {
  benchmarkKey: 'KOSPI' | 'KOSDAQ' | 'UNKNOWN';
  benchmarkReturn20d: number | null;
  stockReturn20d: number | null;
  excess: number | null;
  score: number | null;
  status: Gate2AxisStatus;          // KOSDAQ 벤치마크 가정 시
  appliedSource: 'RETURN20D_MINUS_INDEX' | 'RETURN20D_MINUS_KOSDAQ';
  wouldChangeStatus: boolean;       // 현행 KOSPI 경로 status 대비 변경 여부
}
// Gate2AxisScore: + rsKosdaqBenchmarkDryRun?: Gate2RsKosdaqBenchmarkDryRun;
//                 + source 라벨에 'RETURN20D_MINUS_KOSDAQ' union 값 허용 (source 는 이미 string)
// Gate2EvaluationResult: + rsKosdaqBenchmarkDryRun?: Gate2RsKosdaqBenchmarkDryRun;
// Gate2ConfluenceSummary: + wouldStrongIfKosdaqBenchmark?: number;
//                         + wouldWeakIfKosdaqBenchmark?: number;
```

`benchmarkKey` / `BenchmarkMarket` enum 은 `benchmarkReturnNormalizer.ts` 의 기존 타입 재사용
(두 번째 enum 신설 금지).

---

## Patch Scope Guard (ADR-530, 11항목)

- **targetDomain:** Gate2 채점(quant) + macro source(trading/marketDataRefresh) + carry(signalScanner
  entryFilterDecomposition) — **3 도메인 한계 내**.
- **allowedFiles:**
  - `server/quant/gate2ConfluenceScore.ts` (buildRsAxis flag 분기 + SSOT 함수 + dry-run 산출 + 타입)
  - `server/clients/benchmarkReturnNormalizer.ts` (필요 시 read-only 재사용 — 본문 변경 0 목표)
  - `server/trading/marketDataRefresh/indexMacroSections.ts` (kosdaq20dReturn source 산출)
  - `server/persistence/macroStateRepo.ts` + `src/types/core.ts` (MacroState.kosdaq20dReturn additive)
  - `server/trading/signalScanner/entryFilterDecomposition/decompositionBuilder.ts` +
    `entryFilterDecomposition/symbolFeatures.ts` + `entryFilterDecomposition/types.ts` (carry)
  - `server/screener/universeScanner.ts` + `server/screener/stockScreener.ts` (caller carry — kospi20dReturn
    line 동형 1줄)
  - `.env.example` (flag 1줄)
  - `*.test.ts` (회귀)
- **forbiddenFiles:** `autoTradeEngine` · `kisClient` raw REST · `buyPipeline` 실주문 · SourceSnapshot 본체 ·
  `rsScoreFromExcess` 구간 · `AXIS_WEIGHTS` · `GATE2_PASS_*_MIN_SCORE` · STRONG 승격 비교식(:787) ·
  Gate1 `requiredScore` · 두 번째 RS 공식.
- **expectedBehaviorChange:** flag OFF=없음(byte-equivalent). ON=KOSDAQ 종목 RS 축이 KOSDAQ 벤치마크로
  재계산 → 디버전스 장 코스닥 주도주의 BULLISH RS 도달 가능 → STRONG 승격 가능.
- **sourceSnapshotImpact:** 없음. SourceSnapshot 우회 0(불변식 #3·#9). kosdaq20dReturn 은 macro source 로
  영속되며 Gate 내부에서 provider 직접 조회 0.
- **executionImpact:** flag OFF=NONE byte-equivalent(KIS/KRX/Yahoo quota 0). ON=gate2-scoring-adjacent
  (RS 축 재계산만 — 주문/autoTradeEngine/kisClient/live minGate 본문 0줄). 현 SHADOW_ONLY 출하 안전.
- **shadowLearningImpact:** Gate2 STRONG/WEAK 라벨 분포가 ON 시 변동(의도 — 디버전스 장 코스닥 표본 정상화).
  `executionImpact: 'NONE'` · `shadowLearning: true` 불변.
- **telegramImpact:** `/scan_blockers_gate2` 에 dry-run(`wouldStrongIfKosdaqBenchmark`) 1줄 상시 노출
  (ADR-0599 `proportionalDryRun` 선례 동형). 표시 가법 — 기존 출력 무회귀.
- **providerImpact:** **신규 fetch 0 목표** — KOSDAQ 지수 일봉은 sector energy 사이클 기존 fetch 재사용,
  불가 시 KIS Primary(ADR-0561) 통로 1건(quota 캐시·배치 흡수). Yahoo `^KQ11` 은 KIS 결손 시 최후 fallback만.
- **testsRequired:** 아래 회귀 테스트 목록 참조.
- **rollbackPlan:** `GATE2_RS_KOSDAQ_BENCHMARK_ENABLED=false`(또는 미설정) ENV 1줄 → buildRsAxis 현행
  KOSPI 단일 벤치마크 경로 100% 복원. macro source / carry 는 dry-run 관측에만 쓰여 OFF 시 점수 영향 0.

---

## 9대 불변식 영향

- **#3 (단일 SourceSnapshot · 우회 금지):** kosdaq20dReturn 은 macro source 로 영속 후 carry 로만 흐름.
  Gate2 내부에서 provider 직접 조회 0. 보존.
- **#6 (Provider 장애 ≠ bearish):** KOSDAQ source 결손 시 `normalizeBenchmarkReturnForGate2` 의 기존
  KOSPI fallback + 진단노트 유지. 결손이 RS 페널티로 둔갑하지 않음. 보존.
- **#7 (AI_ESTIMATED live 금지):** kosdaq20dReturn 은 L1(KIS 지수)/L3(Yahoo `^KQ11` 최후 fallback).
  L4 미사용. RS 축은 매매 직접 결정 아닌 Gate2 채점(현 SHADOW_ONLY). 보존.
- **#9 (Gate 내부 provider 직접 조회 금지):** Gate2 는 carry 된 trace 필드만 read. kisClient 단일 통로.
  신규 raw REST 0. 보존.
- **#1·#2 (Trading Engine·Shadow 무중단):** 채점 로직 flag-gated 분기만 추가. 무영향.

---

## 회귀 테스트 목록 (engine-dev 작성 — quality-guard 검토 후 위임)

1. **flag OFF byte-equivalent:** KOSPI·KOSDAQ 종목 모두 RS score/status 현행 `RETURN20D_MINUS_INDEX`
   경로와 동일 (KOSPI 단일 벤치마크).
2. **flag ON KOSDAQ 종목:** kosdaq20dReturn 주입 시 `excess = stockReturn − kosdaq20dReturn` 으로 BULLISH
   도달(디버전스 재현 케이스 — 코스피 +1.55 / 코스닥 −1.6, 코스닥 종목 stockReturn20d 가 코스닥 이김).
3. **flag ON KOSPI 종목:** KOSPI 벤치마크 경로 → 현행과 동일 (KOSDAQ 배선이 KOSPI 종목에 무영향).
4. **KOSDAQ source 결손:** kosdaq20dReturn=null → KOSPI fallback + 진단노트, 결손 ≠ bearish (불변식 #6).
5. **dry-run 상시 산출(flag 무관):** OFF 에서도 `rsKosdaqBenchmarkDryRun` stamp + `wouldStrongIfKosdaqBenchmark`
   집계 산출 (ADR-0599 동형).
6. **market 미상(UNKNOWN):** `selectBenchmarkForSymbol` UNKNOWN → KOSPI fallback (현행 동치).
7. **STRONG 승격 정합:** ON+KOSDAQ BULLISH 도달 시 bullishAxisCount 증가 → :787 조건으로 STRONG (임계
   80·requiredConfluenceAxisCount 무변경 확인).
8. **carry 배선:** decompositionBuilder 가 kosdaq20dReturn·market 을 trace 에 carry, buildRsAxis 가 read.
9. **rollback:** ENV OFF → 점수 영향 0.

---

## Alternatives Considered

- **(a) 두 번째 RS 공식(KOSDAQ 전용) 신설** → **기각.** ADR-0616 "두 번째 RS 공식 신설 금지" 위반.
  `benchmarkReturnNormalizer` 단일 통로 재사용으로 충분 — `rsScoreFromExcess` 에 올바른 excess 만 주입.
- **(b) default ON** → **기각.** ADR-0157 opt-in 원칙. 디버전스 장 표본 forward-outcome 성숙 후 운영자 flip.
- **(c) sector benchmark 까지 확대(종목 대 섹터지수)** → **기각.** 범위 초과. 본 ADR 은 시장(KOSPI/KOSDAQ)
   이원화만. 섹터 벤치마크는 `SECTOR_RETURN_FALLBACK`(buildRsAxis:382) 가 이미 별도 advisory 처리·후속 ADR.
- **(d) `classifySymbol` 로 시장 구분** → **기각.** KRX 여부만 주고 KOSPI/KOSDAQ 미구분.
  `getStockByCode(code).market` / `quote.market` / `.KQ`·`.KS` suffix(=selectBenchmarkForSymbol 기존 처리) 채택.
- **(e) Gate2 내부에서 KOSDAQ 지수 직접 fetch** → **기각.** 불변식 #9(Gate 내부 provider 직접 조회 금지)
   위반. macro source 영속 후 carry 만.
- **(f) Yahoo `^KQ11` primary** → **기각.** ADR-0561 KIS Primary Absolute. KIS 결손 시 최후 fallback 만.
- **(g) patch type** → **기각.** 신규 flag · 신규 SSOT 함수 · 타입 계약 변경 · 정책(벤치마크 선택) 변경 ·
   디버전스 처방 계보 추적성 → ADR 발급 의무(§5 ADR vs patch).

---

## References

- `server/quant/gate2ConfluenceScore.ts` (`buildRsAxis` :315~395, STRONG 승격 :787, flag SSOT :657~669)
- `server/clients/benchmarkReturnNormalizer.ts` (`selectBenchmarkForSymbol`, `normalizeBenchmarkReturnForGate2`)
- `server/trading/signalScanner/entryFilterDecomposition/decompositionBuilder.ts` (:186 kospi20dReturn carry)
- `server/trading/marketDataRefresh/indexMacroSections.ts` (:205~237 refreshKospiSection · nDayReturn)
- `server/clients/koreanQuoteBridge.ts` (:255~291 fetchKoreanIndexDailyQuote KOSDAQ)
- `server/screener/universeScanner.ts` (:177 entry.market, :920 trace) · `stockScreener.ts` (:700·709)
- ADR-0599(dry-run 선례) · ADR-0600(결손 fallback) · ADR-0612/0616/0617(디버전스 계보) · ADR-0561 · ADR-0157
