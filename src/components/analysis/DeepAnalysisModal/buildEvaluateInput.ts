// @responsibility DeepAnalysisModal 의 evaluateStock 입력 객체 빌더 헬퍼 (cc 분해)
import { MASTER_CHECKLIST_STEPS } from '../../../constants/checklist';
import { CHECKLIST_KEY_TO_CONDITION_ID } from '../../../types/quant';
import type { ChecklistKey } from '../../../types/quant';
import type { StockRecommendation } from '../../../services/stockService';
import type { EvaluateStockInput } from '../../../services/quant/gateEngine';

export interface DeepAnalysisEvaluateContext {
  marketOverview: { dynamicWeights?: Record<string, number> } | null | undefined;
  macroEnv: EvaluateStockInput['macroEnv'] | null;
  exportRatio: number | undefined;
  smartMoneyData: unknown;
  exportMomentumData: unknown;
  geoRiskData: unknown;
  creditSpreadData: unknown;
  extendedRegimeData: { regime?: unknown; uncertaintyMetrics?: { kospi60dVolatility?: number; leadingSectorCount?: number; foreignFlowDirection?: string } } | null | undefined;
  economicRegimeData: { regime?: unknown } | null | undefined;
  supplyChainData: unknown;
  financialStressData: unknown;
  newsFrequencyScores: Array<{ code: string; phase?: unknown }>;
  globalCorrelation: { kospiSp500?: number } | null | undefined;
  weeklyRsiValues: number[];
}

const BULL_PHASES = ['BULL', 'RISK_ON'];
const BEAR_PHASES = ['BEAR', 'RISK_OFF'];

function deriveRegimeType(marketPhase: string | undefined): '상승초기' | '하락' | '횡보' | '변동성' {
  if (BULL_PHASES.includes(marketPhase || '')) return '상승초기';
  if (BEAR_PHASES.includes(marketPhase || '')) return '하락';
  if (marketPhase === 'SIDEWAYS') return '횡보';
  return '변동성';
}

export function deriveRrr(stock: StockRecommendation): number {
  if (stock.currentPrice > 0 && stock.stopLoss > 0 && stock.targetPrice > stock.currentPrice) {
    return (stock.targetPrice - stock.currentPrice) / (stock.currentPrice - stock.stopLoss);
  }
  return 2.1;
}

function buildRawStockData(stock: StockRecommendation): Record<number, number> {
  return Object.fromEntries(
    MASTER_CHECKLIST_STEPS.map((step) => [
      CHECKLIST_KEY_TO_CONDITION_ID[step.key as ChecklistKey],
      stock?.checklist?.[step.key as keyof typeof stock.checklist] ? 10 : 0,
    ])
  ) as Record<number, number>;
}

function buildRegime(stock: StockRecommendation, ctx: DeepAnalysisEvaluateContext): EvaluateStockInput['regime'] {
  return {
    type: deriveRegimeType(stock.aiConvictionScore?.marketPhase),
    weightMultipliers: ctx.marketOverview?.dynamicWeights || {},
    vKospi: stock.marketSentiment?.vkospi || 15,
    samsungIri: stock.marketSentiment?.iri || 3.5,
  };
}

function buildSectorRotation(stock: StockRecommendation): EvaluateStockInput['sectorRotation'] {
  return {
    name: stock.relatedSectors?.[0] || 'Unknown',
    rank: 1,
    strength: stock.confidenceScore || 0,
    isLeading: stock.isSectorTopPick || false,
    sectorLeaderNewHigh: stock.sectorLeaderNewHigh || false,
  };
}

function buildAdvancedContext(
  stock: StockRecommendation,
  ctx: DeepAnalysisEvaluateContext
): EvaluateStockInput['advancedContext'] {
  const newsPhase = ctx.newsFrequencyScores.find((n) => n.code === stock.code)?.phase;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    smartMoney: (ctx.smartMoneyData ?? undefined) as any,
    exportMomentum: (ctx.exportMomentumData ?? undefined) as any,
    geoRisk: (ctx.geoRiskData ?? undefined) as any,
    creditSpread: (ctx.creditSpreadData ?? undefined) as any,
    economicRegime: ((ctx.extendedRegimeData?.regime ?? ctx.economicRegimeData?.regime) as any),
    supplyChain: (ctx.supplyChainData ?? undefined) as any,
    financialStress: (ctx.financialStressData ?? undefined) as any,
    newsPhase: (newsPhase as any) ?? undefined,
    catalystDescription: stock.reason,
    weeklyRsiValues: ctx.weeklyRsiValues.length > 0 ? ctx.weeklyRsiValues : undefined,
    institutionalAmounts: stock.supplyData?.institutionalDailyAmounts ?? undefined,
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

function buildExtendedRegimeOptions(ctx: DeepAnalysisEvaluateContext): EvaluateStockInput['extendedRegimeOptions'] {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    kospi60dVolatility: ctx.extendedRegimeData?.uncertaintyMetrics?.kospi60dVolatility,
    leadingSectorCount: ctx.extendedRegimeData?.uncertaintyMetrics?.leadingSectorCount,
    foreignFlowDirection: (ctx.extendedRegimeData?.uncertaintyMetrics?.foreignFlowDirection as any),
    kospiSp500Correlation: ctx.globalCorrelation?.kospiSp500,
    financialStress: (ctx.financialStressData ?? undefined) as any,
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function buildDeepAnalysisEvaluateInput(
  stock: StockRecommendation,
  ctx: DeepAnalysisEvaluateContext
): EvaluateStockInput {
  return {
    rawStockData: buildRawStockData(stock),
    regime: buildRegime(stock, ctx),
    profileType: stock.marketCapCategory === 'LARGE' ? 'A' : 'B',
    sectorRotation: buildSectorRotation(stock),
    euphoriaSignals: 0,
    emergencyStop: false,
    rrr: deriveRrr(stock),
    sellSignals: (stock.sellSignals || []).map((_, i) => i),
    multiTimeframe: stock.multiTimeframe,
    enemyChecklist: stock.enemyChecklist,
    seasonality: stock.seasonality,
    attribution: stock.attribution,
    isPullbackVolumeLow: stock.isPullbackVolumeLow || false,
    macroEnv: ctx.macroEnv ?? undefined,
    stockExportRatio: ctx.exportRatio,
    advancedContext: buildAdvancedContext(stock, ctx),
    extendedRegimeOptions: buildExtendedRegimeOptions(ctx),
    stockSector: stock.relatedSectors?.[0],
  };
}
