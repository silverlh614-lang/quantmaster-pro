# ADR-0657 KIS Investor-Trend Estimate (HHPTJ04160200) SHADOW-grade Fallback in ADR-0477 Investor-Flow Router

Status: Proposed (Phase 0 — architect: 경계·타입·flag 계약·ADR·INDEX·flag-lifecycle 1행·HANDOFF. 라우터 본문 wiring·테스트는 engine-dev 인계.)
default OFF · OFF = byte-identical.

## Context

09:26 거래일 스캔 실측: 종목별 투자자매매동향(FHPTJ04160001, KIS 일별 수급)이
gateEligibleRows=36/46 · **shadowOnlyRows=10/46** (actualInvestorRowUseScope:
`SHADOW_ONLY_NEUTRAL_UNKNOWN`=10). 10 행은 장중·정산 전이라 일별 수급이 미정산/미materialize 상태로
라우터가 수급 row 를 채우지 못한다.

KIS 추정수급 `fetchKisInvestorTrendEstimate`(trId **HHPTJ04160200**,
`/uapi/domestic-stock/v1/quotations/investor-trend-estimate`)는 이미 존재하고,
`server/supply/kisOfficialSupplyPack.ts` 가 호출해
`investorFlowEstimate { foreignNetBuyEstimate, institutionalNetBuyEstimate, individualNetBuyEstimate }`
로 **수집·저장만** 한다(라인 68-74·327·398-406, `confidence: 'ESTIMATED'`).

그러나 ADR-0477 라우터의 providerTried 체인
(`routeBuilder.ts:36` = `[KRX_SYMBOL_INVESTOR_FLOW, KRX_MARKET_INVESTOR_FLOW, KIS_API,
FSS_PASSIVE_ACTIVE, NAVER_INVESTOR_TREND, CACHE, SEMANTIC_NETBUY]`)에는 추정수급이 **미포함**이다.
라우터는 estimate 를 전혀 모른다 → 10 shadow-only 행이 추정치를 보유해도 SHADOW 관측 경로로 승격되지 못한다.

**목적은 빈스캔 해소가 아니다.** 일별 수급이 미정산인 행(현 10건)에 추정-grade(저신뢰) 수급 신호를
SHADOW/counterfactual/관측 용도로 공급해 **수급 커버리지·진단 정밀도**를 높이는 것이다.

## Decision

ADR-0477 투자자흐름 라우터에 KIS 추정수급(HHPTJ04160200)을 **SHADOW-only fallback 후보**로 편입한다.

- 신규 provider id `KIS_INVESTOR_TREND_ESTIMATE` 를 `InvestorFlowProviderId` union 에 추가한다.
- 라우터는 추정수급을 **selected provider 로 승격하지 않는다**(아래 §Policy 3). NAVER/SEMANTIC 처럼
  selectedProviderCandidate 가 아닌 **SHADOW-only fallback 분류**로만 인지한다 — `selectedProvider` 를
  estimate 로 바꾸지 않는다.
- 추정수급은 신규 ENV flag `KIS_INVESTOR_TREND_ESTIMATE_SHADOW_FALLBACK_ENABLED` (default OFF) 뒤에 둔다.
  OFF = byte-identical(providerTried 체인 무변경 · estimate 미인지).
- ON + 일별 수급(FHPTJ04160001) 가용 시: 일별이 primary — estimate 미사용(ADR-0561 KIS primary absolute).
- ON + 일별 수급 미정산 + estimate 가용 시: 해당 shadow-only 행을 estimate 로 채우되
  `useForLive=false · useForGate(live)=false · useForShadow=true · confidence='LOW'(ESTIMATED)`.
- ON + estimate 미가용 시: graceful null(추정 결손 ≠ bearish · 불변식 #6).

## Policy (절대 제약 — 위반 시 기각)

1. **9대 불변식 #7 (AI_ESTIMATED ≠ live execution).** 추정수급(L4 추정 grade)은 live execution 에 절대
   사용 금지. 본 편입은 **shadow/counterfactual/confidence-only**. live gate-score promotion·실주문 경로
   진입 절대 불가. 신규 분류 필드는 `useForLive=false · useForGate(live)=false · useForShadow=true` 를
   literal 로 고정한다.
2. **9대 불변식 #6 (provider/추정 ≠ marketSignal).** `marketSignal=false · executionImpact='NONE' ·
   liveExecutionAllowed=false`. 추정 결손 시 UNKNOWN 보존(BULLISH/BEARISH 변환 금지).
3. **ADR-0561 (KIS Primary Absolute).** KIS 일별 수급(FHPTJ04160001)이 정산되면 그것이 primary 다.
   추정수급은 일별이 미가용일 때만 차용하는 **SHADOW fallback** — 정산 일별 > 추정. 라우터 selected
   provider 를 estimate 로 바꾸지 않는다(selectedProviderCandidate 분류 금지·SHADOW-only fallback 한정).
4. **ADR-0146/0641 (flag-lifecycle).** 신규 ENV 플래그 default OFF · OFF = byte-identical.
   `scripts/gate_flag_lifecycle.json` 에 status=`SHADOW_OFF` 1행
   (introduced 2026-06-29 · reviewBy 2026-09-27(+90일) · activationCriteria/nextAction 명시).
   SSOT = `gateConfig.ts` `isKisInvestorTrendEstimateShadowFallbackEnabled()`.
5. **ADR-0530 (Patch Scope Guard).** §아래 블록 참조. targetDomain = investor-flow-router(1).

## Patch Scope Guard (ADR-530, 11 필드)

- **targetDomain**: investor-flow-router (1개)
- **allowedFiles**:
  - `server/trading/signalScanner/investorFlowProviderRouterAdr0477/types.ts`
    (`InvestorFlowProviderId` 신규 멤버 `KIS_INVESTOR_TREND_ESTIMATE` · SHADOW-only 분류 필드)
  - `server/trading/signalScanner/investorFlowProviderRouterAdr0477/routeBuilder.ts`
    (providerTried 체인에 flag-gated estimate 항목 · selectedProvider 무변경) [engine-dev]
  - `server/trading/signalScanner/investorFlowProviderRouterAdr0477/routeBlocks.ts`
    (신규 `applyKisInvestorTrendEstimateBlockAdr0657` SHADOW-only fallback 블록) [engine-dev]
  - `server/trading/signalScanner/investorFlowProviderRouterAdr0477/freshDataAdapters.ts` 또는
    신규 `kisInvestorTrendEstimateAdapterAdr0657.ts`(estimate→SHADOW sample 정규화 순수 모듈) [engine-dev]
  - `server/trading/gateConfig.ts` (SSOT flag 함수 `isKisInvestorTrendEstimateShadowFallbackEnabled()`)
  - `scripts/gate_flag_lifecycle.json` (신규 1행 SHADOW_OFF)
  - `.env.example` (flag 주석)
  - `*.test.ts` (회귀 — engine-dev)
  - 본 ADR · `docs/adr/INDEX.md`(0657→0658) · `docs/ai/10-patch-history-index.md`(1줄) · HANDOFF
- **forbiddenFiles**:
  - `server/trading/autoTradeEngine*` · `server/trading/buyPipeline*` (실주문 경로)
  - `server/clients/kisClient/**` 주문 함수 (kisClient 단일 통로 본체)
  - SourceSnapshot 생성기 (`server/trading/sourceSnapshot*` 등)
  - Gate1 weighted curve / `requiredScore=70` SSOT / componentScorers / minimumSignalScoreTrace 판정 라인
  - KIS primary 일별수급(FHPTJ04160001) 선택 로직 (라우터 selected provider 결정 본체)
  - `src/**` (클라이언트)
- **expectedBehaviorChange**: flag OFF = 0(byte-identical). flag ON 시 일별 미정산 shadow-only 행에
  estimate 기반 SHADOW sample 채움(useForLive=false). selectedProvider·gate-score·live 0 변화.
- **sourceSnapshotImpact**: NONE (SourceSnapshot 생성기 무접촉 · 라우터는 snapshot 우회 provider 직접조회 안 함 · 불변식 #9 보존).
- **executionImpact**: NONE (flag OFF·ON 무관 — estimate 는 live/gate-score 미진입).
- **shadowLearningImpact**: ON 시 shadow-only 행에 estimate-grade(confidence LOW) sample 추가 →
  관측/counterfactual 표본 enrich. Shadow Learning 정지 0(try/catch 격리 · 불변식 #2).
- **telegramImpact**: NONE(진단 표시는 별도 patch · 본 ADR 범위 아님).
- **providerImpact**: 신규 KIS 호출 0 — `kisOfficialSupplyPack.investorFlowEstimate`(이미 수집된) 재사용.
  추가 KIS quota 침범 0.
- **testsRequired**: 아래 §HANDOFF 회귀 요건 4종.
- **rollbackPlan**: ENV 미설정 또는 `KIS_INVESTOR_TREND_ESTIMATE_SHADOW_FALLBACK_ENABLED` 미설정 =
  byte-identical(estimate 미인지). flip 시 `=false` 또는 삭제 1줄 즉시 baseline.

## Alternatives Considered

1. **estimate 를 selected provider 로 승격** — 기각. 불변식 #7(추정=L4 live 금지) 직접 위반 ·
   ADR-0561 KIS primary 위반(추정이 일별을 대체). SHADOW-only fallback 분류로만 허용.
2. **일별 수급(FHPTJ04160001) 자체를 estimate 로 대체** — 기각(ADR-0561). 정산 일별이 가용하면 항상
   primary. estimate 는 일별 미가용일 때만 SHADOW fallback.
3. **flag 없이 즉시 ON** — 기각(불변식 #8 미검증 · ADR-0146/0641 flag-lifecycle). estimate-grade
   수급이 shadow 표본 분포에 미치는 영향 미관측 → default OFF byte-identical 출하 후 N세션 관측·운영자 승인.
4. **SEMANTIC_NETBUY 경로 재사용(semantic normalizer 통과)** — 기각. semantic 은 NAVER/텍스트 파생
   신호 정규화 경로 · estimate 는 KIS 공식 추정 숫자 필드 → 별도 provider id 로 출처·confidence 추적
   명료성 보존(SRP). estimate 를 semantic 으로 위장하면 출처 추적 불가.

## Type Contract (pin — engine-dev 구현 시그니처)

`investorFlowProviderRouterAdr0477/types.ts`:

- `InvestorFlowProviderId` union 에 신규 멤버 추가:
  `| 'KIS_INVESTOR_TREND_ESTIMATE'`
- `InvestorFlowProviderRouteResult` 에 SHADOW-only 분류 필드(optional · additive):
  - `estimateShadowFallbackUsed?: boolean` — estimate 가 shadow-only 행 채움에 사용됐는지.
  - `estimateProvider?: 'KIS_INVESTOR_TREND_ESTIMATE' | null` — 사용된 추정 provider(미사용 null).
  - `estimateUseScope?: 'SHADOW_ONLY_ESTIMATE'` — literal(다른 값 금지).
  - `estimateConfidence?: 'LOW' | 'NONE'` — 추정 grade(LOW)·결손(NONE).
  - 기존 `usableForLive?: false`·`usableForGate?: false`·`usableForShadow?: true`·
    `executionImpact: 'NONE'`·`liveExecutionAllowed: false` literal 재사용(신규 약화 0).

> 모든 신규 필드는 optional · additive — flag OFF 시 unset(byte-identical). estimate 는 selectedProvider /
> selectedCandidate / actualInvestorRow CORE 결정 입력에 진입하지 않는다(diagnostic/SHADOW 전용).

## Flag SSOT

`server/trading/gateConfig.ts`:

```ts
export function isKisInvestorTrendEstimateShadowFallbackEnabled(): boolean {
  return process.env.KIS_INVESTOR_TREND_ESTIMATE_SHADOW_FALLBACK_ENABLED === 'true';
}
```

- ENV: `KIS_INVESTOR_TREND_ESTIMATE_SHADOW_FALLBACK_ENABLED`
- 비교: `=== 'true'` (ADR-0157 opt-IN · default OFF · 미설정·임의값 = OFF · 정확히 `'true'` 만 활성)
- 호출자 inline ENV 검사 금지 — 본 SSOT 함수만 사용.

## 9대 불변식 보존 요약

- #1 (Trading Engine 항상 live): estimate 블록 try/catch 격리 — 라우터/스캔/Gate 정지 0.
- #2 (Shadow 정지 금지): additive SHADOW sample · 실패 격리.
- #6 (provider/추정 ≠ marketSignal): marketSignal=false · 결손 UNKNOWN 보존.
- #7 (AI_ESTIMATED live 금지): useForLive=false · gate-score 미진입(핵심 제약).
- #8 (실거래/Shadow 차단 분리): estimate=shadow 전용 · live 경로 0.
- #9 (SourceSnapshot 우회 금지): 라우터는 이미 수집된 `kisOfficialSupplyPack.investorFlowEstimate`
  소비 — Gate 내부 provider 직접조회 0.

## 계보

0477 (router wiring) · 0481 (NAVER collector) · 0482 (semantic normalizer) ·
0561 (KIS Primary Absolute) · 0146 (flag-lifecycle / PR 자가 review) · 0641 (flag governance) ·
0530 (Patch Scope Guard) · 0498 (investor flow shadow scope) · 0157 (opt-IN `=== 'true'` 정확비교).

## HANDOFF (engine-dev)

- **수정 파일**: types.ts(타입 — 본 ADR 확정) · routeBuilder.ts(providerTried flag-gated 항목) ·
  routeBlocks.ts(신규 `applyKisInvestorTrendEstimateBlockAdr0657`) · estimate→SHADOW sample 정규화
  순수 모듈(freshDataAdapters.ts 또는 신규 kisInvestorTrendEstimateAdapterAdr0657.ts) ·
  gateConfig.ts(SSOT flag 함수) · scripts/gate_flag_lifecycle.json(1행) · .env.example(주석) · *.test.ts.
- **회귀 요건 4종**:
  1. **OFF = byte-identical** — flag 미설정/`=false` 시 providerTried 체인 byte-identical ·
     estimate 필드 unset · selectedProvider 무변경.
  2. **ON + 일별 가용** — 일별 수급(FHPTJ04160001) 정산 시 일별 우선 · estimate 미사용
     (estimateShadowFallbackUsed=false · ADR-0561).
  3. **ON + 일별 미가용 + estimate 가용** — shadow-only 행을 estimate 로 채움 ·
     `useForLive=false · useForGate=false · useForShadow=true · estimateUseScope='SHADOW_ONLY_ESTIMATE' ·
     estimateConfidence='LOW'` · selectedProvider 무변경.
  4. **ON + estimate 미가용** — graceful null(estimateShadowFallbackUsed=false · estimateProvider=null ·
     결손 ≠ bearish · UNKNOWN 보존).
- **금지**: selectedProvider/selectedCandidate/actualInvestorRow CORE 결정에 estimate 진입 금지 ·
  gate-score live promotion 금지 · 신규 KIS 호출 0(이미 수집된 estimate 재사용).
