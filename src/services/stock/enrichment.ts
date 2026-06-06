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
import { fetchNaverDailyChart, fetchNaverSupply } from './naverDailyChart';
import { fetchKisLivePrice } from '../../api/kisLiveClient';
import { fetchAiUniverseSnapshot, type AiUniverseValuation } from '../../api/aiUniverseClient';
import { fetchForeignerRatioTrend } from '../../api/foreignerRatioClient';
import { fetchKrxInvestorTrend } from '../../api/krxInvestorClient';
import { fetchYahooConsensus } from '../../api/yahooConsensusClient';
import { isChecklistConditionMet } from '../../constants/gateConfig';
import {
  synthesizeRiskOnEnvironment,
  synthesizeCycleVerified,
  synthesizePolicyAlignment,
  type GlobalIntelSynthesisCtx,
} from '../quant/globalIntelSynthesis';
import { useGlobalIntelStore } from '../../stores/useGlobalIntelStore';
import type { StockRecommendation } from './types';
import type { TranchePlan } from '../../types/quant';
import { getQuantGateScore } from '../../utils/recommendationScore';
import { clientWarn } from '../../utils/clientWarn';

interface KrxValuation {
  per: number;
  pbr: number;
  eps: number;
  bps: number;
  marketCap: number;         // 억원
  marketCapDisplay: string;  // "12.3조" / "3,450억"
  /** ADR-0536 C18 — 서버 /snapshot 응답이 동봉한 PER 출처 표기 (구버전 서버는 undefined). */
  perSource?: 'NAVER_SNAPSHOT' | 'YAHOO_QUOTE_SUMMARY' | 'YAHOO_CHART_META' | 'UNAVAILABLE';
}

// 세션 스코프 in-memory 캐시 — 한 번의 분석 사이클에서 동일 종목 코드 중복 호출을 줄인다.
const _valuationCache = new Map<string, KrxValuation | null>();

// ─── PR-B (ADR-0029): 27 조건 sourceTier 메타 빌드 ─────────────────────────

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
  /** ADR-0152: Naver 외인 추세 (5d 표본 ≥ 6) 가 실제 데이터 반환했는가. */
  hasForeignerTrend?: boolean;
  /** ADR-0153: globalIntel 12 레이어 합성 ctx 가용 (4 필드 중 1+ 비-null). */
  hasGlobalIntelSynth?: boolean;
  /** ADR-0155: KRX 기관 5영업일 순매수 (sampleSize ≥ 3) 가 실제 데이터 반환했는가. */
  hasKrxInvestor?: boolean;
  /** ADR-0156: Yahoo 컨센서스 (source='yahoo') 가 실제 데이터 반환했는가. */
  hasYahooConsensus?: boolean;
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

  // API — DART 응답 사용 (ADR-0150 Phase 1 마무리: 3 → 5 키 격상)
  if (ctx.hasDartFinancials) {
    meta.roeType3 = 'API';
    meta.ocfQuality = 'API';
    meta.interestCoverage = 'API';
    meta.performanceReality = 'API';     // ADR-0150: epsGrowth > 0
    meta.economicMoatVerified = 'API';   // ADR-0150: debtRatio + netProfitMargin 합성
  }

  // ADR-0152: Naver 외인 추세 (5d 변화율) — #4 supplyInflow 격상
  if (ctx.hasForeignerTrend) {
    meta.supplyInflow = 'API';
  }

  // ADR-0155: KRX 기관 5영업일 순매수 — #12 institutionalBuying 격상
  if (ctx.hasKrxInvestor) {
    meta.institutionalBuying = 'API';
  }

  // ADR-0156: Yahoo 컨센서스 — #13 consensusTarget + #14 earningsSurprise 격상 (Phase 4)
  if (ctx.hasYahooConsensus) {
    meta.consensusTarget = 'API';
    meta.earningsSurprise = 'API';
  }

  // ADR-0153: globalIntel 12 레이어 합성 — #5/#1/#16 격상 (3 키)
  // 입력 자체가 외부 데이터 (KRX/ECOS/FRED 매크로) 이므로 'API' 정합 (ADR-0114).
  if (ctx.hasGlobalIntelSynth) {
    meta.riskOnEnvironment = 'API';
    meta.cycleVerified = 'API';
    meta.policyAlignment = 'API';
  }

  // ADR-0151: hasKisSupply 라벨 deprecated — ADR-0011 PR-25-C 가 KIS 수급 호출 제거
  // 후 `buildSnapshotSupplyStub` 가 foreignNet/institutionNet=0 박제. Naver snapshot
  // 의 정적 `foreignerOwnRatio` 는 *외인 보유율* (정적 % 값) 이라 #4 supplyInflow
  // (수급 *흐름*) / #12 institutionalBuying (기관/외인 *순매수*) 의미와 mismatch.
  // 따라서 ctx.hasKisSupply=true 여도 'API' 라벨 부여 안 함 (의미 정합 유지).
  // 진정한 KIS supply 격상은 ADR-0011 정책 변경 후 별도 ADR + 신규 ctx 필드.
  // 호출자 ctx.hasKisSupply 는 후방호환 (옵셔널, 무시) — 본 PR 에서 호출자 무수정.

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
    const data = await fetchAiUniverseSnapshot(baseCode);
    if (!data) { _valuationCache.set(baseCode, null); return null; }
    const result: KrxValuation = {
      per: Number(data.per) || 0,
      pbr: Number(data.pbr) || 0,
      eps: Number(data.eps) || 0,
      bps: Number(data.bps) || 0,
      marketCap: Number(data.marketCap) || 0,
      marketCapDisplay: typeof data.marketCapDisplay === 'string' ? data.marketCapDisplay : '',
      perSource: (data as { perSource?: KrxValuation['perSource'] }).perSource,
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
  // 27 항목 checklist 를 0~10 스케일로 정규화(normalizeChecklistScore)한 뒤
  // CONDITION_PASS_THRESHOLD(=5) 이상만 카운트한다. checklist 는 boolean(AI)·0/1
  // (enrichment) 으로 채워지므로 정규화 없이 비교하면 true(non-number)·1(<5) 이 모두
  // 0점 처리되어 전 항목 미충족 → 항상 "FAILED AT GATE 1" 로 박제됐다 (ADR — scale 정합).
  // candidate decision 의 conditionPasses 와 동일한 isChecklistConditionMet 단일 통로 사용.
  const v = (k: keyof typeof cl) => (isChecklistConditionMet(cl[k]) ? 1 : 0);

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

export async function enrichStockWithRealData(stock: StockRecommendation, opts?: { kisLive?: boolean }): Promise<StockRecommendation> {
  // Fix 2 + 2026-04-24 추가 — enrich 실패 경로에서 currentPrice 가 0 으로 남는 문제 해소.
  // 사용자 체감: 후보 판정 카드는 보이지만 가격이 모두 "-" 로 표시되어 "표시 안 됨" 으로 인지.
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
    let snapPerSource: StockRecommendation['valuation']['perSource'] | undefined;

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
            // ADR-0536 C18 — 서버가 동봉한 perSource carry (옵셔널, 구버전 서버는 undefined).
            snapPerSource = snap.perSource;
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
        // ADR-0536 C18 — perSource carry.
        perSource: snapPerSource ?? stock.valuation.perSource,
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
        // ADR-0150: aiFallback 경로도 동일 격상 (Phase 1 마무리, main path 정합)
        performanceReality: (fallbackDart?.epsGrowth ?? 0) > 0 ? 1 : (stock.checklist?.performanceReality ?? 0),
        economicMoatVerified:
          (fallbackDart?.debtRatio ?? 100) < 50 &&
          (fallbackDart?.netProfitMargin ?? 0) > 5
            ? 1
            : (stock.checklist?.economicMoatVerified ?? 0),
        // ADR-0153: aiFallback 경로도 globalIntel 합성 (#5/#1/#16) — main path 정합.
        // Naver 외인 추세 (#4 supplyInflow) 는 외부 API 호출 회로 부담 차단으로
        // aiFallback 경로 미적용 (stock.checklist 보존). main path 만 격상.
        riskOnEnvironment:
          synthesizeRiskOnEnvironment(_globalIntelCtx) ??
          (stock.checklist?.riskOnEnvironment ?? 0),
        cycleVerified:
          synthesizeCycleVerified(_globalIntelCtx) ??
          (stock.checklist?.cycleVerified ?? 0),
        policyAlignment:
          synthesizePolicyAlignment(_globalIntelCtx) ??
          (stock.checklist?.policyAlignment ?? 0),
      },
      // PR-B (ADR-0029): aiFallback 경로 — DART 만 가용 (vcp/kisSupply 없음)
      // ADR-0153: aiFallback 도 globalIntel 합성 ctx 활용 (외부 호출 0 — store read).
      // ADR-0152 외인 추세는 main path 전용 (외부 endpoint 호출 회로 부담 격리).
      conditionSourceTiers: buildConditionSourceTiers({
        hasDartFinancials: fallbackDart != null,
        hasKisSupply: false,
        hasVcpComputed: false,
        hasForeignerTrend: false,
        hasGlobalIntelSynth:
          _globalIntelCtx.macroEnv != null ||
          _globalIntelCtx.bearRegimeResult != null ||
          _globalIntelCtx.marketRegimeResult != null ||
          _globalIntelCtx.sectorEnergyResult != null,
      }),
      financialUpdatedAt: fallbackDart?.updatedAt || stock.financialUpdatedAt,
    };
    // Enrichment 전체가 실패해도 3-Gate Pyramid 는 checklist 기반 계산이므로 채워둔다.
    merged.gateEvaluation = computeGateEvaluation(merged);
    merged.quantGateScore = getQuantGateScore(merged) ?? undefined;
    return merged;
  };

  // ADR-0153: globalIntel 12 레이어 합성 ctx — store.getState() 한 번 가져옴.
  // synthesize* 헬퍼는 순수 함수 (ctx 입력만 사용), 옵셔널 필드 부재 시 null fallback.
  const _intelStore = useGlobalIntelStore.getState();
  const _globalIntelCtx: GlobalIntelSynthesisCtx = {
    macroEnv: _intelStore.macroEnv,
    bearRegimeResult: _intelStore.bearRegimeResult,
    marketRegimeResult: _intelStore.marketRegimeClassifierResult,
    sectorEnergyResult: _intelStore.sectorEnergyResult,
  };

  try {
    // KR 종목 OHLCV 는 Naver 일봉 우선 — Yahoo(/historical-data)는 장외에 204 반환 → 기술지표가
    // 전부 비어 카드 상세가 공란이 된다(종목검색 master-first 카드 포함). Naver 일봉은 장외/주말에도
    // 가용([[naver-first-kr-data]]) + Yahoo 호환 shape({timestamp, indicators.quote[0]}) → 그대로 소비.
    // Naver 실패(비-KR/네트워크/204) 시에만 Yahoo(/historical-data) fallback.
    let data: any = null;
    let ohlcvSource: 'NAVER' | 'YAHOO' | null = null;
    const baseCodeForChart = stock.code.split('.')[0];
    if (/^\d{6}$/.test(baseCodeForChart)) {
      const naverChart = await fetchNaverDailyChart(baseCodeForChart, '1y');
      if (naverChart?.data?.timestamp?.length && naverChart.data.indicators?.quote?.[0]) {
        data = naverChart.data;
        ohlcvSource = 'NAVER';
      }
    }
    if (!data) {
      data = await fetchHistoricalData(stock.code, '1y');
      if (data) ohlcvSource = 'YAHOO';
    }
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
    // ADR-0152: ADR-0140 Naver 외인 보유율 추세 (5d 변화율) — #4 supplyInflow 격상 입력
    let foreignerTrend: { current: number | null; changePct5d: number | null; sampleSize: number } | null = null;
    // ADR-0155: KRX 기관 순매수 5영업일 누적 — #12 institutionalBuying 격상 입력
    let krxInvestorTrend: { institutionNet5d: number; sampleSize: number } | null = null;
    // ADR-0156: Yahoo 컨센서스 — Phase 4 #13/#14 격상 입력 (옵션 A 변형)
    let yahooConsensus: { recommendationStrength: number | null; earningsSurpriseAvg: number | null; source: 'yahoo' | 'unavailable' } | null = null;
    // Naver 모바일 snapshot — closePrice 우선 사용을 위해 블록 밖으로 hoist.
    let naverSnap: Awaited<ReturnType<typeof fetchAiUniverseSnapshot>> | null = null;
    const isKoreanStock = /^\d{6}$/.test(stock.code.split('.')[0]);
    if (isKoreanStock) {
      const baseCode = stock.code.split('.')[0];
      // PR-25-C (ADR-0011): KIS 수급·공매도 호출 제거 — Naver 모바일 snapshot 의 정적
      // `foreignerOwnRatio` 만 유지. 일별 순매수·공매도 잔고는 AI 프롬프트가 자체
      // 판단(PR-13 정렬 유지). 자동매매는 그대로 server/clients/kisClient.ts 사용.
      // Naver 는 DART 가 제공하지 않는 시장가 기반 PER/PBR/시총 만 보강 (2순위).
      naverSnap = await fetchAiUniverseSnapshot(baseCode);
      const snap = naverSnap;
      // ADR-0152: 외인 추세 fetch — 영속 부재 시 null fallback (호출자 stock.checklist 보존)
      try { foreignerTrend = await fetchForeignerRatioTrend(baseCode); }
      catch { /* SDS-ignore: 추세 fetch 실패 시 fallback */ }
      // ADR-0155: KRX 기관 순매수 5d fetch — 응답 부재 시 null fallback
      try {
        const r = await fetchKrxInvestorTrend(baseCode);
        if (r) krxInvestorTrend = { institutionNet5d: r.institutionNet5d, sampleSize: r.sampleSize };
      } catch { /* SDS-ignore: KRX fetch 실패 시 fallback */ }
      // ADR-0156: Yahoo 컨센서스 fetch — source='unavailable' 시 stock.checklist fallback
      try {
        const r = await fetchYahooConsensus(baseCode);
        if (r) yahooConsensus = { recommendationStrength: r.recommendationStrength, earningsSurpriseAvg: r.earningsSurpriseAvg, source: r.source };
      } catch { /* SDS-ignore: Yahoo 컨센서스 실패 시 fallback */ }
      // 수급: Naver 외인/기관 5일 순매수(장외 가용·실데이터) 우선, 실패 시 snapshot stub(외인보유율만).
      let naverSupplyDetail: Awaited<ReturnType<typeof fetchNaverSupply>> = null;
      try { naverSupplyDetail = await fetchNaverSupply(baseCode); } catch { /* SDS-ignore: Naver 수급 실패 시 stub */ }
      kisSupply = naverSupplyDetail ?? buildSnapshotSupplyStub(snap);
      krxValuation = await fetchKrxValuation(baseCode);
    }

    // ─── 가격 SSOT — Yahoo 신뢰 철회 + L4 LLM 환각 차단 (사용자 정책) ───────
    // Yahoo 1년 일봉 마지막 종가는 split/통화/티커 매핑 오차로 ~10배 왜곡
    // (SK하이닉스 ₩1.86M) 사례 발견되어 사용 안 함.
    // LLM(Gemini) currentPrice 도 환각 가능성(L4 AI_ESTIMATED, ₩1.86M 같은 값을
    // 그대로 응답에 넣음)으로 신뢰 X.
    // 정직성 우선순위:
    //   1. NAVER (모바일 snapshot.closePrice, L3 KRX 시세 직접 fetch)
    //   2. REALTIME (이전 KIS 동기화 결과 — stock.dataSourceType==='REALTIME' 일 때만 유지)
    //   3. 그 외 모두 → currentPrice=0, dataSourceType='STALE'
    //      (UI 가 "가격 미확보" placeholder 표시) — 가짜 값 표시 절대 금지.
    // Yahoo OHLCV(1년 일봉 closes/highs/lows/volumes)는 RSI/MACD/Bollinger/VCP
    // 모양(shape) 기반 기술적 지표 계산에 한해 계속 사용 (절대값 표시 X).
    // 가격: Naver 모바일 snapshot.closePrice 우선 → 실패 시 Naver 일봉 마지막 종가(ohlcvSource==='NAVER' 일 때만,
    // 정확 KRX 시세). Yahoo 일봉 종가는 split/통화 왜곡으로 가격엔 미사용(기술지표 shape 계산에만).
    // 가격: (kisLive 옵션 시) **KIS 공식 현재가 1순위**(장중 실시간·최신뢰; 장외/실패 시 stale→null→폴백) →
    //   Naver snapshot → Naver 일봉 종가 → 이전 KIS sync → 0. KIS 호출은 개별 종목(검색/카드)에서만(quota 소량).
    const kisLivePrice = opts?.kisLive ? ((await fetchKisLivePrice(stock.code))?.price ?? null) : null;
    const naverDailyClose = ohlcvSource === 'NAVER' && closes.length > 0 ? closes[closes.length - 1] : null;
    const naverPriceCandidate = (naverSnap?.closePrice && naverSnap.closePrice > 0)
      ? naverSnap.closePrice
      : (naverDailyClose && naverDailyClose > 0 ? naverDailyClose : null);
    const priceFromKis = kisLivePrice !== null && kisLivePrice > 0;
    const priceFromNaver = !priceFromKis && naverPriceCandidate !== null;
    const priceFromPreviousKis = !priceFromKis && !priceFromNaver
      && stock.dataSourceType === 'REALTIME'
      && typeof stock.currentPrice === 'number'
      && stock.currentPrice > 0;
    const resolvedCurrentPrice = priceFromKis
      ? (kisLivePrice as number)
      : priceFromNaver
        ? (naverPriceCandidate as number)
        : priceFromPreviousKis
          ? (stock.currentPrice as number)
          : 0; // LLM 환각/Yahoo/snapshot stale 모두 폐기 — UI 가 "가격 미확보" 표시
    const resolvedSourceType: NonNullable<StockRecommendation['dataSourceType']> = (priceFromKis || priceFromPreviousKis)
      ? 'REALTIME'
      : priceFromNaver
        ? 'NAVER'
        : 'STALE';
    // applyTradingFieldFallbacks 는 가격이 있을 때만 의미가 있다 (currentPrice=0 시 no-op).
    const resolvedPrice = resolvedCurrentPrice;
    const fallbackFields = applyTradingFieldFallbacks(
      { targetPrice: stock.targetPrice, targetPrice2: stock.targetPrice2,
        entryPrice: stock.entryPrice, stopLoss: stock.stopLoss },
      resolvedPrice,
    );

    const enriched: StockRecommendation = {
      ...stock,
      currentPrice: resolvedCurrentPrice, // 0 일 수 있음 — UI 가 "가격 미확보" 표시
      targetPrice:  fallbackFields.targetPrice  ?? stock.targetPrice,
      targetPrice2: fallbackFields.targetPrice2 ?? stock.targetPrice2,
      entryPrice:   fallbackFields.entryPrice   ?? stock.entryPrice,
      stopLoss:     fallbackFields.stopLoss     ?? stock.stopLoss,
      dataSourceType: resolvedSourceType,
      priceUpdatedAt: priceFromKis
        ? `${new Date().toLocaleTimeString('ko-KR')} (KIS 현재가)`
        : priceFromNaver
          ? `${new Date().toLocaleTimeString('ko-KR')} (Naver 모바일)`
          : priceFromPreviousKis
            ? stock.priceUpdatedAt ?? `${new Date().toLocaleTimeString('ko-KR')} (KIS 이전값)`
            : `${new Date().toLocaleTimeString('ko-KR')} (가격 미확보 — Naver fetch 실패)`,
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
        // ADR-0150: DART 펀더멘털 4개 → 5개 격상 (Phase 1 마무리)
        // performanceReality (#15) ← epsGrowth > 0 (전년 대비 당기순이익 성장 검증)
        performanceReality: (dartFinancials?.epsGrowth ?? 0) > 0 ? 1 : 0,
        // economicMoatVerified (#8) ← debtRatio < 50% AND netProfitMargin > 5%
        // (낮은 부채 + 높은 자산 대비 순이익률 = 경제적 해자 정량 검증)
        economicMoatVerified:
          (dartFinancials?.debtRatio ?? 100) < 50 &&
          (dartFinancials?.netProfitMargin ?? 0) > 5
            ? 1
            : (stock.checklist?.economicMoatVerified ?? 0),
        // ADR-0151: ADR-0011 PR-25-C 가 KIS 수급 호출 제거 후 buildSnapshotSupplyStub 가
        // foreignNet/institutionNet=0 박제 → 이전 코드의 kisSupply.foreignNet/institutionNet
        // 비교 분기가 *항상 0 으로 평가* 되어 AI 추정 stock.checklist 점수를 silent 0 덮어쓰던 결함.
        // ADR-0152: #4 supplyInflow 는 ADR-0140 Naver 외인 보유율 5d 변화율 추세로 격상.
        //   임계: changePct5d ≥ +1.0%p AND sampleSize ≥ 6 → 1 (구조적 매수 신호)
        //   추세 부재 또는 미달 → stock.checklist?.supplyInflow ?? 0 (AI 추정 보존)
        // ADR-0155: #12 institutionalBuying 은 KRX 기관 5영업일 누적 순매수로 격상 (옵션 C).
        //   임계: institutionNet5d > 0 AND sampleSize ≥ 3 → 1 (5일 누적 매수)
        //   부재/미달 → stock.checklist?.institutionalBuying ?? 0 (AI 추정 보존)
        institutionalBuying:
          krxInvestorTrend != null &&
          krxInvestorTrend.institutionNet5d > 0 &&
          krxInvestorTrend.sampleSize >= 3
            ? 1
            : (stock.checklist?.institutionalBuying ?? 0),
        // ADR-0156: #13 consensusTarget + #14 earningsSurprise 는 Yahoo 무료 quoteSummary 격상.
        //   #13: recommendationStrength ≥ 0.5 (strongBuy + buy 비율 ≥ 50%) → 1
        //   #14: earningsSurpriseAvg > 0 (최근 분기 평균 beat) → 1
        //   source='unavailable' / 부재 → stock.checklist 보존 (AI 추정)
        consensusTarget:
          yahooConsensus?.source === 'yahoo' &&
          yahooConsensus.recommendationStrength != null &&
          yahooConsensus.recommendationStrength >= 0.5
            ? 1
            : (stock.checklist?.consensusTarget ?? 0),
        earningsSurprise:
          yahooConsensus?.source === 'yahoo' &&
          yahooConsensus.earningsSurpriseAvg != null &&
          yahooConsensus.earningsSurpriseAvg > 0
            ? 1
            : (stock.checklist?.earningsSurprise ?? 0),
        supplyInflow:
          foreignerTrend?.changePct5d != null &&
          foreignerTrend.changePct5d >= 1.0 &&
          foreignerTrend.sampleSize >= 6
            ? 1
            : (stock.checklist?.supplyInflow ?? 0),
        // ADR-0153: globalIntel 12 레이어 합성 — riskOnEnvironment (#5) / cycleVerified (#1) /
        //   policyAlignment (#16) 3 키 격상. ctx 부재 시 null → stock.checklist 보존.
        riskOnEnvironment:
          synthesizeRiskOnEnvironment(_globalIntelCtx) ??
          (stock.checklist?.riskOnEnvironment ?? 0),
        cycleVerified:
          synthesizeCycleVerified(_globalIntelCtx) ??
          (stock.checklist?.cycleVerified ?? 0),
        policyAlignment:
          synthesizePolicyAlignment(_globalIntelCtx) ??
          (stock.checklist?.policyAlignment ?? 0),
      },
      valuation: {
        ...stock.valuation,
        per: (krxValuation?.per && krxValuation.per > 0) ? krxValuation.per : stock.valuation.per,
        pbr: (krxValuation?.pbr && krxValuation.pbr > 0) ? krxValuation.pbr : stock.valuation.pbr,
        // ADR-0536 C18 — 서버가 동봉한 PER 출처를 카드/진단에서 사용 가능하도록 carry.
        perSource: krxValuation?.perSource ?? stock.valuation.perSource,
        debtRatio: dartFinancials?.debtRatio || stock.valuation.debtRatio,
        epsGrowth: (typeof dartFinancials?.epsGrowth === 'number' && dartFinancials.epsGrowth !== 0)
          ? dartFinancials.epsGrowth
          : stock.valuation.epsGrowth,
      },
      marketCap: (krxValuation?.marketCap && krxValuation.marketCap > 0)
        ? krxValuation.marketCap
        : stock.marketCap,
      // PR-B (ADR-0029): main path — VCP 실계산 + DART/KIS supply 가용성 반영
      // ADR-0152: hasForeignerTrend — 5d 표본 ≥ 6 시 #4 supplyInflow 'API' 격상
      // ADR-0153: hasGlobalIntelSynth — store ctx 가용 시 #5/#1/#16 'API' 격상
      // ADR-0155: hasKrxInvestor — KRX 5d 표본 ≥ 3 시 #12 institutionalBuying 'API' 격상
      // ADR-0156: hasYahooConsensus — Yahoo source='yahoo' 시 #13/#14 'API' 격상 (Phase 4)
      conditionSourceTiers: buildConditionSourceTiers({
        hasDartFinancials: dartFinancials != null,
        hasKisSupply: kisSupply != null,
        hasVcpComputed: true,
        hasForeignerTrend: (foreignerTrend?.sampleSize ?? 0) >= 6,
        hasGlobalIntelSynth:
          _globalIntelCtx.macroEnv != null ||
          _globalIntelCtx.bearRegimeResult != null ||
          _globalIntelCtx.marketRegimeResult != null ||
          _globalIntelCtx.sectorEnergyResult != null,
        hasKrxInvestor: (krxInvestorTrend?.sampleSize ?? 0) >= 3,
        hasYahooConsensus: yahooConsensus?.source === 'yahoo',
      }),
      financialUpdatedAt: dartFinancials?.updatedAt || stock.financialUpdatedAt
    };

    // 3-Gate Pyramid 세부 점수 계산 — checklist 기반이므로 enrichment 이후에 산출.
    enriched.gateEvaluation = computeGateEvaluation(enriched);
    enriched.quantGateScore = getQuantGateScore(enriched) ?? undefined;

    // 섹터 대장주 시가총액 실데이터 주입 (AI 플레이스홀더 덮어쓰기)
    if (enriched.sectorAnalysis?.leadingStocks?.length) {
      try {
        enriched.sectorAnalysis = {
          ...enriched.sectorAnalysis,
          leadingStocks: await enrichLeadingStocksMarketCap(enriched.sectorAnalysis.leadingStocks),
        };
      } catch (e) {
        clientWarn({
          domain: 'CLIENT_DATA',
          code: 'P4_CLIENT_DATA_STALE',
          message: `[enrichment] leadingStocks marketCap 보강 실패 — UI 보조 데이터 degraded`,
          dedupKey: `enrichment:leadingStocksMarketCap:${stock.code ?? stock.name}`,
          details: { stockName: stock.name, stockCode: stock.code, error: e instanceof Error ? e.message : String(e) },
        });
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
