// @responsibility stock recommendations 서비스 모듈
/**
 * recommendations.ts — 후보 판정 오케스트레이터
 *
 * mode에 따라 적절한 서브모듈로 라우팅합니다:
 *   momentumRecommendations.ts    — MOMENTUM / EARLY_DETECT 모드
 *   bearScreenerRecommendations.ts — BEAR_SCREEN 모드 (Bear Regime 하락 수혜주)
 *   quantScreenRecommendations.ts  — QUANT_SCREEN 모드 (정량 스크리닝 파이프라인)
 */

import { getMomentumRecommendations } from './momentumRecommendations';
import { getBearScreenerRecommendations } from './bearScreenerRecommendations';
import { runQuantScreenPipeline } from './quantScreenRecommendations';
import { buildRealDataRecommendations } from './realDataRecommendations';
import type { StockFilters, RecommendationResponse } from './types';

export async function getStockRecommendations(filters?: StockFilters): Promise<RecommendationResponse | null> {
  const mode = filters?.mode || 'MOMENTUM';

  // AI 의존도 축소(사용자 결정 2026-06-06): **기본은 실데이터 정량 후보**(Gemini 0호출, 429 무관).
  // 모든 모드(MOMENTUM/EARLY_DETECT/QUANT_SCREEN/BEAR_SCREEN/SMALL_MID_CAP)에 적용.
  // filters.useAI === true 일 때만 기존 AI 엔진(선정+사유 작성)을 호출한다(명시적 요청·버튼).
  if (!filters?.useAI) {
    return buildRealDataRecommendations(filters);
  }

  if (mode === 'QUANT_SCREEN') {
    return runQuantScreenPipeline(filters);
  }

  if (mode === 'BEAR_SCREEN') {
    return getBearScreenerRecommendations(filters);
  }

  return getMomentumRecommendations(filters);
}
