// @responsibility stock enrichment 서비스 모듈
import {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateStochastic,
  calculateIchimoku,
  detectVCP,
  calculateDisparity
} from "../../utils/indicators";
import { fetchCorpCode, fetchDartFinancials } from './dartDataFetcher';
import { fetchHistoricalData } from './historicalData';
import { fetchAiUniverseSnapshot, type AiUniverseValuation } from '../../api/aiUniverseClient';
import type { StockRecommendation } from './types';
import type { TranchePlan } from '../../types/quant';

interface KrxValuation {
  per: number;
  pbr: number;
  eps: number;
  bps: number;
  marketCap: number;         // 억원
  marketCapDisplay: string;  // "12.3조" / "3,450억"
}

// 세션 스코프 in-memory 캐시 — 한 번의 분석 사이클에서 동일 종목 코드 중복 호출을 줄인다.
const _valuationCache = new Map<string, KrxValuation | null>();

// ─── PR-B (ADR-0019): 27 조건 sourceTier 메타 빌드 ─────────────────────────

type ChecklistKey = keyof StockRecommendation['checklist'];
type ConditionSourceTier = 'COMPUTED' | 'API' | 'AI_INFERRED';

/** 27 조건 모든 키 — 메타 미커버 항목은 'AI_INFERRED' 기본값. */
const ALL_CHECKLIST_KEYS_27: readonly ChecklistKey[] = [
  'cycleVerified', 'momentumRanking', 'roeType3', 'supplyInflow', 'riskOnEnvironment',
  'ichimokuBreakout', 'mechanicalStop', 'economicMoatVerified', 'notPreviousLeader',
  'technicalGoldenCross', 'volumeSurgeVerified', 'institutionalBuying', 'consensusTarget',
  'earningsSurprise', 'performanceReality', 'policyAlignment', 'psychologicalObjectivity',
  'turtleBreakout', 'fibonacciLevel', 'elliottWaveVerified', 'ocfQuality',
  'marginAcceleration', 'interestCoverage', 'relativeStrength', 'vcpPattern',
  'divergenceCheck', 'catalystAnalysis',
];

interface SourceTierContext {
  /** DART fetch 가 실제 데이터를 반환했는가 (null/throw 가 아님). */
  hasDartFinancials: boolean;
  /** KIS supply (Naver snapshot stub) 가 실제 외인비율 반환했는가. */
  hasKisSupply: boolean;
  /** vcpPattern 이 OHLCV 로 실제 계산되었는가. */
  hasVcpComputed: boolean;
}

/**
 * 27 조건 출처 분류 메타를 빌드한다.
 *
 * 본 PR-B 는 enrichment 가 실제 사용한 데이터 소스를 정직하게 반영한다.
 * 휴리스틱 PR-A 가 "ichimokuBreakout=COMPUTED" 로 가정했던 항목들도 실제로는
 * `...stock.checklist` (Gemini AI 스코어) 를 그대로 보존하므로 'AI_INFERRED' 로 표기.
 */
export function buildConditionSourceTiers(ctx: SourceTierContext): Partial<Record<ChecklistKey, ConditionSourceTier>> {
  const meta: Partial<Record<ChecklistKey, ConditionSourceTier>> = {};

  // 모든 키 기본 'AI_INFERRED' (Gemini 가 채워준 ChecklistKey 점수 그대로)
  for (const k of ALL_CHECKLIST_KEYS_27) {
    meta[k] = 'AI_INFERRED';
  }

  // COMPUTED — 클라이언트 OHLCV 직접 계산
  if (ctx.hasVcpComputed) meta.vcpPattern = 'COMPUTED';

  // API — DART 응답 사용
  if (ctx.hasDartFinancials) {
    meta.roeType3 = 'API';
    meta.ocfQuality = 'API';
    meta.interestCoverage = 'API';
  }

  // API — KIS 수급 (Naver snapshot stub) 사용
  if (ctx.hasKisSupply) {
    meta.institutionalBuying = 'API';
    meta.supplyInflow = 'API';
  }

  return meta;
}

/**
 * PR-25-C: Naver snapshot 의 `foreignerOwnRatio` 를 기존 supplyData 스키마와
 * 호환되는 stub 으로 변환. 일별 순매수·연속일수 는 AI 프롬프트 자체 판단으로
 * 위임하므로 0/빈 배열. 호출자 코드 변경 없이 `supplyData` 필드를 유지.
 */
export function buildSnapshotSupplyStub(snap: AiUniverseValuation | null): {
  foreignNet: number; institutionNet: number; individualNet: number;
  foreignConsecutive: number; institutionalDailyAmounts: number[];
  isPassiveAndActive: boolean; foreignerOwnRatio: number;
  dataSource: 'NAVER_SNAPSHOT' | 'NONE';
} | null {
  if (!snap) return null;
  return {
    foreignNet: 0,
    institutionNet: 0,
    individualNet: 0,
    foreignConsecutive: 0,
    institutionalDailyAmounts: [],
    isPassiveAndActive: false,
    foreignerOwnRatio: snap.foreignerOwnRatio,
    dataSource: snap.found ? 'NAVER_SNAPSHOT' : 'NONE',
  };
}

/**
 * 종목 밸류에이션 조회 — PR-25-B (ADR-0011): KIS/KRX 비의존 통로 사용.
 * 서버 `/api/ai-universe/snapshot` 으로 라우팅되어 Naver Finance 모바일 endpoint 에서
 * 무비용 enrichment. 응답 schema 는 기존 KRX valuation 호환을 유지.
 * 실패·빈 데이터는 null 반환하여 호출측에서 기존 값을 보존.
 */
async function fetchKrxValuation(code: string): Promise<KrxValuation | null> {
  const baseCode = code.split('.')[0];
  if (!/^\d{6}$/.test(baseCode)) return null;
  if (_valuationCache.has(baseCode)) return _valuationCache.get(baseCode) ?? null;
  try {
    const { fetchAiUniverseSnapshot } = await import('../../api/aiUniverseClient');
    const data = await fetchAiUniverseSnapshot(baseCode);
    if (!data) { _valuationCache.set(baseCode, null); return null; }
    const result: KrxValuation = {
      per: Number(data.per) || 0,
      pbr: Number(data.pbr) || 0,
      eps: Number(data.eps) || 0,
      bps: Number(data.bps) || 0,
      marketCap: Number(data.marketCap) || 0,
      marketCapDisplay: typeof data.marketCapDisplay === 'string' ? data.marketCapDisplay : '',
    };
    const isEmpty = result.per <= 0 && result.pbr <= 0 && result.marketCap <= 0;
    const cached = isEmpty ? null : result;
    _valuationCache.set(baseCode, cached);
    return cached;
  } catch {
    _valuationCache.set(baseCode, null);
    return null;
  }
}

/**
 * 27-항목 checklist 와 ichimokuStatus 로부터 3-Gate Pyramid 의 개별 게이트 점수를 계산한다.
 * AI 프롬프트의 Gate 정의를 그대로 사용:
 *   - Gate 1 (Survival, 5): cycleVerified, roeType3, riskOnEnvironment, mechanicalStop, notPreviousLeader
 *   - Gate 2 (Growth, 12): supply*·ichimokuBreakout·economicMoatVerified·technicalGoldenCross·volumeSurgeVerified·
 *                          institutionalBuying·consensusTarget·earningsSurprise·performanceReality·policyAlignment·
 *                          ocfQuality·relativeStrength
 *   - Gate 3 (Precision, 10): psychologicalObjectivity·turtleBreakout·fibonacciLevel·elliottWaveVerified·vcpPattern·
 *                             divergenceCheck·momentumRanking·marginAcceleration·interestCoverage·catalystAnalysis
 * 통과 기준: Gate 1 전부 / Gate 2 ≥ 9 / Gate 3 ≥ 6 (프롬프트와 동일).
 */
function computeGateEvaluation(stock: StockRecommendation): StockRecommendation['gateEvaluation'] {
  const cl = stock.checklist || ({} as StockRecommendation['checklist']);
  const v = (k: keyof typeof cl) => (cl[k] ? 1 : 0);

  const gate1Keys: (keyof typeof cl)[] = [
    'cycleVerified', 'roeType3', 'riskOnEnvironment', 'mechanicalStop', 'notPreviousLeader',
  ];
  const gate2Keys: (keyof typeof cl)[] = [
    'supplyInflow', 'ichimokuBreakout', 'economicMoatVerified', 'technicalGoldenCross',
    'volumeSurgeVerified', 'institutionalBuying', 'consensusTarget', 'earningsSurprise',
    'performanceReality', 'policyAlignment', 'ocfQuality', 'relativeStrength',
  ];
  const gate3Keys: (keyof typeof cl)[] = [
    'psychologicalObjectivity', 'turtleBreakout', 'fibonacciLevel', 'elliottWaveVerified',
    'vcpPattern', 'divergenceCheck', 'momentumRanking', 'marginAcceleration',
    'interestCoverage', 'catalystAnalysis',
  ];

  const gate1Score = gate1Keys.reduce((s, k) => s + v(k), 0);
  const gate2Score = gate2Keys.reduce((s, k) => s + v(k), 0);
  const gate3Score = gate3Keys.reduce((s, k) => s + v(k), 0);

  const gate1Passed = gate1Score === gate1Keys.length;
  const gate2Passed = gate2Score >= 9;
  const gate3Passed = gate3Score >= 6;

  const currentGate = !gate1Passed ? 1 : !gate2Passed ? 2 : !gate3Passed ? 3 : 3;
  const isPassed = gate1Passed && gate2Passed && gate3Passed;

  const reason = (score: number, total: number, pass: boolean) =>
    pass ? `통과 (${score}/${total} 항목 충족)` : `미충족 (${score}/${total} 항목, 기준 미달)`;

  const prev = stock.gateEvaluation;
  return {
    gate1Passed,
    gate2Passed,
    gate3Passed,
    finalScore: gate1Score + gate2Score + gate3Score,
    recommendation: prev?.recommendation ?? (isPassed ? 'BUY 적격' : `Gate ${currentGate} 에서 중단`),
    positionSize: prev?.positionSize ?? 0,
    isPassed,
    currentGate,
    gate1: { score: gate1Score, isPassed: gate1Passed, reason: reason(gate1Score, gate1Keys.length, gate1Passed) },
    gate2: { score: gate2Score, isPassed: gate2Passed, reason: reason(gate2Score, gate2Keys.length, gate2Passed) },
    gate3: { score: gate3Score, isPassed: gate3Passed, reason: reason(gate3Score, gate3Keys.length, gate3Passed) },
  };
}

/**
 * sectorAnalysis.leadingStocks[].marketCap 가 AI 플레이스홀더("..." 등) 이면 실데이터로 덮어쓴다.
 * 각 종목코드별로 `/api/krx/valuation` 를 호출하며, 캐시 덕분에 동일 코드는 1회만 조회된다.
 */
async function enrichLeadingStocksMarketCap(
  leadingStocks: { name: string; code: string; marketCap: string }[],
): Promise<{ name: string; code: string; marketCap: string }[]> {
  return Promise.all(leadingStocks.map(async (s) => {
    const current = typeof s.marketCap === 'string' ? s.marketCap.trim() : '';
    // AI 가 정상 값(예: "12조 3,450억")을 넣었으면 그대로 유지.
    const looksValid = /\d/.test(current) && !/^\.+$/.test(current);
    if (looksValid) return s;
    const baseCode = (s.code || '').split('.')[0];
    if (!/^\d{6}$/.test(baseCode)) return { ...s, marketCap: current || '데이터 없음' };
    const val = await fetchKrxValuation(baseCode);
    return { ...s, marketCap: val?.marketCapDisplay || '데이터 없음' };
  }));
}

export function calculateTranchePlan(currentPrice: number, stopLoss: number, targetPrice: number): TranchePlan {
  const risk = currentPrice - stopLoss;
  const reward = targetPrice - currentPrice;

  return {
    tranche1: { size: 30, trigger: `${currentPrice.toLocaleString()} (즉시)`, status: 'PENDING' },
    tranche2: { size: 40, trigger: `${Math.round(currentPrice - (risk * 0.382)).toLocaleString()} (피보나치 38.2%)`, status: 'PENDING' },
    tranche3: { size: 30, trigger: `${Math.round(currentPrice + (reward * 0.1)).toLocaleString()} (모멘텀 가속)`, status: 'PENDING' }
  };
}

/**
 * AI 응답이 토큰 한도로 잘려 trading 필드(targetPrice/stopLoss/entryPrice)가 0 으로
 * 남은 경우를 보정한다. 현재가 기반 기본값:
 *   - targetPrice: +20% (1차 목표 표준)
 *   - targetPrice2: +35%
 *   - entryPrice:   현재가
 *   - stopLoss:     -7%
 * 이미 유효값이 있으면(> 0) 그대로 통과.
 */
export function applyTradingFieldFallbacks<
  T extends {
    targetPrice?: number;
    targetPrice2?: number;
    entryPrice?: number;
    stopLoss?: number;
  }
>(stock: T, currentPrice: number): T {
  if (!currentPrice || currentPrice <= 0) return stock;
  const isValid = (v: number | undefined): v is number => typeof v === 'number' && v > 0;
  return {
    ...stock,
    targetPrice:  isValid(stock.targetPrice)  ? stock.targetPrice  : Math.round(currentPrice * 1.20),
    targetPrice2: isValid(stock.targetPrice2) ? stock.targetPrice2 : Math.round(currentPrice * 1.35),
    entryPrice:   isValid(stock.entryPrice)   ? stock.entryPrice   : Math.round(currentPrice),
    stopLoss:     isValid(stock.stopLoss)     ? stock.stopLoss     : Math.round(currentPrice * 0.93),
  };
}

export async function enrichStockWithRealData(stock: StockRecommendation): Promise<StockRecommendation> {
  // Fix 2 + 2026-04-24 추가 — enrich 실패 경로에서 currentPrice 가 0 으로 남는 문제 해소.
  // 사용자 체감: AI 추천 카드는 보이지만 가격이 모두 "-" 로 표시되어 "표시 안 됨" 으로 인지.
  // 원인: 장외/주말에 fetchHistoricalData 가 null 반환 → aiFallback 진입 → Gemini 가
  //       프롬프트 지시대로 currentPrice=0 으로 응답 → applyTradingFieldFallbacks 도
  //       currentPrice<=0 이면 비활성화. Naver snapshot 의 closePrice(전일 종가) 로 보강.
  //
  // 2026-04-25: 펀더멘털 우선순위 = DART → Naver (DART 사업보고서가 신뢰도가 더 높다).
  // aiFallback 도 corpCode 가 있으면 DART 를 먼저 시도하고, 없거나 실패한 필드만
  // Naver snapshot 으로 보강해 일관된 SSOT 우선순위를 유지한다.
  const aiFallback = async (override?: { currentPrice?: number; per?: number; pbr?: number; marketCap?: number }): Promise<StockRecommendation> => {
    let resolvedPrice = stock.currentPrice || override?.currentPrice || 0;
    let snapPer = override?.per ?? 0;
    let snapPbr = override?.pbr ?? 0;
    let snapMarketCap = override?.marketCap ?? 0;

    // ─── DART 펀더멘털 (1순위) ──────────────────────────────────────────────
    // DART 사업보고서 기반 ROE/debt/OCF/이자보상/EPS 성장 — Naver 보다 신뢰도 우위.
    let fallbackDart: Awaited<ReturnType<typeof fetchDartFinancials>> = null;
    if (!stock.corpCode) {
      try { stock.corpCode = (await fetchCorpCode(stock.code)) || undefined; } catch { /* noop */ }
    }
    if (stock.corpCode) {
      try { fallbackDart = await fetchDartFinancials(stock.corpCode); } catch { /* noop */ }
    }

    // ─── Naver snapshot (2순위) — DART 미제공 필드(가격/PER/PBR/시총) 보강 ───
    let priceSource = '';
    if (!resolvedPrice || resolvedPrice <= 0) {
      const baseCode = (stock.code || '').split('.')[0];
      if (/^\d{6}$/.test(baseCode)) {
        try {
          const snap = await fetchAiUniverseSnapshot(baseCode);
          if (snap) {
            if (snap.closePrice && snap.closePrice > 0) {
              resolvedPrice = snap.closePrice;
              priceSource = '전일 종가 (Naver)';
            }
            if (snap.per > 0) snapPer = snap.per;
            if (snap.pbr > 0) snapPbr = snap.pbr;
            if (snap.marketCap > 0) snapMarketCap = snap.marketCap;
          }
        } catch { /* SDS-ignore: snapshot 실패 시 가격 보강 포기 — 카드는 그대로 표시 */ }
      }
    }
    const fallback = applyTradingFieldFallbacks(
      { targetPrice: stock.targetPrice, targetPrice2: stock.targetPrice2,
        entryPrice: stock.entryPrice, stopLoss: stock.stopLoss },
      resolvedPrice,
    );
    const merged: StockRecommendation = {
      ...stock,
      currentPrice: resolvedPrice || stock.currentPrice,
      targetPrice:  fallback.targetPrice  ?? stock.targetPrice,
      targetPrice2: fallback.targetPrice2 ?? stock.targetPrice2,
      entryPrice:   fallback.entryPrice   ?? stock.entryPrice,
      stopLoss:     fallback.stopLoss     ?? stock.stopLoss,
      dataSourceType: resolvedPrice > 0 ? 'STALE' : 'AI',
      priceUpdatedAt: resolvedPrice > 0 && resolvedPrice !== stock.currentPrice && priceSource
        ? priceSource
        : stock.priceUpdatedAt,
      valuation: {
        ...stock.valuation,
        // DART 가 직접 제공하지 않는 PER/PBR 은 Naver snapshot 사용.
        per: (snapPer > 0) ? snapPer : stock.valuation.per,
        pbr: (snapPbr > 0) ? snapPbr : stock.valuation.pbr,
        // 펀더멘털: DART 우선 → 없으면 기존 값 유지.
        debtRatio: fallbackDart?.debtRatio || stock.valuation.debtRatio,
        epsGrowth: (typeof fallbackDart?.epsGrowth === 'number' && fallbackDart.epsGrowth !== 0)
          ? fallbackDart.epsGrowth
          : stock.valuation.epsGrowth,
      },
      marketCap: (snapMarketCap > 0) ? snapMarketCap : stock.marketCap,
      checklist: {
        ...stock.checklist,
        // DART 우선 — 펀더멘털 게이트도 fallback 경로에서 활성화.
        roeType3: (fallbackDart?.roe ?? 0) >= 15 ? 1 : (stock.checklist?.roeType3 ?? 0),
        ocfQuality: fallbackDart?.ocfGreaterThanNetIncome ? 1 : (stock.checklist?.ocfQuality ?? 0),
        interestCoverage: (fallbackDart?.interestCoverageRatio ?? 0) >= 3 ? 1 : (stock.checklist?.interestCoverage ?? 0),
      },
      // PR-B (ADR-0019): aiFallback 경로 — DART 만 가용 (vcp/kisSupply 없음)
      conditionSourceTiers: buildConditionSourceTiers({
        hasDartFinancials: fallbackDart != null,
        hasKisSupply: false,
        hasVcpComputed: false,
      }),
      financialUpdatedAt: fallbackDart?.updatedAt || stock.financialUpdatedAt,
    };
    // Enrichment 전체가 실패해도 3-Gate Pyramid 는 checklist 기반 계산이므로 채워둔다.
    merged.gateEvaluation = computeGateEvaluation(merged);
    return merged;
  };

  try {
    const data = await fetchHistoricalData(stock.code, '1y');
    if (!data || !data.timestamp || !data.indicators?.quote?.[0]) {
      return await aiFallback();
    }

    const quotes = data.indicators.quote[0];
    const closes = (quotes.close as (number | null)[]).filter((v): v is number => v !== null);
    const highs = (quotes.high as (number | null)[]).filter((v): v is number => v !== null);
    const lows = (quotes.low as (number | null)[]).filter((v): v is number => v !== null);
    const volumes = (quotes.volume as (number | null)[]).filter((v): v is number => v !== null);

    if (closes.length < 26) return await aiFallback();

    const rsi = calculateRSI(closes);
    const macd = calculateMACD(closes);
    const bb = calculateBollingerBands(closes);
    const stoch = calculateStochastic(highs, lows, closes);
    const ichimoku = calculateIchimoku(highs, lows, closes);
    const vcp = detectVCP(closes, volumes);
    const disparity = calculateDisparity(closes);

    const currentPrice = closes[closes.length - 1];

    // ─── 펀더멘털 우선순위: DART → Naver (2026-04-25) ─────────────────────────
    // DART 사업보고서 기반 ROE/debtRatio/OCF/이자보상/EPS성장 이 Naver snapshot 보다
    // 신뢰도가 높다. 따라서 DART 를 먼저 호출해 펀더멘털을 채우고, DART 가 직접
    // 제공하지 않는 PER/PBR/시총/외인지분율 만 Naver snapshot 으로 보강한다.
    let dartFinancials = null;
    if (!stock.corpCode) {
      stock.corpCode = await fetchCorpCode(stock.code) || undefined;
    }
    if (stock.corpCode) {
      dartFinancials = await fetchDartFinancials(stock.corpCode);
    }

    let kisSupply = null;
    let kisShort = null;
    let krxValuation: KrxValuation | null = null;
    const isKoreanStock = /^\d{6}$/.test(stock.code.split('.')[0]);
    if (isKoreanStock) {
      const baseCode = stock.code.split('.')[0];
      // PR-25-C (ADR-0011): KIS 수급·공매도 호출 제거 — Naver 모바일 snapshot 의 정적
      // `foreignerOwnRatio` 만 유지. 일별 순매수·공매도 잔고는 AI 프롬프트가 자체
      // 판단(PR-13 정렬 유지). 자동매매는 그대로 server/clients/kisClient.ts 사용.
      // Naver 는 DART 가 제공하지 않는 시장가 기반 PER/PBR/시총 만 보강 (2순위).
      const snap = await fetchAiUniverseSnapshot(baseCode);
      kisSupply = buildSnapshotSupplyStub(snap);
      krxValuation = await fetchKrxValuation(baseCode);
    }

    // Fix 2 — AI 응답 토큰 절단으로 targetPrice/stopLoss/entryPrice 가 0 으로 남는
    // 경우를 실시간 현재가 기반 기본값으로 보정. 이미 유효값이 있으면 그대로 사용.
    const resolvedPrice = currentPrice || stock.currentPrice || 0;
    const fallbackFields = applyTradingFieldFallbacks(
      { targetPrice: stock.targetPrice, targetPrice2: stock.targetPrice2,
        entryPrice: stock.entryPrice, stopLoss: stock.stopLoss },
      resolvedPrice,
    );

    const enriched: StockRecommendation = {
      ...stock,
      currentPrice: currentPrice || stock.currentPrice,
      targetPrice:  fallbackFields.targetPrice  ?? stock.targetPrice,
      targetPrice2: fallbackFields.targetPrice2 ?? stock.targetPrice2,
      entryPrice:   fallbackFields.entryPrice   ?? stock.entryPrice,
      stopLoss:     fallbackFields.stopLoss     ?? stock.stopLoss,
      dataSourceType: 'REALTIME',
      priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (Real-time)`,
      supplyData: kisSupply || stock.supplyData,
      shortSelling: kisShort || stock.shortSelling,
      technicalSignals: {
        ...stock.technicalSignals,
        rsi: Math.round(rsi * 10) / 10,
        macdStatus: macd.status,
        macdHistogram: Math.round(macd.histogram * 100) / 100,
        macdHistogramDetail: {
          status: macd.histogram > 0 ? 'BULLISH' : 'BEARISH',
          implication: macd.histogram > 0
            ? 'MACD 히스토그램 양수 전환으로 상승 모멘텀이 강화되고 있습니다.'
            : 'MACD 히스토그램 음수권으로 하락 압력이 존재합니다.'
        },
        bollingerStatus: bb?.status || 'NEUTRAL',
        bbWidth: bb ? Math.round(bb.width * 1000) / 1000 : 0,
        bbWidthDetail: {
          status: bb?.width && bb.width < 0.05 ? 'SQUEEZE' : (bb?.width && bb.width > 0.15 ? 'EXPANSION' : 'NEUTRAL'),
          implication: bb?.width && bb.width < 0.05
            ? '볼린저 밴드 스퀴즈 발생으로 조만간 큰 변동성이 예상됩니다.'
            : (bb?.width && bb.width > 0.15 ? '밴드 확장 중으로 현재 추세가 강하게 유지되고 있습니다.' : '정상적인 변동성 범위 내에 있습니다.')
        },
        stochasticStatus: stoch?.status || 'NEUTRAL',
        stochRsi: stoch ? Math.round(stoch.k * 10) / 10 : 0,
        stochRsiDetail: {
          status: stoch?.status || 'NEUTRAL',
          implication: stoch?.status === 'OVERSOLD'
            ? '스토캐스틱 과매도 구간으로 기술적 반등 가능성이 높습니다.'
            : (stoch?.status === 'OVERBOUGHT' ? '과매수 구간으로 단기 차익 실현 매물에 주의가 필요합니다.' : '중립적인 수급 상태입니다.')
        },
        disparity20: Math.round(disparity * 10) / 10,
        volumeSurge: vcp
      },
      ichimokuStatus: ichimoku.status,
      checklist: {
        ...stock.checklist,
        vcpPattern: vcp ? 1 : 0,
        roeType3: (dartFinancials?.roe ?? 0) >= 15 ? 1 : 0,
        ocfQuality: dartFinancials?.ocfGreaterThanNetIncome ? 1 : 0,
        interestCoverage: (dartFinancials?.interestCoverageRatio ?? 0) >= 3 ? 1 : 0,
        institutionalBuying: (kisSupply?.institutionNet ?? 0) > 0 ? 1 : 0,
        supplyInflow: (kisSupply?.foreignNet ?? 0) > 0 ? 1 : 0,
      },
      valuation: {
        ...stock.valuation,
        per: (krxValuation?.per && krxValuation.per > 0) ? krxValuation.per : stock.valuation.per,
        pbr: (krxValuation?.pbr && krxValuation.pbr > 0) ? krxValuation.pbr : stock.valuation.pbr,
        debtRatio: dartFinancials?.debtRatio || stock.valuation.debtRatio,
        epsGrowth: (typeof dartFinancials?.epsGrowth === 'number' && dartFinancials.epsGrowth !== 0)
          ? dartFinancials.epsGrowth
          : stock.valuation.epsGrowth,
      },
      marketCap: (krxValuation?.marketCap && krxValuation.marketCap > 0)
        ? krxValuation.marketCap
        : stock.marketCap,
      // PR-B (ADR-0019): main path — VCP 실계산 + DART/KIS supply 가용성 반영
      conditionSourceTiers: buildConditionSourceTiers({
        hasDartFinancials: dartFinancials != null,
        hasKisSupply: kisSupply != null,
        hasVcpComputed: true,
      }),
      financialUpdatedAt: dartFinancials?.updatedAt || stock.financialUpdatedAt
    };

    // 3-Gate Pyramid 세부 점수 계산 — checklist 기반이므로 enrichment 이후에 산출.
    enriched.gateEvaluation = computeGateEvaluation(enriched);

    // 섹터 대장주 시가총액 실데이터 주입 (AI 플레이스홀더 덮어쓰기)
    if (enriched.sectorAnalysis?.leadingStocks?.length) {
      try {
        enriched.sectorAnalysis = {
          ...enriched.sectorAnalysis,
          leadingStocks: await enrichLeadingStocksMarketCap(enriched.sectorAnalysis.leadingStocks),
        };
      } catch (e) {
        console.warn(`[enrichment] leadingStocks marketCap 보강 실패 (${stock.name}):`, e);
      }
    }

    if (dartFinancials) {
      enriched.roeAnalysis = {
        historicalTrend: stock.roeAnalysis?.historicalTrend || 'N/A',
        strategy: stock.roeAnalysis?.strategy || 'N/A',
        ...stock.roeAnalysis,
        drivers: [
          `실제 ROE: ${dartFinancials.roe.toFixed(2)}% (DART 실계산)`,
          `이자보상배율: ${dartFinancials.interestCoverageRatio.toFixed(2)}배`,
          `OCF > 순이익: ${dartFinancials.ocfGreaterThanNetIncome ? 'YES' : 'NO'}`,
          ...(stock.roeAnalysis?.drivers || [])
        ],
        metrics: {
          netProfitMargin: dartFinancials.netProfitMargin,
          assetTurnover: stock.roeAnalysis?.metrics?.assetTurnover || 0,
          equityMultiplier: stock.roeAnalysis?.metrics?.equityMultiplier || 0,
        }
      };
    }

    return enriched;
  } catch (error) {
    console.error(`Error enriching stock ${stock.name}:`, error);
    return await aiFallback();
  }
}
