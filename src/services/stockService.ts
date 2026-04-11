import { AI_MODELS } from "../constants/aiConfig";
import { getAI, aiCache, lsGet, lsSet, getCachedAIResponse, withRetry, safeJsonParse } from './stock/aiClient';
import { enrichStockWithRealData } from './stock/enrichment';
import { fetchMarketIndicators } from './stock/marketOverview';
import {
  BacktestResult,
  BacktestPosition,
  BacktestPortfolioState,
  BacktestDailyLog,
  Portfolio,
  EconomicRegimeData,
  SmartMoneyData,
  ExportMomentumData,
  GeopoliticalRiskData,
  CreditSpreadData,
  MacroEnvironment,
  QuantScreenResult,
  DartScreenerResult,
  SilentAccumulationResult,
  ExtendedRegimeData,
  ThemeReverseTrackResult,
  NewsFrequencyScore,
  GlobalMultiSourceData,
  GlobalCorrelationMatrix,
  SupplyChainIntelligence,
  SectorOrderIntelligence,
  FinancialStressIndex,
  FomcSentimentAnalysis,
} from "../types/quant";

import { getMacroSnapshot, snapshotToMacroFields, getTradeData } from './ecosService';
import { fetchKisSupply, fetchKisShortSelling } from './stock/kisDataFetcher';
import { fetchCorpCode, fetchDartFinancials } from './stock/dartDataFetcher';

import {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateStochastic,
  calculateIchimoku,
  detectVCP,
  calculateDisparity
} from "../utils/indicators";

export type { 
  BacktestResult,
  BacktestPosition,
  BacktestPortfolioState,
  BacktestDailyLog,
  Portfolio
};

export {
  type WalkForwardAnalysis,
  type NewsArticle,
  type ChartPattern,
  type StockRecommendation,
  type AdvancedAnalysisResult,
  type MarketDataPoint,
  type SnsSentiment,
  type EuphoriaSignal,
  type GlobalEtfMonitoring,
  type MarketOverview,
  type MarketContext,
  type MarketPhaseLog,
  type RecommendationResponse,
  type StockFilters,
} from './stock/types';

import type {
  StockRecommendation,
  StockFilters,
  RecommendationResponse,
  AdvancedAnalysisResult,
  MarketOverview,
  MarketContext,
  MarketPhaseLog,
  MarketDataPoint,
  WalkForwardAnalysis,
} from './stock/types';
// ─── Step 4–8 추출 모듈 re-export ──────────────────────────────────────────
export { fetchHistoricalData, backtestPortfolio, runAdvancedAnalysis, performWalkForwardAnalysis } from './stock/historicalData';
export { calculateTranchePlan, enrichStockWithRealData } from './stock/enrichment';
export { fetchCurrentPrice, syncStockPrice, syncStockPriceKIS } from './stock/priceSync';
export { clearSearchCache, searchStock } from './stock/stockSearch';
export { parsePortfolioFile, generateReportSummary } from './stock/reportUtils';
export { syncMarketOverviewIndices, getMarketOverview } from './stock/marketOverview';
export { getStockRecommendations } from './stock/recommendations';
export { runQuantitativeScreening, scanDartDisclosures, detectSilentAccumulation } from './stock/quantScreener';



// ─── 배치 통합 호출 (12개 → 3개 압축) ─────────────────────────────────────────
//
// 기존 12개 개별 AI 호출을 3개 배치 호출로 통합.
// Google Search 1회로 공유 컨텍스트 기반 응답 → 품질 향상 + 비용 75% 절감.
//
// Batch 1: getBatchGlobalIntel()  — macro + regime + extendedRegime + creditSpreads + financialStress + smartMoney
// Batch 2: getBatchSectorIntel()  — exportMomentum + geoRisk + supplyChain + sectorOrders
// Batch 3: getBatchMarketIntel()  — globalCorrelation + fomcSentiment

export interface BatchGlobalIntelResult {
  macro: MacroEnvironment;
  regime: EconomicRegimeData;
  extendedRegime: ExtendedRegimeData;
  creditSpreads: CreditSpreadData;
  financialStress: FinancialStressIndex;
  smartMoney: SmartMoneyData;
}

export interface BatchSectorIntelResult {
  exportMomentum: ExportMomentumData;
  geoRisk: GeopoliticalRiskData;
  supplyChain: SupplyChainIntelligence;
  sectorOrders: SectorOrderIntelligence;
}

export interface BatchMarketIntelResult {
  globalCorrelation: GlobalCorrelationMatrix;
  fomcSentiment: FomcSentimentAnalysis;
}

/**
 * Batch 1: 글로벌 거시경제 인텔리전스 통합 호출.
 * Phase A (Search 없음): ECOS + Yahoo → macro 10개 필드 + regime + extendedRegime
 * Phase B (Search 1회): creditSpreads + financialStress + smartMoney
 * 비용: 기존 Search 1회(전체) → Phase A 무료 + Phase B Search 1회(3개 지표만)
 */
export async function getBatchGlobalIntel(): Promise<BatchGlobalIntelResult> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  // ── 1단계: 무료 데이터 병렬 수집 (ECOS 한국은행 + Yahoo Finance, Search 0회) ──
  type EcosF = Partial<{
    bokRateDirection: 'HIKING' | 'HOLDING' | 'CUTTING';
    m2GrowthYoY: number; nominalGdpGrowth: number;
    exportGrowth3mAvg: number; usdKrw: number;
    bankLendingGrowth: number; // 104Y015 실데이터
  }>;
  let ecosFields: EcosF = {};
  let yahooFields = { vix: null as number | null, us10yYield: null as number | null,
                      usShortRate: null as number | null, samsungIri: null as number | null,
                      vkospi: null as number | null };
  let bokRateValue: number | null = null;

  const [ecosSnapshotR, yahooR] = await Promise.allSettled([
    getMacroSnapshot(),
    fetchMarketIndicators(),
  ]);
  if (ecosSnapshotR.status === 'fulfilled') {
    const snap = ecosSnapshotR.value;
    ecosFields = snapshotToMacroFields(snap);
    if (snap.bokRate) bokRateValue = snap.bokRate.rate;
    console.log('[getBatchGlobalIntel] ECOS 수집 완료:', Object.keys(ecosFields));
  } else {
    console.warn('[getBatchGlobalIntel] ECOS 수집 실패:', ecosSnapshotR.reason);
  }
  if (yahooR.status === 'fulfilled') {
    yahooFields = yahooR.value;
    console.log('[getBatchGlobalIntel] Yahoo 수집 완료: vix=%d us10y=%d', yahooFields.vix, yahooFields.us10yYield);
  }

  // krUsSpread = 한국 기준금리 - 미국 단기금리(^IRX proxy)
  const krUsSpread = (bokRateValue !== null && yahooFields.usShortRate !== null)
    ? parseFloat((bokRateValue - yahooFields.usShortRate).toFixed(2))
    : null;

  // 사전 확보 필드 조합 (AI Phase A에 전달 → 검색 대체)
  const preFilledMacro: Record<string, number | string> = {
    ...(ecosFields.bokRateDirection    ? { bokRateDirection:    ecosFields.bokRateDirection }    : {}),
    ...(ecosFields.m2GrowthYoY        !== undefined ? { m2GrowthYoY:        ecosFields.m2GrowthYoY }        : {}),
    ...(ecosFields.nominalGdpGrowth   !== undefined ? { nominalGdpGrowth:   ecosFields.nominalGdpGrowth }   : {}),
    ...(ecosFields.exportGrowth3mAvg  !== undefined ? { exportGrowth3mAvg:  ecosFields.exportGrowth3mAvg }  : {}),
    ...(ecosFields.usdKrw             !== undefined ? { usdKrw:             ecosFields.usdKrw }             : {}),
    ...(ecosFields.bankLendingGrowth  !== undefined ? { bankLendingGrowth:  ecosFields.bankLendingGrowth }  : {}), // ECOS 104Y015
    ...(yahooFields.vix       !== null ? { vix:        yahooFields.vix }       : {}),
    ...(yahooFields.us10yYield !== null ? { us10yYield: yahooFields.us10yYield } : {}),
    ...(yahooFields.samsungIri !== null ? { samsungIri: yahooFields.samsungIri } : {}),
    ...(yahooFields.vkospi    !== null ? { vkospi:     yahooFields.vkospi }    : {}), // Yahoo ^VKOSPI 실데이터
    ...(krUsSpread             !== null ? { krUsSpread }                          : {}),
  };
  const preFilledCount = Object.keys(preFilledMacro).length;
  console.log(`[getBatchGlobalIntel] 사전 확보 macro 필드 ${preFilledCount}/12`);

  // ── Phase A 프롬프트: Search 없이 API 수치 기반 해석 (macro 완성 + regime 분류) ──
  const phaseAPrompt = `현재 한국 날짜: ${todayDate}

아래는 ECOS 한국은행 + Yahoo Finance에서 수집한 실제 수치입니다.
Google 검색 없이 이 데이터만으로 분석하세요.

[확보 실데이터 ${preFilledCount}/12개]
${JSON.stringify(preFilledMacro, null, 2)}

━━━ 1. macro: 12개 지표 완성 ━━━
확보된 필드는 그대로 사용. 누락 필드만 주어진 데이터로 추정:
- oeciCliKorea: exportGrowth3mAvg + nominalGdpGrowth 기반 추정

━━━ 2. regime: 경기 레짐 (4단계) ━━━
RECOVERY/EXPANSION/SLOWDOWN/RECESSION.
- regime, confidence(0-100), rationale, allowedSectors(최대6), avoidSectors(최대4)
- keyIndicators: { exportGrowth, bokRateDirection, oeciCli, gdpGrowth }

━━━ 3. extendedRegime: 7단계 레짐 ━━━
RECOVERY/EXPANSION/SLOWDOWN/RECESSION/UNCERTAIN/CRISIS/RANGE_BOUND.
- 기본 regime 필드 + uncertaintyMetrics + systemAction
- uncertaintyMetrics: { regimeClarity(0-100), signalConflict(0-100), kospi60dVolatility, leadingSectorCount, foreignFlowDirection("CONSISTENT_BUY"|"CONSISTENT_SELL"|"ALTERNATING"), correlationBreakdown(boolean) }
- systemAction: { mode("NORMAL"|"DEFENSIVE"|"CASH_HEAVY"|"FULL_STOP"|"PAIR_TRADE"), cashRatio(0-100), gateAdjustment: { gate1Threshold, gate2Required, gate3Required }, message }

모든 lastUpdated: "${requestedAtISO}"
응답 형식 (JSON only): { "macro": {...}, "regime": {...}, "extendedRegime": {...} }`.trim();

  // ── Phase B 데이터: FRED API(HY Spread) + Yahoo ETF(스마트머니) → Search 0회 ──
  const fetchFred = async (seriesId: string): Promise<number | null> => {
    try {
      const res = await fetch(`/api/fred?series_id=${seriesId}`);
      if (!res.ok) return null;
      const data = await res.json();
      const obs: { value: string }[] = data.observations ?? [];
      const latest = obs.find(o => o.value !== '.' && o.value !== '');
      return latest ? parseFloat(latest.value) : null;
    } catch { return null; }
  };

  // FRED + Yahoo ETF 병렬 수집 (Search 대체)
  const [fredHyR, fredSofrR, yahooPhaseB] = await Promise.allSettled([
    fetchFred('BAMLH0A0HYM2'),  // ICE BofA US HY OAS (%, × 100 = bps)
    fetchFred('SOFR'),           // SOFR rate (TED spread 근사: SOFR - ^IRX)
    fetchMarketIndicators(),     // EWY, MTUM 5일 수익률 포함
  ]);

  const fredHySpread  = fredHyR.status  === 'fulfilled' && fredHyR.value  !== null ? Math.round(fredHyR.value * 100)  : null;
  const fredSofr      = fredSofrR.status === 'fulfilled' && fredSofrR.value !== null ? fredSofrR.value : null;
  const yahooB        = yahooPhaseB.status === 'fulfilled' ? yahooPhaseB.value : null;
  const tedSpreadBps  = (fredSofr !== null && yahooB?.usShortRate !== null && yahooB?.usShortRate !== undefined)
    ? Math.round((fredSofr - (yahooB.usShortRate ?? 0)) * 100) : null;
  const ewyRet  = yahooB?.ewyReturn  ?? null;
  const mtumRet = yahooB?.mtumReturn ?? null;

  // Phase B 프롬프트: 사전 수집 실데이터 주입, Search 없음
  const phaseBLines: string[] = [];
  if (fredHySpread !== null) phaseBLines.push(`- US HY Spread (FRED BAMLH0A0HYM2): ${fredHySpread}bp`);
  if (tedSpreadBps !== null) phaseBLines.push(`- TED Spread 근사 (SOFR-T-bill): ${tedSpreadBps}bp`);
  if (ewyRet !== null)       phaseBLines.push(`- EWY(한국 ETF) 5일 수익률: ${ewyRet >= 0 ? '+' : ''}${ewyRet}%`);
  if (mtumRet !== null)      phaseBLines.push(`- MTUM(모멘텀 ETF) 5일 수익률: ${mtumRet >= 0 ? '+' : ''}${mtumRet}%`);

  const phaseBPrompt = `현재 한국 날짜: ${todayDate}

아래 실데이터를 기반으로 3가지 금융시장 지표를 JSON으로 반환하세요. Google 검색 불필요.

[사전 수집 실데이터]
${phaseBLines.length > 0 ? phaseBLines.join('\n') : '(데이터 수집 실패 — 추정값 사용)'}

━━━ 1. creditSpreads: 신용 스프레드 ━━━
위 US HY Spread 실데이터를 usHySpread(bp)에 그대로 사용.
- krCorporateSpread(bp) 추정: 국내 AA- 회사채 - 국채 3년물 스프레드
- embiSpread(bp) 추정: 신흥국 EMBI 스프레드
- isCrisisAlert: krCorporateSpread>=150, isLiquidityExpanding: NARROWING AND <100
- trend: "WIDENING"|"NARROWING"|"STABLE"

━━━ 2. financialStress: 금융 스트레스 지수 ━━━
위 TED Spread 근사값을 tedSpread.bps에 그대로 사용.
위 US HY Spread를 usHySpread.bps에 그대로 사용.
- moveIndex: {current, alert("NORMAL"|"ELEVATED"|"EXTREME")} — VIX 기반 추정
- compositeScore(0-100), systemAction("NORMAL"|"CAUTION"|"DEFENSIVE"|"CRISIS")

━━━ 3. smartMoney: 스마트머니 ETF 흐름 ━━━
위 EWY/MTUM 5일 수익률을 priceChange에 그대로 사용. flow: 양수=INFLOW, 음수=OUTFLOW.
- score(0-10): EWY+MTUM 동시 INFLOW=+4, EWY만=+2, MTUM만=+1
- etfFlows: [{ticker,name,flow,weeklyAumChange(%),priceChange(%),significance}]
- isEwyMtumBothInflow(boolean), leadTimeWeeks, signal("BULLISH"|"BEARISH"|"NEUTRAL")

모든 lastUpdated: "${requestedAtISO}"
응답 형식 (JSON only): { "creditSpreads": {...}, "financialStress": {...}, "smartMoney": {...} }`.trim();

  const cacheKey = `batch-global-intel-${todayDate}`;

  return getCachedAIResponse<BatchGlobalIntelResult>(cacheKey, async () => {
    // Phase A (Search 없음) + Phase B (Search 없음, FRED+Yahoo 실데이터) 병렬 실행
    const [phaseARes, phaseBRes] = await Promise.allSettled([
      withRetry(() => getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: phaseAPrompt,
        config: { temperature: 0.1, maxOutputTokens: 4096 },
      }), 2, 2000),
      withRetry(() => getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: phaseBPrompt,
        config: { temperature: 0.1, maxOutputTokens: 4096 },  // googleSearch 제거
      }), 2, 2000),
    ]);

    if (phaseARes.status === 'rejected') console.error('[getBatchGlobalIntel] Phase A 실패:', phaseARes.reason);
    if (phaseBRes.status === 'rejected') console.error('[getBatchGlobalIntel] Phase B 실패:', phaseBRes.reason);

    const fallbackMacro = {
      bokRateDirection: 'HOLDING' as const, us10yYield: 4.3, krUsSpread: -1.25,
      m2GrowthYoY: 6.0, bankLendingGrowth: 5.0, nominalGdpGrowth: 3.5,
      oeciCliKorea: 100.0, exportGrowth3mAvg: 8.0, vkospi: 18.0,
      samsungIri: 1.0, vix: 18.0, usdKrw: 1380.0,
    };
    const fallbackRegime = {
      regime: 'EXPANSION' as const, confidence: 50, rationale: 'Phase A 실패. 기본값.',
      allowedSectors: ['반도체', '조선', '방산'], avoidSectors: [],
      keyIndicators: { exportGrowth: 'N/A', bokRateDirection: 'N/A', oeciCli: 'N/A', gdpGrowth: 'N/A' },
      lastUpdated: requestedAtISO,
    };

    const parsedA = (phaseARes.status === 'fulfilled' && phaseARes.value.text)
      ? safeJsonParse(phaseARes.value.text) as Pick<BatchGlobalIntelResult, 'macro' | 'regime' | 'extendedRegime'>
      : null;
    const parsedB = (phaseBRes.status === 'fulfilled' && phaseBRes.value.text)
      ? safeJsonParse(phaseBRes.value.text) as Pick<BatchGlobalIntelResult, 'creditSpreads' | 'financialStress' | 'smartMoney'>
      : null;

    const parsed: BatchGlobalIntelResult = {
      macro:          parsedA?.macro          ?? fallbackMacro,
      regime:         parsedA?.regime         ?? fallbackRegime,
      extendedRegime: parsedA?.extendedRegime ?? {
        ...fallbackRegime,
        uncertaintyMetrics: { regimeClarity: 50, signalConflict: 50, kospi60dVolatility: 0, leadingSectorCount: 0, foreignFlowDirection: 'ALTERNATING' as const, correlationBreakdown: false },
        systemAction: { mode: 'DEFENSIVE' as const, cashRatio: 50, gateAdjustment: { gate1Threshold: 6, gate2Required: 10, gate3Required: 8 }, message: 'Phase A 실패. 방어 모드.' },
      },
      creditSpreads:  parsedB?.creditSpreads  ?? { krCorporateSpread: 70, usHySpread: 330, embiSpread: 390, isCrisisAlert: false, isLiquidityExpanding: false, trend: 'STABLE' as const, lastUpdated: requestedAtISO },
      financialStress:parsedB?.financialStress ?? { tedSpread: { bps: 0, alert: 'NORMAL' as const }, usHySpread: { bps: 0, trend: 'STABLE' as const }, moveIndex: { current: 0, alert: 'NORMAL' as const }, compositeScore: 0, systemAction: 'NORMAL' as const, lastUpdated: requestedAtISO },
      smartMoney:     parsedB?.smartMoney     ?? { score: 5, etfFlows: [], isEwyMtumBothInflow: false, leadTimeWeeks: 'N/A', signal: 'NEUTRAL' as const, lastUpdated: requestedAtISO },
    };

    // ── API 실데이터로 macro 오버라이드 (ECOS + Yahoo, AI 추정값보다 우선) ──
    const apiOverride = {
      ...ecosFields,
      ...(yahooFields.vix        !== null ? { vix:        yahooFields.vix }        : {}),
      ...(yahooFields.us10yYield !== null ? { us10yYield: yahooFields.us10yYield } : {}),
      ...(yahooFields.samsungIri !== null ? { samsungIri: yahooFields.samsungIri } : {}),
      ...(yahooFields.vkospi     !== null ? { vkospi:     yahooFields.vkospi }     : {}),
      ...(krUsSpread             !== null ? { krUsSpread }                          : {}),
    } as Partial<typeof parsed.macro>;
    if (Object.keys(apiOverride).length > 0) {
      parsed.macro = { ...parsed.macro, ...apiOverride };
      console.log('[getBatchGlobalIntel] API 실데이터 오버라이드:', Object.keys(apiOverride));
    }

    // 개별 캐시 저장 → 기존 개별 함수 호출 시 캐시 히트
    const nowTs   = Date.now();
    const macroKey  = `macro-environment-${todayDate}`;
    const regimeKey = `economic-regime-${todayDate}`;
    const extRegKey = `extended-regime-${todayDate}`;
    const weekKey   = `${requestedAt.getFullYear()}-W${Math.ceil((requestedAt.getDate() - requestedAt.getDay() + 1) / 7).toString().padStart(2, '0')}`;
    const creditKey = `credit-spread-${weekKey}`;
    const fsiKey    = `financial-stress-index-${weekKey}`;
    const smartKey  = `smart-money-${todayDate}`;

    if (parsed.macro)           { aiCache[macroKey]  = { data: parsed.macro,           timestamp: nowTs }; lsSet(macroKey,  { data: parsed.macro,           timestamp: nowTs }); }
    if (parsed.regime)          { aiCache[regimeKey] = { data: parsed.regime,          timestamp: nowTs }; lsSet(regimeKey, { data: parsed.regime,          timestamp: nowTs }); }
    if (parsed.extendedRegime)  { aiCache[extRegKey] = { data: parsed.extendedRegime,  timestamp: nowTs }; lsSet(extRegKey, { data: parsed.extendedRegime,  timestamp: nowTs }); }
    if (parsed.creditSpreads)   { aiCache[creditKey] = { data: parsed.creditSpreads,   timestamp: nowTs }; lsSet(creditKey, { data: parsed.creditSpreads,   timestamp: nowTs }); }
    if (parsed.financialStress) { aiCache[fsiKey]    = { data: parsed.financialStress, timestamp: nowTs }; lsSet(fsiKey,    { data: parsed.financialStress, timestamp: nowTs }); }
    if (parsed.smartMoney)      { aiCache[smartKey]  = { data: parsed.smartMoney,      timestamp: nowTs }; lsSet(smartKey,  { data: parsed.smartMoney,      timestamp: nowTs }); }

    return parsed;
  });
}

/**
 * Batch 2: 섹터/무역 인텔리전스 통합 호출.
 * exportMomentum + geoRisk + supplyChain + sectorOrders
 * 4개 개별 호출 → 1회 Google Search로 통합.
 */
export async function getBatchSectorIntel(): Promise<BatchSectorIntelResult> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  // ── 1단계: ECOS 총수출 데이터 수집 (Search 0회) ──
  let ecosExport: { latestYoY: number; ma3m: number; consecutivePositive: number; monthlyRows: string } | null = null;
  try {
    const rows = await getTradeData(4); // 최근 4개월
    if (rows.length >= 3) {
      const recent = rows.slice(-4);
      const latestYoY = recent[recent.length - 1].exportGrowthYoY;
      const ma3m = parseFloat(
        (recent.slice(-3).reduce((s, d) => s + d.exportGrowthYoY, 0) / 3).toFixed(2)
      );
      // 최신 기준으로 역순 탐색하여 연속 양성 개월 수 계산
      let consecutivePositive = 0;
      for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i].exportGrowthYoY > 0) consecutivePositive++;
        else break;
      }
      const monthlyRows = recent
        .map(d => `  ${d.date}: YoY ${d.exportGrowthYoY > 0 ? '+' : ''}${d.exportGrowthYoY.toFixed(1)}%`)
        .join('\n');
      ecosExport = { latestYoY, ma3m, consecutivePositive, monthlyRows };
      console.log('[getBatchSectorIntel] ECOS 수출 수집 완료: 최신YoY=%d% 3MA=%d%', latestYoY, ma3m);
    }
  } catch (e) {
    console.warn('[getBatchSectorIntel] ECOS 수출 수집 실패:', e);
  }

  // ── Phase A 프롬프트: ECOS 실데이터 → exportMomentum 파생 (Search 없음) ──
  const phaseAPrompt = ecosExport
    ? `현재 한국 날짜: ${todayDate}

아래는 ECOS 한국은행 통관 기준 총수출 실데이터입니다. Google 검색 없이 이 수치를 기반으로 분석하세요.

[ECOS 총수출 YoY 증감률]
${ecosExport.monthlyRows}
- 최신 월 YoY: ${ecosExport.latestYoY > 0 ? '+' : ''}${ecosExport.latestYoY}%
- 3개월 이동평균: ${ecosExport.ma3m > 0 ? '+' : ''}${ecosExport.ma3m}%
- 연속 플러스 개월: ${ecosExport.consecutivePositive}개월

위 수치와 한국 수출 구조(반도체 약 20%, 자동차 10%, 선박 9%, 석유화학 8%, 방산 4%)를 바탕으로 exportMomentum을 도출하세요.
판단 기준:
- 총수출 3MA > +15% → 반도체 주도 가능성 높음 (hotSector)
- 총수출 3MA > +20% → 선박/조선 동반 호조 가능성 (shipyardBonus 후보)
- 연속 플러스 >= 3개월 → semiconductorGate2Relax = true
- 각 품목 yoyGrowth는 총수출 YoY에서 구성비 기반 추정

응답 형식 (JSON only):
{ "exportMomentum": { "hotSectors": [...], "products": [{"product":"반도체","sector":"IT/반도체","yoyGrowth":0,"isHot":false,"consecutiveGrowthMonths":0}, ...5개], "shipyardBonus": false, "semiconductorGate2Relax": false, "lastUpdated": "${requestedAtISO}" } }`.trim()
    : `현재 한국 날짜: ${todayDate}
ECOS 수출 데이터 수집 실패. 알려진 최근 한국 수출 동향을 바탕으로 exportMomentum을 추정하세요 (검색 없이).
응답 형식 (JSON only): { "exportMomentum": { "hotSectors": [], "products": [], "shipyardBonus": false, "semiconductorGate2Relax": false, "lastUpdated": "${requestedAtISO}" } }`;

  // ── Phase B 프롬프트: Search 1회, 3개 컴포넌트 ──
  const phaseBPrompt = `현재 한국 날짜: ${todayDate}

Google 검색으로 아래 3가지 지표를 조회하고 JSON으로 반환하세요.

━━━ 1. geoRisk: 지정학 리스크 스코어 ━━━
키워드: 한반도 안보, NATO 방산 예산, 원자력/SMR 정책, 한국 조선 수주
- score(0-10): 기본5, NATO 방산 증가+2, 원자력/SMR 기회+1, 조선 수주 호조+1, 한반도 긴장-2, 극도 불확실-3
- level: "OPPORTUNITY"|"NEUTRAL"|"RISK"
- affectedSectors, headlines(주요 뉴스 3개), toneBreakdown: { positive, neutral, negative }

━━━ 2. supplyChain: 공급망 선행지표 ━━━
- bdi: { current, mom3Change(%), trend("SURGING"|"RISING"|"FLAT"|"FALLING"|"COLLAPSING"), sectorImplication }
- semiBillings: { latestBillionUSD, yoyGrowth(%), bookToBill, implication }
- gcfi: { shanghaiEurope($/40ft), transPacific($/40ft), trend("RISING"|"FLAT"|"FALLING") }

━━━ 3. sectorOrders: 글로벌 수주 인텔리전스 ━━━
- globalDefense: { natoGdpAvg(%), usDefenseBudget(억달러), trend("EXPANDING"|"STABLE"|"CUTTING"), koreaExposure }
- lngOrders: { newOrdersYTD(척), qatarEnergy(현황), orderBookMonths, implication }
- smrContracts: { usNrcApprovals, totalGwCapacity(GW), koreaHyundai(현황), timing("TOO_EARLY"|"OPTIMAL"|"LATE") }

모든 lastUpdated: "${requestedAtISO}"
응답 형식 (JSON only): { "geoRisk": {...}, "supplyChain": {...}, "sectorOrders": {...} }`.trim();

  const cacheKey = `batch-sector-intel-${todayDate}`;

  return getCachedAIResponse<BatchSectorIntelResult>(cacheKey, async () => {
    const [phaseARes, phaseBRes] = await Promise.allSettled([
      withRetry(() => getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: phaseAPrompt,
        config: { temperature: 0.1, maxOutputTokens: 2048 },
      }), 2, 2000),
      withRetry(() => getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: phaseBPrompt,
        config: { tools: [{ googleSearch: {} }], temperature: 0.1, maxOutputTokens: 6144 },
      }), 2, 2000),
    ]);

    if (phaseARes.status === 'rejected') console.error('[getBatchSectorIntel] Phase A 실패:', phaseARes.reason);
    if (phaseBRes.status === 'rejected') console.error('[getBatchSectorIntel] Phase B 실패:', phaseBRes.reason);

    const parsedA = (phaseARes.status === 'fulfilled' && phaseARes.value.text)
      ? safeJsonParse(phaseARes.value.text) as { exportMomentum?: ExportMomentumData } : null;
    const parsedB = (phaseBRes.status === 'fulfilled' && phaseBRes.value.text)
      ? safeJsonParse(phaseBRes.value.text) as Partial<BatchSectorIntelResult> : null;

    const fallbackExport: ExportMomentumData = { hotSectors: [], products: [], shipyardBonus: false, semiconductorGate2Relax: false, lastUpdated: requestedAtISO };

    const parsed: BatchSectorIntelResult = {
      exportMomentum: parsedA?.exportMomentum ?? fallbackExport,
      geoRisk: parsedB?.geoRisk ?? { score: 5, level: 'NEUTRAL', affectedSectors: ['방위산업', '조선', '원자력'], headlines: [], toneBreakdown: { positive: 33, neutral: 34, negative: 33 }, lastUpdated: requestedAtISO },
      supplyChain: parsedB?.supplyChain ?? {
        bdi: { current: 0, mom3Change: 0, trend: 'FLAT', sectorImplication: '데이터 조회 실패' },
        semiBillings: { latestBillionUSD: 0, yoyGrowth: 0, bookToBill: 1.0, implication: '데이터 조회 실패' },
        gcfi: { shanghaiEurope: 0, transPacific: 0, trend: 'FLAT' }, lastUpdated: requestedAtISO,
      },
      sectorOrders: parsedB?.sectorOrders ?? {
        globalDefense: { natoGdpAvg: 0, usDefenseBudget: 0, trend: 'STABLE', koreaExposure: '데이터 조회 실패' },
        lngOrders: { newOrdersYTD: 0, qatarEnergy: '데이터 조회 실패', orderBookMonths: 0, implication: '데이터 조회 실패' },
        smrContracts: { usNrcApprovals: 0, totalGwCapacity: 0, koreaHyundai: '데이터 조회 실패', timing: 'TOO_EARLY' }, lastUpdated: requestedAtISO,
      },
    };

    // 개별 캐시 저장
    const tsNow = Date.now();
    const yearMonth = requestedAt.toISOString().slice(0, 7);
    const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;

    if (parsed.exportMomentum) { const k = `export-momentum-${yearMonth}`; aiCache[k] = { data: parsed.exportMomentum, timestamp: tsNow }; lsSet(k, { data: parsed.exportMomentum, timestamp: tsNow }); }
    if (parsed.geoRisk)        { const k = `geo-risk-${weekKey}`;           aiCache[k] = { data: parsed.geoRisk,        timestamp: tsNow }; lsSet(k, { data: parsed.geoRisk,        timestamp: tsNow }); }
    if (parsed.supplyChain)    { const k = `supply-chain-intel-${weekKey}`; aiCache[k] = { data: parsed.supplyChain,    timestamp: tsNow }; lsSet(k, { data: parsed.supplyChain,    timestamp: tsNow }); }
    if (parsed.sectorOrders)   { const k = `sector-order-intel-${weekKey}`; aiCache[k] = { data: parsed.sectorOrders,   timestamp: tsNow }; lsSet(k, { data: parsed.sectorOrders,   timestamp: tsNow }); }

    return parsed;
  });
}

/**
 * Batch 3: 시장 상관관계 & 센티먼트 통합 호출.
 * globalCorrelation + fomcSentiment
 * 2개 개별 호출 → 1회로 통합.
 */
export async function getBatchMarketIntel(): Promise<BatchMarketIntelResult> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

다음 2가지 시장 분석을 한번에 수행하고 JSON으로 반환하세요.
Google 검색을 통해 최신 데이터를 기반으로 판단하세요.

━━━ 1. globalCorrelation: 글로벌 상관관계 매트릭스 ━━━
최근 30거래일 상관계수 추정:
- kospiSp500: KOSPI-S&P500 (정상 0.6~0.8, 디커플링 <0.3, 동조화 >0.9)
- kospiNikkei: KOSPI-닛케이225 (정상 0.5~0.7)
- kospiShanghai: KOSPI-상해종합 (정상 0.3~0.6)
- kospiDxy: KOSPI-달러인덱스 (보통 음의 상관 -0.3~-0.6)
- isDecoupling: kospiSp500 < 0.3
- isGlobalSync: kospiSp500 > 0.9

━━━ 2. fomcSentiment: FOMC 감성 분석 ━━━
최근 FOMC 의사록/성명서 기반:
- hawkDovishScore: -10(극비둘기) ~ +10(극매파)
- keyPhrases: 핵심 문구 배열 (예: "data dependent", "higher for longer")
- dotPlotShift: "MORE_CUTS"|"UNCHANGED"|"FEWER_CUTS"
- kospiImpact: "BULLISH"(비둘기≤-5)|"NEUTRAL"(-5~+5)|"BEARISH"(매파≥+5)
- rationale: 한국 증시 영향 근거 (한국어)

모든 lastUpdated는 "${requestedAtISO}"로 설정.

응답 형식 (JSON only):
{
  "globalCorrelation": { "kospiSp500": 0.72, "kospiNikkei": 0.58, "kospiShanghai": 0.41, "kospiDxy": -0.45, "isDecoupling": false, "isGlobalSync": false, "lastUpdated": "..." },
  "fomcSentiment": { "hawkDovishScore": 3, "keyPhrases": [...], "dotPlotShift": "FEWER_CUTS", "kospiImpact": "BEARISH", "rationale": "...", "lastUpdated": "..." }
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `batch-market-intel-${weekKey}`;

  return getCachedAIResponse<BatchMarketIntelResult>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text) as BatchMarketIntelResult;

      // 개별 캐시에도 저장
      const tsNow = Date.now();
      if (parsed.globalCorrelation) { const k = `global-correlation-${weekKey}`; aiCache[k] = { data: parsed.globalCorrelation, timestamp: tsNow }; lsSet(k, { data: parsed.globalCorrelation, timestamp: tsNow }); }
      if (parsed.fomcSentiment) { const k = `fomc-sentiment-${weekKey}`; aiCache[k] = { data: parsed.fomcSentiment, timestamp: tsNow }; lsSet(k, { data: parsed.fomcSentiment, timestamp: tsNow }); }

      return parsed;
    } catch (error) {
      console.error("Error in getBatchMarketIntel:", error);
      return {
        globalCorrelation: {
          kospiSp500: 0.7, kospiNikkei: 0.55, kospiShanghai: 0.4, kospiDxy: -0.45,
          isDecoupling: false, isGlobalSync: false, lastUpdated: requestedAtISO,
        },
        fomcSentiment: {
          hawkDovishScore: 0, keyPhrases: [], dotPlotShift: 'UNCHANGED',
          kospiImpact: 'NEUTRAL', rationale: 'FOMC 감성 분석 실패. 기본값 적용.', lastUpdated: requestedAtISO,
        },
      };
    }
  });
}

// ─── 아이디어 2: 경기 레짐 자동 분류기 (Economic Regime Classifier) ──────────

/**
 * Gemini + Google Search 기반으로 현재 한국 경기 사이클 레짐을 분류합니다.
 * RECOVERY → EXPANSION → SLOWDOWN → RECESSION 4단계 중 하나를 반환하며,
 * 현재 레짐에 부합하는 허용 섹터 화이트리스트를 함께 제공합니다.
 */
export async function getEconomicRegime(): Promise<EconomicRegimeData> {
  const todayDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const cacheKey = `economic-regime-${todayDate}`;
  // 배치 캐시에서 읽음 — 별도 Google Search 없음 (Search 1회 절약)
  return getCachedAIResponse<EconomicRegimeData>(cacheKey, async () => {
    const batch = await getBatchGlobalIntel();
    return batch.regime;
  });
}

// ─── 아이디어 4: Smart Money Radar (글로벌 ETF 선행 모니터) ──────────────────

/**
 * EWY·MTUM·EEMV·IYW·ITA 5개 ETF의 주간 자금흐름을 분석해
 * Smart Money Flow Score(0-10)를 산출합니다.
 * EWY + MTUM 동반 유입 감지 시 → Gate 2 통과 기준 선제 완화 신호를 반환합니다.
 */
export async function getSmartMoneyFlow(): Promise<SmartMoneyData> {
  const todayDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const cacheKey = `smart-money-${todayDate}`;
  // 배치 캐시에서 읽음 — 별도 Google Search 없음 (Search 1회 절약)
  return getCachedAIResponse<SmartMoneyData>(cacheKey, async () => {
    const batch = await getBatchGlobalIntel();
    return batch.smartMoney;
  });
}

// ─── 아이디어 5: 수출 선행지수 섹터 로테이션 엔진 ────────────────────────────

/**
 * 한국 주요 수출 품목(반도체·선박·자동차·석유화학·방산)의 YoY 증감률을 조회해
 * 수출 모멘텀 섹터를 분류하고 Gate 2 완화·스코어 가산 조건을 반환합니다.
 */
export async function getExportMomentum(): Promise<ExportMomentumData> {
  const requestedAt = new Date();
  const yearMonth = requestedAt.toISOString().slice(0, 7); // "2026-04"
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
    현재 날짜: ${requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}

    한국 산업통상자원부 또는 관세청의 최근 수출 데이터를 구글 검색으로 조회해줘.
    아래 5개 주요 수출 품목의 전년 동기 대비(YoY) 증감률을 확인해줘.

    품목: 반도체, 선박, 자동차, 석유화학, 방산(무기·방산 수출)

    분류 기준:
    - isHot = true: YoY 증가율 > 10% 또는 해당 품목 수출이 전체 수출 증가를 주도
    - shipyardBonus: 선박 수출 YoY ≥ +30%
    - semiconductorGate2Relax: 반도체 수출 3개월 연속 YoY 증가

    응답 형식 (JSON only):
    {
      "hotSectors": ["반도체", "조선"],
      "products": [
        { "product": "반도체", "sector": "반도체/IT", "yoyGrowth": 18.5, "isHot": true, "consecutiveGrowthMonths": 4 },
        { "product": "선박", "sector": "조선", "yoyGrowth": 32.1, "isHot": true },
        { "product": "자동차", "sector": "자동차/부품", "yoyGrowth": 5.2, "isHot": false },
        { "product": "석유화학", "sector": "석유화학", "yoyGrowth": -3.1, "isHot": false },
        { "product": "방산", "sector": "방위산업", "yoyGrowth": 25.0, "isHot": true }
      ],
      "shipyardBonus": true,
      "semiconductorGate2Relax": true,
      "lastUpdated": "${requestedAtISO}"
    }
  `;

  const cacheKey = `export-momentum-${yearMonth}`;

  return getCachedAIResponse<ExportMomentumData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as ExportMomentumData;
    } catch (error) {
      console.error("Error getting export momentum:", error);
      return {
        hotSectors: [],
        products: [],
        shipyardBonus: false,
        semiconductorGate2Relax: false,
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 아이디어 7: 지정학 리스크 스코어링 모듈 (Geopolitical Risk Engine) ──────

/**
 * Gemini Google Search로 지정학 키워드를 분석해
 * Geopolitical Opportunity Score(GOS 0-10)를 산출합니다.
 * GOS ≥ 7: 방산·조선·원자력 Gate 3 완화 / GOS ≤ 3: Kelly 30% 하향
 */
export async function getGeopoliticalRiskScore(): Promise<GeopoliticalRiskData> {
  const requestedAt = new Date();
  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
    현재 날짜: ${requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}

    아래 4가지 지정학 키워드에 대한 최신 뉴스 동향을 분석해줘:
    1. "한반도 안보 리스크" 또는 "북한 도발" 또는 "한미동맹"
    2. "NATO 방산 예산" 또는 "유럽 국방비 증액"
    3. "원자력 에너지 정책" 또는 "SMR 소형원전 수출"
    4. "한국 조선 수주 잔고" 또는 "LNG선 수주"

    각 키워드의 최신 뉴스 기사 톤을 분석해:
    - 긍정적 (방산·조선·원자력 섹터 수혜 예상)
    - 중립적
    - 부정적 (리스크 증가)

    GOS 점수 기준 (0-10):
    - 기본 5점
    - NATO/유럽 방산 예산 증가 뉴스: +2점
    - 원자력/SMR 수출 기회: +1점
    - 조선 수주 호조: +1점
    - 한반도 긴장 고조 (직접 충돌 위협): -2점
    - 지정학 불확실성 극도로 높음: -3점

    응답 형식 (JSON only):
    {
      "score": 7,
      "level": "OPPORTUNITY",
      "affectedSectors": ["방위산업", "조선", "원자력"],
      "headlines": [
        "NATO, 2025년 국방비 GDP 2% 이상 달성 회원국 18개국으로 증가",
        "한국 HD현대重, 유럽 LNG선 4척 추가 수주 — 수주잔고 역대 최대",
        "체코 원전 수주 확정 — 한국수력원자력 2조원 프로젝트 착수"
      ],
      "toneBreakdown": { "positive": 70, "neutral": 20, "negative": 10 },
      "lastUpdated": "${requestedAtISO}"
    }
  `;

  const cacheKey = `geo-risk-${weekKey}`;

  return getCachedAIResponse<GeopoliticalRiskData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as GeopoliticalRiskData;
    } catch (error) {
      console.error("Error getting geopolitical risk score:", error);
      return {
        score: 5,
        level: 'NEUTRAL',
        affectedSectors: ['방위산업', '조선', '원자력'],
        headlines: [],
        toneBreakdown: { positive: 33, neutral: 34, negative: 33 },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 아이디어 9: 크레딧 스프레드 조기 경보 시스템 ────────────────────────────

export async function getCreditSpreads(): Promise<CreditSpreadData> {
  const requestedAt = new Date();
  const requestedAtISO = requestedAt.toISOString();
  // 주 1회 캐시 (월요일 기준 주차 키)
  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil((requestedAt.getDate() - requestedAt.getDay() + 1) / 7).toString().padStart(2, '0')}`;

  const prompt = `
    You are a fixed income market analyst. Search for the latest credit spread data and return a JSON object.

    Search for:
    1. "한국 AA- 회사채 스프레드" or "Korea AA- corporate bond spread basis points 2025"
    2. "ICE BofA US High Yield OAS spread 2025" or "US HY spread basis points"
    3. "JPMorgan EMBI+ spread emerging market bond spread 2025"

    Interpret the trend:
    - WIDENING: spreads increased more than 10bp in past month (credit stress)
    - NARROWING: spreads decreased more than 10bp in past month (liquidity expanding)
    - STABLE: within ±10bp range

    isCrisisAlert: true if krCorporateSpread >= 150bp
    isLiquidityExpanding: true if trend === 'NARROWING' AND krCorporateSpread < 100

    Return ONLY valid JSON (no markdown):
    {
      "krCorporateSpread": <number, bp>,
      "usHySpread": <number, bp>,
      "embiSpread": <number, bp>,
      "isCrisisAlert": <boolean>,
      "isLiquidityExpanding": <boolean>,
      "trend": "WIDENING" | "NARROWING" | "STABLE",
      "lastUpdated": "${requestedAtISO}"
    }

    Example realistic values (search for actual current data):
    {
      "krCorporateSpread": 68,
      "usHySpread": 320,
      "embiSpread": 380,
      "isCrisisAlert": false,
      "isLiquidityExpanding": false,
      "trend": "STABLE",
      "lastUpdated": "${requestedAtISO}"
    }
  `;

  const cacheKey = `credit-spread-${weekKey}`;

  return getCachedAIResponse<CreditSpreadData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as CreditSpreadData;
    } catch (error) {
      console.error("Error getting credit spreads:", error);
      return {
        krCorporateSpread: 70,
        usHySpread: 330,
        embiSpread: 390,
        isCrisisAlert: false,
        isLiquidityExpanding: false,
        trend: 'STABLE',
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 정량 스크리닝 엔진 (Quantitative Screening Engine) ──────────────────────
// 뉴스 의존 없이 순수 수치 데이터로 이상 신호 종목을 발굴합니다.
// Yahoo Finance OHLCV + KIS 수급 + DART 공시를 결합하여 AI가 모르는 종목도 포착.

/**
 * 정량 스크리닝: AI 검색 없이 수치 기반으로 이상 신호 종목을 발굴.
 * 1단계: 전종목 기본 필터 (시총, 거래대금, 관리종목 제외)
 * 2단계: 이상 신호 감지 (거래량 급증, 외국인/기관 매집, 신고가 근접, VCP 등)
 * 3단계: AI 정밀 분석 (뉴스가 아니라 "왜 수치가 변했는지" 분석)
 */
// ─── 확장 레짐 분류기 (Extended Regime Classifier) ───────────────────────────
// 기존 4단계에 UNCERTAIN/CRISIS/RANGE_BOUND를 추가하여 7단계로 확장.
// 글로벌 소스 확장 및 상관관계 분석 포함.

/**
 * 확장 경기 레짐 분류: 기존 getEconomicRegime + 불확실성 메트릭 추가.
 * 글로벌 소스를 폭넓게 참조하여 한국 시장 특수 상황을 감지합니다.
 */
export async function getExtendedEconomicRegime(): Promise<ExtendedRegimeData> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 한국 날짜: ${todayDate}

아래 7가지 경기 사이클 중 현재 한국 경제가 어디에 해당하는지 분류해줘.
구글 검색을 통해 최신 실제 데이터를 기반으로 판단해야 해.

분류 기준 (확장 7단계):
- RECOVERY (회복기): GDP 성장 반등, 수출 증가 시작, 금리 인하 또는 동결, OECD CLI ≥ 100 상승 전환
- EXPANSION (확장기): GDP 성장 가속, 수출 호조, 금리 동결 또는 소폭 인상, CLI 상승 지속
- SLOWDOWN (둔화기): GDP 성장 둔화, 수출 증가율 감소, 금리 인상 또는 동결, CLI 하락
- RECESSION (침체기): GDP 역성장 또는 제로, 수출 급감, CLI 급락, 신용 위기 징후
- UNCERTAIN (불확실): 지표 혼조, 매크로 신호 상충, 방향성 불명확, 주도 섹터 부재
- CRISIS (위기): VKOSPI > 35, VIX > 30, 외부 충격(전쟁/금융위기), 신용스프레드 급등
- RANGE_BOUND (박스권): KOSPI 60일 변동성 < 5%, 뚜렷한 주도 섹터 없음, 외국인 매수/매도 교차

조회할 데이터 (기존 + 확장):
[기존]
1. 한국 최근 수출 증가율 (전년 동월 대비, 3개월 이동평균)
2. 한국은행 기준금리 현재 수준 및 방향
3. OECD 경기선행지수(CLI) 한국 최신
4. 한국 최근 분기 GDP 성장률

[확장 - 글로벌 소스]
5. VKOSPI 현재값 및 20일 이동평균
6. VIX 현재값
7. KOSPI 60일 변동성 (표준편차 기반)
8. 최근 5일 주도 섹터 수 (KOSPI 업종별 상승률 상위 3개 섹터가 명확한지)
9. 외국인 최근 5일 순매수 패턴 (일관된 매수/매도 vs 교차)
10. KOSPI-S&P500 30일 상관계수 (정상: 0.6-0.8, 디커플링: <0.3, 동조화: >0.9)
11. CME FedWatch 금리 전망 (다음 FOMC 금리 동결/인하 확률)
12. 중국 PMI 최신값 (한국 수출 선행지표)
13. 대만 TSMC 월간 매출 추이 (반도체 사이클 선행)
14. 일본 BOJ 정책 최신 동향 (엔캐리 리스크)
15. 미국 ISM 제조업 PMI 최신값
16. 원/달러 환율 현재값

응답 형식 (JSON only):
{
  "regime": "EXPANSION",
  "confidence": 78,
  "rationale": "수출 YoY +12.3%, CLI 101.2 상승 기조...",
  "allowedSectors": ["반도체", "조선", "방산", "바이오", "AI인프라", "자동차"],
  "avoidSectors": ["내수소비재", "항공", "음식료"],
  "keyIndicators": {
    "exportGrowth": "+12.3% YoY",
    "bokRateDirection": "동결 (3.50%)",
    "oeciCli": "101.2",
    "gdpGrowth": "+2.1% QoQ"
  },
  "lastUpdated": "${requestedAtISO}",
  "uncertaintyMetrics": {
    "regimeClarity": 75,
    "signalConflict": 25,
    "kospi60dVolatility": 12.5,
    "leadingSectorCount": 3,
    "foreignFlowDirection": "CONSISTENT_BUY",
    "correlationBreakdown": false
  },
  "systemAction": {
    "mode": "NORMAL",
    "cashRatio": 20,
    "gateAdjustment": { "gate1Threshold": 5, "gate2Required": 9, "gate3Required": 7 },
    "message": "정상 시장. 기본 Gate 기준 적용."
  }
}
  `.trim();

  const cacheKey = `extended-regime-${todayDate}`;

  return getCachedAIResponse<ExtendedRegimeData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as ExtendedRegimeData;
    } catch (error) {
      console.error("Error getting extended economic regime:", error);
      return {
        regime: 'EXPANSION',
        confidence: 50,
        rationale: "데이터 조회 실패. 기본값(확장기)으로 설정됨.",
        allowedSectors: ["반도체", "조선", "방산"],
        avoidSectors: [],
        keyIndicators: {
          exportGrowth: "N/A",
          bokRateDirection: "N/A",
          oeciCli: "N/A",
          gdpGrowth: "N/A",
        },
        lastUpdated: requestedAtISO,
        uncertaintyMetrics: {
          regimeClarity: 50,
          signalConflict: 50,
          kospi60dVolatility: 0,
          leadingSectorCount: 0,
          foreignFlowDirection: 'ALTERNATING',
          correlationBreakdown: false,
        },
        systemAction: {
          mode: 'DEFENSIVE',
          cashRatio: 50,
          gateAdjustment: { gate1Threshold: 6, gate2Required: 10, gate3Required: 8 },
          message: '데이터 수집 실패. 방어적 모드로 전환.',
        },
      };
    }
  });
}

// ─── 거시 환경 자동 수집 (Gate 0 입력) ────────────────────────────────────────
export async function fetchMacroEnvironment(): Promise<MacroEnvironment> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const cacheKey = `macro-environment-${todayDate}`;

  return getCachedAIResponse<MacroEnvironment>(cacheKey, async () => {
    const prompt = `
현재 한국 날짜: ${todayDate}

아래 12개 거시 지표의 최신 실제 값을 당신의 학습 데이터 기반으로 추정하여 JSON 하나만 반환해줘.
(마크다운, 설명 없이 JSON만)

수집 대상:
1. 한국은행 기준금리 방향 (최근 결정): "HIKING" | "HOLDING" | "CUTTING"
2. 미국 10년 국채 금리 (%, 최신)
3. 한미 금리 스프레드 (한국 기준금리 - 미국 기준금리, 음수 허용)
4. 한국 M2 통화량 증가율 YoY (%, 최신)
5. 한국 은행 여신(대출) 증가율 YoY (%, 최신)
6. 한국 명목 GDP 성장률 YoY (%, 최신 분기)
7. OECD 경기선행지수 한국 (최신, 100 기준)
8. 한국 수출 증가율 3개월 이동평균 YoY (%, 최신)
9. VKOSPI 현재값
10. 삼성전자 IRI 또는 프로그램 매매 비율 대용값 (0.5~1.5 범위; 중립=1.0)
11. VIX 현재값
12. 원달러 환율 현재값

응답 형식 (JSON only, 추정값 사용 가능):
{
  "bokRateDirection": "HOLDING",
  "us10yYield": 4.35,
  "krUsSpread": -1.25,
  "m2GrowthYoY": 6.2,
  "bankLendingGrowth": 5.1,
  "nominalGdpGrowth": 3.8,
  "oeciCliKorea": 100.4,
  "exportGrowth3mAvg": 11.5,
  "vkospi": 18.2,
  "samsungIri": 0.92,
  "vix": 16.8,
  "usdKrw": 1385.0
}
    `.trim();

    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error('No response from AI');
      return safeJsonParse(text) as MacroEnvironment;
    } catch (_) {
      // 수집 실패 시 보수적 중립 기본값 반환
      return {
        bokRateDirection: 'HOLDING',
        us10yYield: 4.3,
        krUsSpread: -1.25,
        m2GrowthYoY: 6.0,
        bankLendingGrowth: 5.0,
        nominalGdpGrowth: 3.5,
        oeciCliKorea: 100.0,
        exportGrowth3mAvg: 8.0,
        vkospi: 18.0,
        samsungIri: 1.0,
        vix: 18.0,
        usdKrw: 1380.0,
      };
    }
  });
}

// ─── H: 섹터-테마 역추적 엔진 (Theme → Korea Value Chain Reverse Tracking) ──

/**
 * 글로벌 메가트렌드에서 아직 시장이 연결짓지 못한 한국 숨은 수혜주를 역추적.
 * "종목 → 뉴스 검색" 방식을 뒤집어 "테마 → 관련 종목 역추적".
 * DART 사업보고서의 주요 제품/매출 구성을 분석하여 밸류체인을 매핑합니다.
 */
export async function trackThemeToKoreaValueChain(options?: {
  customThemes?: string[];     // 사용자 지정 테마 (없으면 AI가 자동 감지)
  maxThemes?: number;          // 최대 테마 수 (기본 5)
}): Promise<ThemeReverseTrackResult[]> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();
  const maxThemes = options?.maxThemes ?? 5;

  const themeSection = options?.customThemes?.length
    ? `[사용자 지정 테마]\n${options.customThemes.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : `[1단계: 글로벌 메가트렌드 자동 감지]
아래 키워드로 Google 검색하여 최근 2주 이내 급부상하는 글로벌 테마 ${maxThemes}개를 감지하라:
- "global megatrend 2026 emerging technology"
- "US Congress bill passed technology energy defense"
- "EU regulation new policy 2026"
- "China industrial policy subsidy 2026"
- "breakthrough technology commercialization 2026"
- "GLP-1 obesity drug market expansion"
- "SMR small modular reactor contract"
- "low earth orbit satellite constellation"
- "AI infrastructure data center power"
- "solid state battery commercialization"
- "humanoid robot mass production"
- "space economy commercial launch"`;

  const prompt = `
현재 한국 날짜: ${todayDate}

당신은 글로벌 테마 → 한국 밸류체인 역추적 전문가입니다.
핵심 목적: 글로벌 트렌드의 한국 수혜주 중 아직 시장이 연결짓지 못한 '숨은 수혜주'를 발굴.

${themeSection}

[2단계: 한국 밸류체인 역추적]
감지된 각 테마에 대해:
1. Google 검색으로 해당 테마의 글로벌 밸류체인 구조를 파악
2. "DART 사업보고서 [키워드]" 또는 "[키워드] 한국 관련 기업 부품 소재"로 검색
3. 한국 상장기업 중 해당 밸류체인에 속하는 기업을 최대 5개 발굴
4. 각 기업의 시장 인지도를 판별:
   - HIDDEN: 아직 시장이 이 테마와 연결짓지 못함 (뉴스 거의 없음) → 최우선 추천
   - EMERGING: 일부 리포트에서 언급되기 시작 → 초기 진입 가능
   - KNOWN: 이미 시장에서 테마주로 인식 → 이미 반영됨, 후순위

[3단계: 투자 타이밍 판정]
- TOO_EARLY: 글로벌 테마 자체가 아직 불확실 (정책 미확정, 기술 미검증)
- OPTIMAL: 글로벌 정책/기술 확정 + 한국 수혜주 아직 미반영 → 최적 진입
- LATE: 한국에서도 이미 테마주로 인식, 주가 선반영 진행 중
- MISSED: 주가 이미 대폭 상승, 진입 시점 지남

응답 형식 (JSON only, 배열):
[
  {
    "theme": "소형모듈원자로(SMR)",
    "globalTrend": {
      "keyword": "Small Modular Reactor commercialization",
      "source": "미국 에너지부 SMR 상용화 지원법 통과",
      "momentum": "ACCELERATING",
      "globalMarketSize": "$120B by 2035"
    },
    "koreaValueChain": [
      { "company": "두산에너빌리티", "code": "034020", "role": "원전 주기기 제조", "revenueExposure": 35, "marketAttention": "KNOWN", "competitiveEdge": "한국 유일 원전 주기기 EPC" },
      { "company": "비에이치아이", "code": "083650", "role": "열교환기·압력용기 부품", "revenueExposure": 20, "marketAttention": "HIDDEN", "competitiveEdge": "SMR 핵심 부품 납품 이력" },
      { "company": "우진", "code": "105840", "role": "원전 계측기기", "revenueExposure": 40, "marketAttention": "HIDDEN", "competitiveEdge": "국내 유일 원전 계측 전문" }
    ],
    "hiddenGems": [
      { "company": "비에이치아이", "code": "083650", "role": "열교환기·압력용기 부품", "revenueExposure": 20, "marketAttention": "HIDDEN", "competitiveEdge": "SMR 핵심 부품 납품 이력" }
    ],
    "totalCompanies": 3,
    "avgMarketAttention": 33,
    "investmentTiming": "OPTIMAL",
    "lastUpdated": "${requestedAtISO}"
  }
]
  `.trim();

  const cacheKey = `theme-reverse-track-${todayDate}`;

  return getCachedAIResponse<ThemeReverseTrackResult[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            maxOutputTokens: 10000,
            temperature: 0.2,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as ThemeReverseTrackResult[];
    } catch (error) {
      console.error("Error in theme reverse tracking:", error);
      return [];
    }
  });
}

// ─── C: 글로벌 상관관계 매트릭스 (Global Correlation Matrix) ─────────────────

/**
 * KOSPI와 주요 글로벌 지수·자산 간 30일 상관계수를 산출.
 * 디커플링(<0.3) 또는 동조화(>0.9) 감지 시 레짐 판단에 반영됩니다.
 */
export async function getGlobalCorrelationMatrix(): Promise<GlobalCorrelationMatrix> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

다음 지수 쌍의 최근 30거래일 상관계수(correlation coefficient)를 Google 검색으로 추정해줘.
각 지수의 최근 30일 일일 수익률 패턴을 비교하여 상관계수를 산출하라.

계산 대상:
1. KOSPI - S&P500: 정상 범위 0.6~0.8, 디커플링 <0.3, 동조화 >0.9
2. KOSPI - 닛케이225: 정상 범위 0.5~0.7
3. KOSPI - 상해종합: 정상 범위 0.3~0.6
4. KOSPI - 달러인덱스(DXY): 보통 음의 상관 -0.3~-0.6

검색 키워드:
- "KOSPI S&P 500 correlation ${todayDate}"
- "KOSPI 코스피 S&P500 상관계수"
- "코스피 나스닥 동조화 디커플링 ${todayDate}"
- "달러인덱스 DXY 코스피 역상관"
- "코스피 닛케이 상해종합 상관관계"

판별 기준:
- isDecoupling: KOSPI-S&P500 상관계수 < 0.3 (한국 특수 요인 발생)
- isGlobalSync: KOSPI-S&P500 상관계수 > 0.9 (외부 충격 전이 모드)

응답 형식 (JSON only):
{
  "kospiSp500": 0.72,
  "kospiNikkei": 0.58,
  "kospiShanghai": 0.41,
  "kospiDxy": -0.45,
  "isDecoupling": false,
  "isGlobalSync": false,
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `global-correlation-${weekKey}`;

  return getCachedAIResponse<GlobalCorrelationMatrix>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as GlobalCorrelationMatrix;
    } catch (error) {
      console.error("Error getting global correlation matrix:", error);
      return {
        kospiSp500: 0.7,
        kospiNikkei: 0.55,
        kospiShanghai: 0.4,
        kospiDxy: -0.45,
        isDecoupling: false,
        isGlobalSync: false,
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── D: 해외 뉴스 멀티소스 집계 (Global Multi-Source Intelligence) ───────────

/**
 * Fed Watch, 중국 PMI, TSMC 매출, BOJ 정책, 미국 ISM, FRED 데이터를
 * 단일 함수로 집계하여 한국 시장 선행지표로 활용합니다.
 */
export async function getGlobalMultiSourceData(): Promise<GlobalMultiSourceData> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

아래 6개 글로벌 데이터 소스의 최신값을 추정하여 JSON으로 반환해줘.
이 데이터는 한국 증시의 선행지표로 활용됩니다.

[1. CME FedWatch - 미국 금리 전망]
검색: "CME FedWatch tool next FOMC meeting probability ${todayDate}"
- 다음 FOMC 회의 일자
- 금리 동결/인하/인상 확률 (%)

[2. 중국 PMI]
검색: "China PMI manufacturing services latest ${todayDate}"
- 제조업 PMI (50 기준: 위=확장, 아래=수축)
- 서비스업 PMI
- 한국 수출의 25%가 중국 → 중국 PMI는 한국 수출 선행지표

[3. 대만 TSMC 월간 매출]
검색: "TSMC monthly revenue latest ${todayDate}"
- 최근 월 매출 (억 대만달러)
- 전년동월비 성장률 (%)
- 한국 반도체 섹터 가장 강력한 선행지표

[4. 일본 BOJ 정책]
검색: "Bank of Japan BOJ interest rate policy latest ${todayDate}"
- 현재 기준금리
- 금리 방향 (인상/동결/인하)
- 엔캐리 트레이드 청산 리스크 판단

[5. 미국 ISM 제조업/서비스업]
검색: "ISM manufacturing PMI services PMI latest ${todayDate}"
- ISM 제조업 PMI (50 기준)
- ISM 서비스업 PMI
- 신규 주문 지수

[6. FRED 핵심 데이터]
검색: "US CPI unemployment rate retail sales latest"
- 미국 CPI (% YoY)
- 미국 실업률 (%)
- 미국 소매판매 (% MoM)

응답 형식 (JSON only):
{
  "fedWatch": {
    "nextMeetingDate": "2026-05-07",
    "holdProbability": 65,
    "cutProbability": 30,
    "hikeProbability": 5
  },
  "chinaPmi": {
    "manufacturing": 50.8,
    "services": 52.3,
    "trend": "EXPANDING"
  },
  "tsmcRevenue": {
    "monthlyRevenueTWD": 2360,
    "yoyGrowth": 35.2,
    "trend": "ACCELERATING",
    "implication": "AI 수요 급증으로 반도체 슈퍼사이클 진행 중. 한국 반도체 섹터 수혜 지속."
  },
  "bojPolicy": {
    "currentRate": 0.5,
    "direction": "HIKING",
    "yenCarryRisk": "MEDIUM",
    "implication": "BOJ 추가 인상 시 엔캐리 청산으로 한국 외국인 자금 유출 위험."
  },
  "usIsm": {
    "manufacturing": 49.2,
    "services": 53.8,
    "newOrders": 51.5,
    "trend": "FLAT"
  },
  "fredData": {
    "usCpi": 2.8,
    "usUnemployment": 3.9,
    "usRetailSales": 0.4
  },
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const cacheKey = `global-multi-source-${todayDate}`;

  return getCachedAIResponse<GlobalMultiSourceData>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as GlobalMultiSourceData;
    } catch (error) {
      console.error("Error getting global multi-source data:", error);
      return {
        fedWatch: { nextMeetingDate: 'N/A', holdProbability: 50, cutProbability: 25, hikeProbability: 25 },
        chinaPmi: { manufacturing: 50, services: 50, trend: 'FLAT' },
        tsmcRevenue: { monthlyRevenueTWD: 0, yoyGrowth: 0, trend: 'STABLE', implication: '데이터 수집 실패' },
        bojPolicy: { currentRate: 0, direction: 'HOLDING', yenCarryRisk: 'LOW', implication: '데이터 수집 실패' },
        usIsm: { manufacturing: 50, services: 50, newOrders: 50, trend: 'FLAT' },
        fredData: { usCpi: 0, usUnemployment: 0, usRetailSales: 0 },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── I: 뉴스 빈도 역지표 (Contrarian News Frequency Score) ───────────────────

/**
 * 특정 종목 리스트에 대해 뉴스 빈도를 조회하고 역지표 점수를 산출.
 * 뉴스가 적을수록 높은 점수 → AI 주목도 편향을 역이용.
 */
export async function getNewsFrequencyScores(
  stocks: { code: string; name: string }[]
): Promise<NewsFrequencyScore[]> {
  if (stocks.length === 0) return [];

  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];

  const stockList = stocks.map(s => `${s.name}(${s.code})`).join(', ');

  const prompt = `
현재 한국 날짜: ${todayDate}

다음 종목들의 최근 30일간 뉴스 빈도를 추정해주세요: ${stockList}

각 종목에 대해:
1. "[종목명] 뉴스 최근" 검색
2. 검색 결과 수와 최근 30일 기사 건수를 추정
3. 아래 기준으로 역지표 점수를 산출

[뉴스 빈도 역지표 채점]
- 0~2건 → score: 10, phase: "SILENT" (Silent Phase — 최고 점수. 시장 미인지.)
- 3~5건 → score: 8, phase: "EARLY" (Early Phase — 초기 관심. 최적 진입 구간.)
- 6~15건 → score: 5, phase: "GROWING" (Growing Attention — 관심 증가 중.)
- 16~30건 → score: 3, phase: "CROWDED" (Crowded — 이미 시장 관심.)
- 30건+ → score: 1, phase: "OVERHYPED" (Over-hyped — 뉴스 과잉. 주가 선반영 가능성.)

[투자 시사점 작성 규칙]
- SILENT: "시장 미인지 종목. 수치적 이상 신호 발생 시 최우선 분석 대상."
- EARLY: "초기 관심 단계. 뉴스가 본격화되기 전 선제 진입 가능 구간."
- GROWING: "관심 증가 중. 이미 일부 주가 반영 시작. 신중한 진입 필요."
- CROWDED: "시장 관심 과다. 추가 상승 여력 제한적. 차익실현 고려."
- OVERHYPED: "뉴스 과잉. 주가 선반영 완료 가능성. 신규 진입 비추천."

응답 형식 (JSON only, 배열):
[
  { "code": "083650", "name": "비에이치아이", "newsCount30d": 1, "score": 10, "phase": "SILENT", "implication": "시장 미인지 종목. 수치적 이상 신호 발생 시 최우선 분석 대상." }
]
  `.trim();

  const cacheKey = `news-freq-${stocks.map(s => s.code).sort().join('-')}-${todayDate}`;

  return getCachedAIResponse<NewsFrequencyScore[]>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: {
            temperature: 0.1,
          },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      const parsed = safeJsonParse(text);
      return (Array.isArray(parsed) ? parsed : parsed?.results ?? []) as NewsFrequencyScore[];
    } catch (error) {
      console.error("Error getting news frequency scores:", error);
      return stocks.map(s => ({
        code: s.code,
        name: s.name,
        newsCount30d: -1,
        score: 5,
        phase: 'GROWING' as const,
        implication: '뉴스 빈도 조회 실패. 기본값 적용.',
      }));
    }
  });
}

// ─── 레이어 I: 공급망 물동량 인텔리전스 (Supply Chain Intelligence) ──────────────

export async function getSupplyChainIntelligence(): Promise<SupplyChainIntelligence> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

아래 3개 공급망 선행지표의 최신값을 추정하여 JSON으로 반환해줘.
한국 조선·반도체·해운 섹터의 선행지표로 활용됩니다.

[1. Baltic Dry Index (BDI) — 벌크 해운 운임 지수]
검색: "Baltic Dry Index today ${todayDate}"
- 현재 BDI 지수
- 3개월 전 대비 변화율 (%)
- 추세 판단: SURGING(+20%이상)/RISING(+5~20%)/FLAT(-5~+5%)/FALLING(-5~-20%)/COLLAPSING(-20%이하)
- 한국 조선/해운 섹터 시사점 (한국어 1줄)

[2. SEMI North America Billings — 반도체 장비 수주]
검색: "SEMI North America semiconductor equipment billings latest ${todayDate}"
검색: "SEMI book-to-bill ratio latest"
- 최근 월 반도체 장비 매출 (십억 달러)
- 전년동월비 성장률 (%)
- Book-to-Bill 비율 (수주/매출, 1.0 이상 = 수요 초과)
- 한국 반도체 시사점 (한국어 1줄)

[3. Global Container Freight Index — 컨테이너 운임]
검색: "Shanghai containerized freight index SCFI latest ${todayDate}"
검색: "Drewry World Container Index"
- 상하이-유럽 운임 ($/40ft)
- 태평양 횡단 운임 ($/40ft)
- 추세: RISING/FLAT/FALLING

응답 형식 (JSON only):
{
  "bdi": { "current": 1850, "mom3Change": 15.2, "trend": "RISING", "sectorImplication": "BDI 3개월 15% 상승 → 벌크선 발주 증가 기대" },
  "semiBillings": { "latestBillionUSD": 3.2, "yoyGrowth": 12.5, "bookToBill": 1.15, "implication": "Book-to-Bill 1.15 → 반도체 업사이클 지속" },
  "gcfi": { "shanghaiEurope": 2800, "transPacific": 3200, "trend": "RISING" },
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `supply-chain-intel-${weekKey}`;

  return getCachedAIResponse<SupplyChainIntelligence>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as SupplyChainIntelligence;
    } catch (error) {
      console.error("Error getting supply chain intelligence:", error);
      return {
        bdi: { current: 0, mom3Change: 0, trend: 'FLAT', sectorImplication: 'BDI 데이터 조회 실패' },
        semiBillings: { latestBillionUSD: 0, yoyGrowth: 0, bookToBill: 1.0, implication: 'SEMI 데이터 조회 실패' },
        gcfi: { shanghaiEurope: 0, transPacific: 0, trend: 'FLAT' },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 레이어 J: 섹터별 글로벌 수주 인텔리전스 (Sector Order Intelligence) ────────

export async function getSectorOrderIntelligence(): Promise<SectorOrderIntelligence> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

한국 증시 주도주 3대 섹터(조선·방산·원자력)의 글로벌 수주 데이터를 추정하여 JSON으로 반환해줘.

[1. 글로벌 방산 예산 트렌드]
검색: "NATO defense spending GDP percentage ${todayDate}"
검색: "US defense budget FY2025 FY2026"
검색: "Korea K2 tank K9 howitzer export contract ${todayDate}"
- NATO 평균 GDP 대비 국방비 (%)
- 미국 국방예산 (억달러)
- 추세: EXPANDING/STABLE/CUTTING
- 한국 방산 수출 파이프라인 현황 (한국어 1줄)

[2. LNG선 발주 동향]
검색: "LNG carrier newbuilding orders ${todayDate}"
검색: "QatarEnergy LNG ship orders"
검색: "global LNG orderbook months"
- 당해년도 LNG선 신규 발주 척수
- 카타르 에너지 발주 상황 (한국어 1줄)
- 수주잔고 개월수
- 한국 조선 섹터 시사점 (한국어 1줄)

[3. SMR(소형모듈원자로) 글로벌 계약]
검색: "SMR small modular reactor NRC approval ${todayDate}"
검색: "SMR global contract GW capacity"
검색: "Korea Hyundai Engineering SMR"
- 미국 NRC 승인 기수
- 계약 총 용량 (GW)
- 한국 현대엔지니어링 등 참여 현황 (한국어 1줄)
- 투자 타이밍: TOO_EARLY/OPTIMAL/LATE

응답 형식 (JSON only):
{
  "globalDefense": { "natoGdpAvg": 2.1, "usDefenseBudget": 8860, "trend": "EXPANDING", "koreaExposure": "K2전차 폴란드 1000대 + K9자주포 다국적 수출 파이프라인 확대" },
  "lngOrders": { "newOrdersYTD": 45, "qatarEnergy": "카타르 NFE 확장 프로젝트 LNG선 발주 지속", "orderBookMonths": 48, "implication": "수주잔고 4년치 → 한국 조선 3사 매출 가시성 최고" },
  "smrContracts": { "usNrcApprovals": 1, "totalGwCapacity": 12.5, "koreaHyundai": "현대엔지니어링 i-SMR 설계 인가 추진 중", "timing": "TOO_EARLY" },
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `sector-order-intel-${weekKey}`;

  return getCachedAIResponse<SectorOrderIntelligence>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as SectorOrderIntelligence;
    } catch (error) {
      console.error("Error getting sector order intelligence:", error);
      return {
        globalDefense: { natoGdpAvg: 0, usDefenseBudget: 0, trend: 'STABLE', koreaExposure: '데이터 조회 실패' },
        lngOrders: { newOrdersYTD: 0, qatarEnergy: '데이터 조회 실패', orderBookMonths: 0, implication: '데이터 조회 실패' },
        smrContracts: { usNrcApprovals: 0, totalGwCapacity: 0, koreaHyundai: '데이터 조회 실패', timing: 'TOO_EARLY' },
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 레이어 K: 금융시스템 스트레스 인덱스 (Financial Stress Index) ───────────────

export async function getFinancialStressIndex(): Promise<FinancialStressIndex> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

금융시스템 스트레스 조기경보 지표 3개를 추정하여 JSON으로 반환해줘.
이 지표는 한국 증시 Gate 0 (매수 중단) 판단의 핵심 입력입니다.

[1. TED Spread — 은행간 신용리스크]
검색: "TED spread today ${todayDate}"
검색: "3-month LIBOR minus T-Bill spread"
- 현재 bp (정상: 10~50bp, 위험: 100bp+)
- 알림 수준: NORMAL(~50bp)/ELEVATED(50~100bp)/CRISIS(100bp+)

[2. US High Yield Spread — 기업 크레딧]
검색: "US high yield bond spread OAS today ${todayDate}"
검색: "ICE BofA US High Yield Index OAS"
- 현재 bp (정상: 300~400bp, 위험: 600bp+)
- 추세: TIGHTENING/STABLE/WIDENING

[3. MOVE Index — 채권시장 변동성 (채권판 VIX)]
검색: "MOVE index today ${todayDate}"
검색: "ICE BofA MOVE index"
- 현재값 (정상: 80~100, 위험: 150+)
- 알림 수준: NORMAL(~100)/ELEVATED(100~150)/EXTREME(150+)

종합 FSI 계산법:
- compositeScore = (tedSpread가 CRISIS?40:tedSpread가 ELEVATED?20:0) + (usHySpread>600?40:usHySpread>500?20:0) + (moveIndex>150?20:moveIndex>120?10:0)
- systemAction: compositeScore>=60→CRISIS, >=40→DEFENSIVE, >=20→CAUTION, else NORMAL

응답 형식 (JSON only):
{
  "tedSpread": { "bps": 25, "alert": "NORMAL" },
  "usHySpread": { "bps": 350, "trend": "STABLE" },
  "moveIndex": { "current": 95, "alert": "NORMAL" },
  "compositeScore": 0,
  "systemAction": "NORMAL",
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `financial-stress-index-${weekKey}`;

  return getCachedAIResponse<FinancialStressIndex>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as FinancialStressIndex;
    } catch (error) {
      console.error("Error getting financial stress index:", error);
      return {
        tedSpread: { bps: 0, alert: 'NORMAL' },
        usHySpread: { bps: 0, trend: 'STABLE' },
        moveIndex: { current: 0, alert: 'NORMAL' },
        compositeScore: 0,
        systemAction: 'NORMAL',
        lastUpdated: requestedAtISO,
      };
    }
  });
}

// ─── 레이어 L: FOMC 문서 감성 분석 (FOMC Sentiment Analysis) ────────────────────

export async function getFomcSentimentAnalysis(): Promise<FomcSentimentAnalysis> {
  const requestedAt = new Date();
  const todayDate = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }).split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  const prompt = `
현재 날짜: ${todayDate}

최근 FOMC 의사록/성명서/기자회견 텍스트를 분석하여 매파/비둘기파 스코어를 산출해줘.
이 분석은 한국 증시에 대한 미국 통화정책 영향을 정량화합니다.

[1. 매파/비둘기파 스코어]
검색: "FOMC statement minutes latest ${todayDate}"
검색: "Fed hawkish dovish analysis latest"
- 점수: -10(극비둘기) ~ +10(극매파)
- 핵심 문구 추출: "higher for longer", "data dependent", "gradual", "patient" 등

[2. 점도표(Dot Plot) 변화 방향]
검색: "FOMC dot plot median rate projection latest ${todayDate}"
- 이전 점도표 대비 변화: MORE_CUTS(인하 더 많음)/UNCHANGED/FEWER_CUTS(인하 축소)

[3. 한국 증시 임팩트 판단]
- BULLISH: 비둘기파(점수 -5 이하) → 달러 약세 → 외국인 유입
- NEUTRAL: 중립(-5 ~ +5) → 영향 제한적
- BEARISH: 매파(점수 +5 이상) → 달러 강세 → 외국인 유출
- 한국 증시 영향 근거 (한국어 1줄)

응답 형식 (JSON only):
{
  "hawkDovishScore": 3,
  "keyPhrases": ["data dependent", "gradual approach", "labor market strong"],
  "dotPlotShift": "FEWER_CUTS",
  "kospiImpact": "BEARISH",
  "rationale": "매파적 전환 → 달러 강세 → 외국인 자금 유출 압력",
  "lastUpdated": "${requestedAtISO}"
}
  `.trim();

  const weekKey = `${requestedAt.getFullYear()}-W${Math.ceil(requestedAt.getDate() / 7)}`;
  const cacheKey = `fomc-sentiment-${weekKey}`;

  return getCachedAIResponse<FomcSentimentAnalysis>(cacheKey, async () => {
    try {
      const response = await withRetry(async () => {
        return await getAI().models.generateContent({
          model: AI_MODELS.PRIMARY,
          contents: prompt,
          config: { temperature: 0.1 },
        });
      }, 2, 2000);
      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return safeJsonParse(text) as FomcSentimentAnalysis;
    } catch (error) {
      console.error("Error getting FOMC sentiment analysis:", error);
      return {
        hawkDovishScore: 0,
        keyPhrases: [],
        dotPlotShift: 'UNCHANGED',
        kospiImpact: 'NEUTRAL',
        rationale: 'FOMC 감성 분석 실패. 기본값 적용.',
        lastUpdated: requestedAtISO,
      };
    }
  });
}
