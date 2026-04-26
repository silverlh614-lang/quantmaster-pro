// @responsibility stock recommendations 서비스 모듈
/**
 * recommendations.ts — AI 추천 오케스트레이터
 *
 * mode에 따라 적절한 서브모듈로 라우팅합니다:
 *   momentumRecommendations.ts    — MOMENTUM / EARLY_DETECT 모드
 *   bearScreenerRecommendations.ts — BEAR_SCREEN 모드 (Bear Regime 하락 수혜주)
 *   quantScreenRecommendations.ts  — QUANT_SCREEN 모드 (정량 스크리닝 파이프라인)
 */

import { getMomentumRecommendations } from './momentumRecommendations';
import { getBearScreenerRecommendations } from './bearScreenerRecommendations';
import { runQuantScreenPipeline } from './quantScreenRecommendations';
import type { StockFilters, RecommendationResponse } from './types';

export async function getStockRecommendations(filters?: StockFilters): Promise<RecommendationResponse | null> {
  const mode = filters?.mode || 'MOMENTUM';

  if (mode === 'QUANT_SCREEN') {
    return runQuantScreenPipeline(filters);
  }

  if (mode === 'BEAR_SCREEN') {
    return getBearScreenerRecommendations(filters);
  }

  return getMomentumRecommendations(filters);
}
