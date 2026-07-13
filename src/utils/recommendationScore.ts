// @responsibility Recommendation score concordance helpers.
import { getRegimeGateScoreBand } from '../constants/gateConfig';
import type { StockRecommendation } from '../services/stock/types';

type ScoreConcordanceTier = 'EXCELLENT' | 'GOOD' | 'NEUTRAL' | 'WEAK' | 'POOR';

export interface QuantGateScoreView {
  value: number;
  normalized: number;
  regime: string;
  threshold: number;
  pass: boolean;
}

export interface ScoreConcordance {
  tier: ScoreConcordanceTier;
  label: string;
  aiScore: number;
  quantScore: number;
  gap: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalizeGateFinalScore(finalScore: number): number {
  if (!Number.isFinite(finalScore)) return 0;
  const value = finalScore > 27 ? finalScore / 27 : (finalScore / 27) * 10;
  return clamp(value, 0, 10);
}

function inferRegimeForGate(stock: Pick<StockRecommendation, 'aiConvictionScore'>): string {
  const phase = stock.aiConvictionScore?.marketPhase;
  if (phase === 'RISK_ON' || phase === 'BULL') return 'R3_EARLY';
  if (phase === 'RISK_OFF' || phase === 'BEAR') return 'R5_CAUTION';
  return 'R4_NEUTRAL';
}

export function getQuantGateScore(stock: StockRecommendation): QuantGateScoreView | null {
  const explicit = stock.quantGateScore;
  const regime = explicit?.regime ?? inferRegimeForGate(stock);
  const threshold = explicit?.threshold ?? getRegimeGateScoreBand(regime).normal;
  const rawValue = explicit?.value ?? (
    typeof stock.gateEvaluation?.finalScore === 'number'
      ? normalizeGateFinalScore(stock.gateEvaluation.finalScore)
      : null
  );
  if (rawValue === null || !Number.isFinite(rawValue)) return null;
  const value = clamp(rawValue, 0, 10);
  return {
    value,
    normalized: Math.round(value * 10),
    regime,
    threshold,
    pass: value >= threshold,
  };
}

export function classifyScoreConcordance(aiScore: number, quantScore: number): ScoreConcordance {
  const ai = clamp(Number.isFinite(aiScore) ? aiScore : 0, 0, 100);
  const quant = clamp(Number.isFinite(quantScore) ? quantScore : 0, 0, 100);
  const gap = Math.abs(ai - quant);
  const tier: ScoreConcordanceTier =
    gap <= 8 ? 'EXCELLENT' :
    gap <= 15 ? 'GOOD' :
    gap <= 25 ? 'NEUTRAL' :
    gap <= 35 ? 'WEAK' :
    'POOR';
  const label: Record<ScoreConcordanceTier, string> = {
    EXCELLENT: '합치도 매우 높음',
    GOOD: '합치도 양호',
    NEUTRAL: '합치도 보통',
    WEAK: '합치도 낮음',
    POOR: '합치도 매우 낮음',
  };
  return { tier, label: label[tier], aiScore: Math.round(ai), quantScore: Math.round(quant), gap: Math.round(gap) };
}
