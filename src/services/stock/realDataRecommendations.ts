// @responsibility AI 비의존 후보발굴 — discoverAiUniverse(실데이터 5-tier) + enrich + 정량순위. Gemini 0호출.
/**
 * realDataRecommendations.ts — 후보 판정의 AI-OFF 경로 (AI 의존도 축소, 사용자 결정 2026-06-06).
 *
 * 종목 universe 는 이미 실데이터다(discoverAiUniverse: Google→snapshot→quant(Naver/Yahoo)→Naver→seed).
 * 기존 엔진은 그 위에 Gemini 로 "선정+사유 작성"을 했고, 그게 크레딧 소진(429) 시 전체를 깨뜨렸다.
 * 본 모듈은 그 AI 단계를 **정량순위 + enrich(실데이터)** 로 대체해 Gemini 없이 후보 카드를 만든다.
 * AI 서술(reason/conviction/news)은 중립 — filters.useAI=true 일 때만 기존 엔진 호출.
 */
import { discoverAiUniverse, type AiUniverseMode, type AiUniverseSourceStatus } from '../../api/aiUniverseClient';
import { enrichStockWithRealData } from './enrichment';
import { flattenCandidates, buildUniverseWarning, type MomentumCandidate } from './momentumRecommendations';
import { buildBaseRecommendation } from './recommendationStub';
import { debugLog } from '../../utils/debug';
import type { StockFilters, RecommendationResponse, StockRecommendation, MarketContext } from './types';

const MAX_CANDIDATES = 12;

/**
 * KIS 공식 4-TR 스크리너 캐시(`GET /api/auto-trade/screener` → getScreenerCache) 를 후보로 변환.
 * 서버 stockScreener 가 이미 캐시한 KIS 랭킹 결과를 **읽기만** 한다 → 신규 KIS 호출 0(quota-safe, ADR-0011 무침범).
 * 비어있음/실패 시 [] → 호출자가 discoverAiUniverse(Naver) 로 폴백. (사용자 지시: KIS 공식 API 우선 참고.)
 */
async function fetchKisScreenedCandidates(): Promise<MomentumCandidate[]> {
  try {
    const res = await fetch('/api/auto-trade/screener');
    if (!res.ok) return [];
    const stocks = await res.json();
    if (!Array.isArray(stocks)) return [];
    return stocks
      .filter((s) => s && typeof s.code === 'string' && /^\d{6}$/.test(s.code) && typeof s.name === 'string')
      .map((s, i) => ({
        code: s.code,
        name: s.name,
        market: '',
        changePercent: Number(s.changeRate) || 0,
        rank: i + 1,
        source: 'KIS_SCREENER',
        per: Number(s.per) || 0,
        pbr: 0,
        marketCapDisplay: '',
      }));
  } catch {
    return [];
  }
}

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

  // ── 후보 소스: KIS 공식 4-TR 스크리너 캐시 우선(quota-safe), 비면 discoverAiUniverse(Naver) 폴백 ──
  // 모멘텀 계열은 KIS 스크리너 캐시가 모드에 부합. QUANT/BEAR 은 모드별 universe 가 필요하므로 discover.
  let candidates: MomentumCandidate[] = [];
  let sourceStatus: AiUniverseSourceStatus | undefined;
  let warning: string | null = null;
  let usedKis = false;

  if (mode === 'MOMENTUM' || mode === 'EARLY_DETECT' || mode === 'SMALL_MID_CAP') {
    candidates = await fetchKisScreenedCandidates();
    usedKis = candidates.length > 0;
    if (usedKis) debugLog(`[realData] KIS 스크리너 캐시 ${candidates.length}건 사용 (quota-safe)`);
  }

  if (!usedKis) {
    let universe = null;
    try {
      universe = await discoverAiUniverse(mode, { maxCandidates: 24, enrich: true });
    } catch (e) {
      debugLog(`[realData] discover 실패: ${e}`);
    }
    candidates = flattenCandidates(universe);
    const diag = universe?.diagnostics;
    sourceStatus = diag?.sourceStatus;
    warning = buildUniverseWarning(sourceStatus, diag?.budgetExceeded ?? false, diag?.tradingDateRef ?? null, diag?.snapshotAgeDays ?? null);
  }

  const ranked = rankCandidates(candidates, mode, filters).slice(0, MAX_CANDIDATES);

  const recommendations: StockRecommendation[] = [];
  for (const c of ranked) {
    const stub = buildBaseRecommendation(c.code, c.name, {
      per: c.per,
      pbr: c.pbr,
      changePercent: c.changePercent,
      reason: `실데이터 정량 후보 (출처 ${c.source}) — 실시간 데이터로 보강(AI 판정 보류).`,
      dataSource: usedKis ? 'KIS_SCREENER' : 'REALDATA_UNIVERSE',
    });
    try {
      recommendations.push(await enrichStockWithRealData(stub));
    } catch (e) {
      debugLog(`[realData] enrich 실패 ${c.code}: ${e}`);
      recommendations.push(stub);
    }
  }

  const warnings: string[] = [];
  if (warning) warnings.push(warning);
  if (recommendations.length === 0) warnings.push('실데이터 후보를 찾지 못했습니다 — KIS 스크리너 캐시·universe 모두 비어있습니다(소스 점검 필요).');

  return {
    marketContext: neutralMarketContext(),
    recommendations,
    warnings,
    sourceStatus,
  };
}
