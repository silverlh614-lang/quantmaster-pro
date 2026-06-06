// @responsibility AI 비의존 후보발굴 — discoverAiUniverse(실데이터 5-tier) + enrich + 정량순위. Gemini 0호출.
/**
 * realDataRecommendations.ts — 후보 판정의 AI-OFF 경로 (AI 의존도 축소, 사용자 결정 2026-06-06).
 *
 * 종목 universe 는 이미 실데이터다(discoverAiUniverse: Google→snapshot→quant(Naver/Yahoo)→Naver→seed).
 * 기존 엔진은 그 위에 Gemini 로 "선정+사유 작성"을 했고, 그게 크레딧 소진(429) 시 전체를 깨뜨렸다.
 * 본 모듈은 그 AI 단계를 **정량순위 + enrich(실데이터)** 로 대체해 Gemini 없이 후보 카드를 만든다.
 * AI 서술(reason/conviction/news)은 중립 — filters.useAI=true 일 때만 기존 엔진 호출.
 */
import { discoverAiUniverse, type AiUniverseMode } from '../../api/aiUniverseClient';
import { enrichStockWithRealData } from './enrichment';
import { flattenCandidates, buildUniverseWarning, type MomentumCandidate } from './momentumRecommendations';
import { buildBaseRecommendation } from './recommendationStub';
import { debugLog } from '../../utils/debug';
import type { StockFilters, RecommendationResponse, StockRecommendation, MarketContext } from './types';

const MAX_CANDIDATES = 12;

/** AI 시장분석 비활성 시의 중립 MarketContext (상단 배너는 별도 소스라 무영향). */
function neutralMarketContext(): MarketContext {
  const neutral = { index: 0, change: 0, changePercent: 0, status: 'NEUTRAL' as const, analysis: '실데이터 모드 — AI 시장 분석 비활성' };
  return {
    kospi: { ...neutral },
    kosdaq: { ...neutral },
    overallSentiment: 'NEUTRAL',
    dataSource: 'REALDATA_NO_AI',
  } as unknown as MarketContext;
}

export function mapToUniverseMode(mode?: string): AiUniverseMode {
  switch (mode) {
    case 'EARLY_DETECT': return 'EARLY_DETECT';
    case 'SMALL_MID_CAP': return 'SMALL_MID_CAP';
    case 'QUANT_SCREEN': return 'QUANT_SCREEN';
    case 'BEAR_SCREEN': return 'BEAR_SCREEN';
    default: return 'MOMENTUM';
  }
}

/** 정량 순위: BEAR 는 하락폭 큰 순, 그 외는 상승 모멘텀 순. 동률은 server 발굴 순서. maxPer 필터 적용. */
export function rankCandidates(list: MomentumCandidate[], mode: AiUniverseMode, filters?: StockFilters): MomentumCandidate[] {
  let out = list.slice();
  if (filters?.maxPer && filters.maxPer > 0) {
    out = out.filter((c) => !(c.per > 0) || c.per <= filters.maxPer!);
  }
  const dir = mode === 'BEAR_SCREEN' ? 1 : -1;
  out.sort((a, b) => {
    const byChange = (a.changePercent - b.changePercent) * dir;
    if (byChange !== 0) return byChange;
    return a.rank - b.rank;
  });
  return out;
}

export async function buildRealDataRecommendations(filters?: StockFilters): Promise<RecommendationResponse> {
  const mode = mapToUniverseMode(filters?.mode);
  let universe = null;
  try {
    universe = await discoverAiUniverse(mode, { maxCandidates: 24, enrich: true });
  } catch (e) {
    debugLog(`[realData] discover 실패: ${e}`);
  }

  const ranked = rankCandidates(flattenCandidates(universe), mode, filters).slice(0, MAX_CANDIDATES);

  const recommendations: StockRecommendation[] = [];
  for (const c of ranked) {
    const stub = buildBaseRecommendation(c.code, c.name, {
      per: c.per,
      pbr: c.pbr,
      changePercent: c.changePercent,
      reason: `실데이터 정량 후보 (출처 ${c.source}) — 실시간 데이터로 보강(AI 판정 보류).`,
      dataSource: 'REALDATA_UNIVERSE',
    });
    try {
      recommendations.push(await enrichStockWithRealData(stub));
    } catch (e) {
      debugLog(`[realData] enrich 실패 ${c.code}: ${e}`);
      recommendations.push(stub);
    }
  }

  const diag = universe?.diagnostics;
  const sourceStatus = diag?.sourceStatus;
  const warning = buildUniverseWarning(sourceStatus, diag?.budgetExceeded ?? false, diag?.tradingDateRef ?? null, diag?.snapshotAgeDays ?? null);
  const warnings: string[] = [];
  if (warning) warnings.push(warning);
  if (recommendations.length === 0) warnings.push('실데이터 후보를 찾지 못했습니다 — universe 가 비어있습니다(소스 점검 필요).');

  return {
    marketContext: neutralMarketContext(),
    recommendations,
    warnings,
    sourceStatus,
  };
}
