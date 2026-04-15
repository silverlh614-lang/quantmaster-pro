import { AI_MODELS } from "../../constants/aiConfig";
import { getAI, aiCache, lsSet, withRetry, safeJsonParse, getCachedAIResponse } from './aiClient';
import { fetchMarketIndicators } from './marketOverview';
import { getMacroSnapshot, snapshotToMacroFields, getTradeData } from '../ecosService';
import { debugLog, debugWarn } from '../../utils/debug';
import type {
  MacroEnvironment,
  EconomicRegimeData,
  SmartMoneyData,
  ExportMomentumData,
  GeopoliticalRiskData,
  CreditSpreadData,
  ExtendedRegimeData,
  GlobalCorrelationMatrix,
  FomcSentimentAnalysis,
  SupplyChainIntelligence,
  SectorOrderIntelligence,
} from '../../types/quant';

// ─── 배치 통합 호출 (12개 → 3개 압축) ─────────────────────────────────────────
//
// Batch 1: getBatchGlobalIntel()  — macro + regime + extendedRegime + creditSpreads + financialStress + smartMoney
// Batch 2: getBatchSectorIntel()  — exportMomentum + geoRisk + supplyChain + sectorOrders
// Batch 3: getBatchMarketIntel()  — globalCorrelation + fomcSentiment

export interface BatchGlobalIntelResult {
  macro: MacroEnvironment;
  regime: EconomicRegimeData;
  extendedRegime: ExtendedRegimeData;
  creditSpreads: CreditSpreadData;
  financialStress: import('../../types/quant').FinancialStressIndex;
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
 * Phase A (Search 없음): ECOS + Yahoo → macro + regime + extendedRegime
 * Phase B (Search 없음): FRED + Yahoo → creditSpreads + financialStress + smartMoney
 */
export async function getBatchGlobalIntel(): Promise<BatchGlobalIntelResult> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  type EcosF = Partial<{
    bokRateDirection: 'HIKING' | 'HOLDING' | 'CUTTING';
    m2GrowthYoY: number; nominalGdpGrowth: number;
    exportGrowth3mAvg: number; usdKrw: number;
    bankLendingGrowth: number;
  }>;
  let ecosFields: EcosF = {};
  let yahooFields = { vix: null as number | null, us10yYield: null as number | null,
                      usShortRate: null as number | null, samsungIri: null as number | null,
                      vkospi: null as number | null,
                      vkospiDayChange: null as number | null,
                      vkospi5dTrend: null as number | null };
  let bokRateValue: number | null = null;

  const [ecosSnapshotR, yahooR] = await Promise.allSettled([
    getMacroSnapshot(),
    fetchMarketIndicators(),
  ]);
  if (ecosSnapshotR.status === 'fulfilled') {
    const snap = ecosSnapshotR.value;
    ecosFields = snapshotToMacroFields(snap);
    if (snap.bokRate) bokRateValue = snap.bokRate.rate;
    debugLog('[getBatchGlobalIntel] ECOS 수집 완료', Object.keys(ecosFields));
  } else {
    debugWarn('[getBatchGlobalIntel] ECOS 수집 실패', ecosSnapshotR.reason);
  }
  if (yahooR.status === 'fulfilled') {
    yahooFields = yahooR.value;
    debugLog('[getBatchGlobalIntel] Yahoo 수집 완료', { vix: yahooFields.vix, us10y: yahooFields.us10yYield });
  }

  const krUsSpread = (bokRateValue !== null && yahooFields.usShortRate !== null)
    ? parseFloat((bokRateValue - yahooFields.usShortRate).toFixed(2))
    : null;

  const preFilledMacro: Record<string, number | string> = {
    ...(ecosFields.bokRateDirection    ? { bokRateDirection:    ecosFields.bokRateDirection }    : {}),
    ...(ecosFields.m2GrowthYoY        !== undefined ? { m2GrowthYoY:        ecosFields.m2GrowthYoY }        : {}),
    ...(ecosFields.nominalGdpGrowth   !== undefined ? { nominalGdpGrowth:   ecosFields.nominalGdpGrowth }   : {}),
    ...(ecosFields.exportGrowth3mAvg  !== undefined ? { exportGrowth3mAvg:  ecosFields.exportGrowth3mAvg }  : {}),
    ...(ecosFields.usdKrw             !== undefined ? { usdKrw:             ecosFields.usdKrw }             : {}),
    ...(ecosFields.bankLendingGrowth  !== undefined ? { bankLendingGrowth:  ecosFields.bankLendingGrowth }  : {}),
    ...(yahooFields.vix       !== null ? { vix:        yahooFields.vix }       : {}),
    ...(yahooFields.us10yYield !== null ? { us10yYield: yahooFields.us10yYield } : {}),
    ...(yahooFields.samsungIri !== null ? { samsungIri: yahooFields.samsungIri } : {}),
    ...(yahooFields.vkospi    !== null ? { vkospi:     yahooFields.vkospi }    : {}),
    ...(krUsSpread             !== null ? { krUsSpread }                          : {}),
  };
  const preFilledCount = Object.keys(preFilledMacro).length;
  debugLog(`[getBatchGlobalIntel] 사전 확보 macro 필드 ${preFilledCount}/12`);

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

  const [fredHyR, fredSofrR, yahooPhaseB] = await Promise.allSettled([
    fetchFred('BAMLH0A0HYM2'),
    fetchFred('SOFR'),
    fetchMarketIndicators(),
  ]);

  const fredHySpread  = fredHyR.status  === 'fulfilled' && fredHyR.value  !== null ? Math.round(fredHyR.value * 100)  : null;
  const fredSofr      = fredSofrR.status === 'fulfilled' && fredSofrR.value !== null ? fredSofrR.value : null;
  const yahooB        = yahooPhaseB.status === 'fulfilled' ? yahooPhaseB.value : null;
  const tedSpreadBps  = (fredSofr !== null && yahooB?.usShortRate != null)
    ? Math.round((fredSofr - (yahooB.usShortRate ?? 0)) * 100) : null;
  const ewyRet  = yahooB?.ewyReturn  ?? null;
  const mtumRet = yahooB?.mtumReturn ?? null;

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
    const [phaseARes, phaseBRes] = await Promise.allSettled([
      withRetry(() => getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: phaseAPrompt,
        config: { temperature: 0.1, maxOutputTokens: 4096 },
      }), 2, 2000),
      withRetry(() => getAI().models.generateContent({
        model: AI_MODELS.PRIMARY,
        contents: phaseBPrompt,
        config: { temperature: 0.1, maxOutputTokens: 4096 },
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

    const apiOverride = {
      ...ecosFields,
      ...(yahooFields.vix             !== null ? { vix:             yahooFields.vix }             : {}),
      ...(yahooFields.us10yYield      !== null ? { us10yYield:      yahooFields.us10yYield }      : {}),
      ...(yahooFields.samsungIri      !== null ? { samsungIri:      yahooFields.samsungIri }      : {}),
      ...(yahooFields.vkospi          !== null ? { vkospi:          yahooFields.vkospi }          : {}),
      ...(yahooFields.vkospiDayChange !== null ? { vkospiDayChange: yahooFields.vkospiDayChange } : {}),
      ...(yahooFields.vkospi5dTrend   !== null ? { vkospi5dTrend:   yahooFields.vkospi5dTrend }   : {}),
      ...(krUsSpread                  !== null ? { krUsSpread }                                    : {}),
    } as Partial<typeof parsed.macro>;
    if (Object.keys(apiOverride).length > 0) {
      parsed.macro = { ...parsed.macro, ...apiOverride };
      debugLog('[getBatchGlobalIntel] API 실데이터 오버라이드', Object.keys(apiOverride));
    }

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
 */
export async function getBatchSectorIntel(): Promise<BatchSectorIntelResult> {
  const requestedAt = new Date();
  const now = requestedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const todayDate = now.split(' ')[0];
  const requestedAtISO = requestedAt.toISOString();

  let ecosExport: { latestYoY: number; ma3m: number; consecutivePositive: number; monthlyRows: string } | null = null;
  try {
    const rows = await getTradeData(4);
    if (rows.length >= 3) {
      const recent = rows.slice(-4);
      const latestYoY = recent[recent.length - 1].exportGrowthYoY;
      const ma3m = parseFloat(
        (recent.slice(-3).reduce((s, d) => s + d.exportGrowthYoY, 0) / 3).toFixed(2)
      );
      let consecutivePositive = 0;
      for (let i = recent.length - 1; i >= 0; i--) {
        if (recent[i].exportGrowthYoY > 0) consecutivePositive++;
        else break;
      }
      const monthlyRows = recent
        .map(d => `  ${d.date}: YoY ${d.exportGrowthYoY > 0 ? '+' : ''}${d.exportGrowthYoY.toFixed(1)}%`)
        .join('\n');
      ecosExport = { latestYoY, ma3m, consecutivePositive, monthlyRows };
      debugLog('[getBatchSectorIntel] ECOS 수출 수집 완료', { latestYoY, ma3m });
    }
  } catch (e) {
    console.warn('[getBatchSectorIntel] ECOS 수출 수집 실패:', e);
  }

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
 * Batch 3: 시장 상관관계 & FOMC 센티먼트 통합 호출.
 * globalCorrelation + fomcSentiment
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
