// @responsibility DeepAnalysisModal QUANT 뷰 onShadowTrade 모의 시그널 빌더 (cc 분해)
import type { StockRecommendation } from '../../../services/stockService';

/**
 * QUANT 뷰에서 사용자가 'Shadow Trade 추가' 클릭 시 buildShadowTrade 에 전달할
 * 가벼운 모의 EvaluationResult 객체. 자동매매 본 경로(perSymbolEvaluation +
 * autoTradeEngine) 와 별개로 *대시보드 시뮬레이션 전용* — UI 검증·시각화용.
 *
 * STRONG_BUY 카드는 풀 포지션 20%, 그 외는 절반 10% 로 단순 분기.
 */
export function buildMockShadowSignal(stock: StockRecommendation): unknown {
  return {
    positionSize: stock.confidenceScore && stock.confidenceScore >= 80 ? 20 : 10,
    rrr: 2,
    lastTrigger: stock.type === 'STRONG_BUY',
    recommendation: stock.type === 'STRONG_BUY' ? '풀 포지션' : '절반 포지션',
    profile: { stopLoss: -8 },
  };
}
