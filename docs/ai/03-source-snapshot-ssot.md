# 03 · SourceSnapshot SSOT (단일 진실 출처·provider 우회 금지)

**Read this file only when working on:**
- SourceSnapshot 을 읽거나 채우는 경로 · Gate 평가 입력 전달
- providerIssue · marketSignal · confidence · ExecutionPermission 의 데이터-측 의미
- 호출자가 provider 를 직접 조회(우회)하려 할 때 (불변식 #9)
- stockService / aiUniverseService 데이터 페칭 단일 통로
- carry wiring (시장/종목 프로그램매매 · 섹터 분류) 정밀화

**Do not read this file for:**
- engineMode/SELL_ONLY/R6 가 실행 권한을 어떻게 바꾸는가 → `02-trading-engine-rules.md`
- Gate 통과 판정·조건 가중치·scan_blockers → `04-gate-system.md`
- provider 장애 처리·회로차단기·fallback·L1~L4 운영 → `05-provider-policy.md`

---

## SourceSnapshot SSOT (불변식 #3)

**모든 판단은 단일 SourceSnapshot 에서 출발한다.** 가격·거래량·캔들·수급·매크로 등 모든 입력은
하나의 SourceSnapshot 으로 모인 뒤 Gate/사이징/진단으로 흐른다.

- 호출자가 provider 를 개별 조회하면 **drift** 발생 — 같은 종목이 경로마다 다른 데이터를 본다.
- carry wiring 은 SourceSnapshot 의 값을 candidate 단위로 전달만 한다. **새 외부 호출 0건** 이 원칙.
- carry payload 는 모두 `executionImpact: 'NONE'` + `providerIssue: false` + `marketSignal: false`
  literal type 으로 컴파일 타임 강제 — 데이터 결손이 failed / bearish signal 로 변환되지 않게 차단.

### carry wiring SSOT 패턴 (Patch-MARKET/PER-STOCK/SECTOR-CLASSIFICATION-CARRY)

| 영역 | SSOT 모듈 | ENV gate (default OFF) |
|------|-----------|------------------------|
| 시장 프로그램매매 4-필드 | `marketProgramCarryWiringPolicy.ts` | `MARKET_PROGRAM_CARRY_WIRING_DISABLED` |
| 종목별 프로그램 수급 | `perStockProgramFlowCarryWiringPolicy.ts` | `PER_STOCK_PROGRAM_FLOW_CARRY_WIRING_DISABLED` |
| 섹터 분류 (SectorKey 12-표준) | `sectorClassificationCarryWiringPolicy.ts` | `SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED` |

- 각 SSOT 는 `build*CarryPayload()` + `build*CarryMap()` (key-keyed O(1) lookup) + `is*Disabled()` ENV 헬퍼 제공.
- 호출자(`normalSupplyPreviewRunner.ts`)는 SSOT 위임 + try/catch 격리만 — inline object 직접 조립 금지.
- 섹터 분류는 `sectorEnergyMaster.ts:getSectorByAlias` SSOT 위임 (12-표준 SectorKey union 무수정).

---

## Gate 내부 provider 우회 금지 (불변식 #9)

**Gate 평가는 SourceSnapshot 입력만 사용한다.** Gate 내부에서 KIS/KRX/Yahoo 를 직접 fetch 하면 #3 위반.

- evaluator (`server/quant/conditions/`) 는 SourceSnapshot 의 필드만 읽는다.
- 데이터 부재 시 evaluator 는 `DATA_UNAVAILABLE` 반환 — `null` 로 silent fallback 금지 (ADR-0416).
  registry 가 `evaluator.inputs` 메타로 `requiredData`/`availableData`/`hadRequiredData` 자동 생성 (ADR-0418).
- 호출자(stockScreener)가 evaluator 별 데이터 knowledge 를 가지지 않게 — registry metadata 자동화.

---

## 자동매매·서버 스크리너 단일 통로 (절대 규칙 #3)

- **stockService 단일 통로** — 자동매매와 서버 스크리너의 외부 데이터(Yahoo/DART/Gemini/KIS 프록시/KRX)
  페칭은 `src/services/stockService.ts` 에서만 시작한다.
- **aiUniverseService 단일 통로 (ADR-0011)** — AI 종목 추천(MOMENTUM/QUANT_SCREEN/BEAR_SCREEN/EARLY_DETECT)
  universe 발굴·enrichment 는 `server/services/aiUniverseService.ts` 단일 통로만. KIS/KRX 직접 호출 금지.
  자동매매 경로는 본 모듈 import 금지.

### AI 추천 vs 자동매매 분리

- **AI 추천**: google_search + naver_finance + Yahoo OHLCV 만 사용 (KIS/KRX quota 미소비, ADR-0011 PR-25).
  5-Tier fallback (Google CSE → snapshot → 정량 후보 → Naver 단독 → seed, ADR-0016).
- **자동매매**: KIS·KRX 가 L1 데이터 원천. signalScanner / entryEngine / autoTradeEngine 전용.
- 두 경로의 데이터 출처를 절대 섞지 않는다 — AI 추천 호출이 KIS/KRX quota 를 소비하면 회로차단기 부담.

---

## stale / sanity 검증 (L3 fallback 안전)

- **safePctChange** (ADR-0028) — `((current - base) / base) * 100` 패턴의 stale base price + sanity bound
  단일 안전 헬퍼. 5종 가드 (분모/분자/결과 NaN·Infinity, ±90% sanity bound, null 반환 강제).
  `safePctChangeStrict` (ADR-0117) 는 거래 차단 게이트 — sanity 위반 시 entryEngine WAIT/DATA_HOLD 반환.
- **KRX 거래일 달력** (ADR-0190) — `isAcceptableKrxDailyBase` SSOT 로 휴장일 클러스터의 정상 base 를
  stale 로 오판하지 않게 한다. provider-측 데이터 품질 규칙이므로 상세 → `docs/ai/05-provider-policy.md`.

---

## Information Ownership Registry (ADR-0555 헌법 — 각 정보 → 단 하나의 소유 모듈)

**원칙:** 각 정보 타입은 *단 하나의 소유 모듈(SSOT)* 만 채운다. 소비자는 그 모듈의 출력만 읽고,
provider/store 를 직접 조회하지 않는다 (불변식 #3·#9). 본 표는 ADR-0555 가 헌법으로 채택한
*현존하는* 소유 모듈 지도다 (코드 grep 근거). 신규 정보 타입은 본 표에 행을 추가한 뒤 배선한다.

> **"현재 위반" 열은 새 SSOT 가 아니라 기존 SSOT 우회(드리프트)를 가리킨다.** 이를 정적 가드로
> 막는 것이 ADR-0555 P1·P3 이며, baseline 위반은 allowlist 로 grandfather 후 burn-down.

| 정보 타입 | 소유 모듈(SSOT) | 허용 소비 경로 | 금지 경로 | 현재 위반 |
|---|---|---|---|---|
| quote / price | `server/screener/adapters/technicalQuoteRouter.ts` (KIS_QUOTE>KIS_CACHED>KRX>YAHOO, ADR-0547) · 외부데이터 진입 `src/services/stockService.ts` | SourceSnapshot featuresBySymbol carry | Gate evaluator 내 직접 KIS quote fetch | — |
| investor-flow / supply | `server/trading/signalScanner/investorFlowProviderRouterAdr0477.ts` (ADR-0477/0542) | `injectPerSymbolSupplyContext` carry | signalScanner 자체 fallback 관리 | V3 `marketProgramFlowProvider.ts:78,184` |
| technicals / OHLCV | `server/screener/adapters/technicalQuoteRouter.ts` (KIS 일봉 L1, ADR-0547) | FeatureSnapshot.technicalIndicators | evaluator 내 OHLCV 직접 fetch | — |
| fundamentals / DART | `server/trading/signalScanner/injectPerSymbolDartContext.ts` + `gate2/gate2DartCanonicalSlot.ts` (ADR-0529/0532) | Gate2 canonical slot 읽기 | Gate2 내 DART 직접 조회 | — |
| macro | `server/trading/sourceSnapshot/unifiedSourceSnapshot.ts` `UnifiedMacroContext` (스냅샷 시점 복사) | Gate 는 복사본만 읽음 | `useGlobalIntelStore.macroEnv` 직접 read | 증상R6 regime/display 직접 read |
| sectorEnergy | `server/trading/signalScanner/sectorEnergyCanonicalState.ts` `deriveSectorEnergyCanonicalState` (ADR-0534/0544/0545) | canonical state 읽기 | provider basket 직접 coverage 산정 | — |
| providerHealth | `server/data/dataConfidenceRouter.ts` + `server/diagnostics/providerMarketSignalIsolationStep16.ts` (ADR-0499) | confidence/permission 입력 | providerIssue→bearish 변환 | V2 `dartProviderSignalSplit.ts:29` mixed |
| candidate-universe | 자동매매: `server/services/quantitativeCandidateGenerator.ts` → `candidatePoolBuilder.ts` · AI추천: `server/services/aiUniverseService.ts` (ADR-0011) · supply 단일함수 `fetchKisInvestorTradeByStockDaily`(`kisClient/query.ts:901`, Stage2·factory 공유 — **단일 소유 충족**) | candidate carry · supply 는 공유 단일함수 read | Gate stage 내 provider 직접 universe 조회 | ~~V1~~ → **LEGITIMATE_BUDGET_LAZY (영구 허용, ADR-0558)**: universeScanner lazy/budget fetch(max25 통과후보만, SKIP 제외)는 quota 절약 정당 분기 — factory eager 통합 시 불변식 #9 위반이라 **비-통합 경계**. quote 경로 이원(Stage2 `enrichQuoteWithKisMTAS` / factory `fetchKisStockFullQuote`, eager 회피로 통합 보류·정당). burn-down 종결. |
| gate-decision | `src/candidate-decision/candidateDecisionModel.ts` `buildCandidateDecisionCardModel` (프로덕션) ↔ `src/services/autoTrading/ssotPipeline.ts` (블루프린트, 미배선) | DecisionCardModel 읽기 | 렌더 시점 게이트 재계산 | factory 미구현 드리프트 (§3) |
| execution / order-intent | `server/trading/orderPipelineSsot.ts` `OrderIntent` 13-stage (mode LIVE\|SHADOW) | autoTradeEngine 단일 통로 | 클라이언트 실주문 | — |
| position (shadow/live) | shadow: `server/persistence/shadowPositionLedger.ts` (메모리, 미영속) · live: `trade.id` truth | `/pos` 1순위 ShadowPositionRegistry | Telegram 직접 store 조회 | V4 Registry 파일 영속 0 |
| learning / counterfactual | `counterfactualShadowLearningRepo.ts` · `provisionalShadowLedger.ts` · `personaBalanceLedger.ts` (3-분리, ADR-0430/0329) | scanId+dedup 키 | learning ledger 신설/통합 | — |
| telegram-projection | `server/telegram/renderers/snapshotBundle.ts` (projection only, ADR-0525/0526) | 정본 읽기·렌더 | 렌더 시점 provider 직접 조회/재계산 | ~~V5~~ → P2 묶음2 분류 완료: `dartProviderHealth.cmd.ts:8`·`snapshotBundle.ts:273` 모두 **LEGITIMATE_DIAGNOSTIC**(provider health 메타 진단 / 정본 pass-through projection — 재계산 0). 진짜 (A) projection 위반 0건. |

> **decisionId 주의:** 하류 1:N 인과 추적용 `decisionId` 신설은 ADR-0555 범위 밖(P5/별건).
> Factory(P2) 선행 없이 ID 부터 붙이면 빈 원장에 라벨 다는 꼴 (audit §5).

---

데이터 신뢰 등급(L1~L4)·provider 장애 처리 → `docs/ai/05-provider-policy.md`
Gate 시스템 상세 → `docs/ai/04-gate-system.md`
Information Ownership Registry 헌법 근거 → `docs/adr/0555-ssot-single-funnel-enforcement-constitution.md`
