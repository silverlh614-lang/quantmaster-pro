// @responsibility ADR-0156 Yahoo 컨센서스 client — recommendationTrend + earningsTrend modules
import { guardedFetch } from '../utils/egressGuard.js';

const YAHOO_TIMEOUT_MS = 6000;
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';

/**
 * ADR-0156 Yahoo 컨센서스 응답 schema.
 *
 * - recommendationStrength: 0~1 (strongBuy + buy 비율)
 * - earningsSurpriseAvg: 최근 분기 평균 surprise % (양수=beat)
 * - sampleSize: trend 또는 history rows 카운트
 * - source: 'yahoo' | 'unavailable' (한국 종목 부분 지원)
 */
export interface YahooConsensus {
  recommendationStrength: number | null;   // 0.0 ~ 1.0
  earningsSurpriseAvg: number | null;       // % (양수=beat)
  sampleSize: number;
  source: 'yahoo' | 'unavailable';
}

interface YahooRecommendationTrendRow {
  period?: string;
  strongBuy?: number;
  buy?: number;
  hold?: number;
  sell?: number;
  strongSell?: number;
}

interface YahooEarningsHistoryRow {
  surprisePercent?: { raw?: number };
}

/**
 * Yahoo `quoteSummary` 의 `recommendationTrend` + `earningsHistory` 두 modules 호출.
 *
 * 한국 종목 (.KS / .KQ) 일부 지원 — 컨센서스 데이터 부재 시 source='unavailable'.
 * EgressGuard intent='HISTORICAL' (시간대 무관 누적 데이터).
 *
 * @param code 6자리 종목 코드 (또는 .KS / .KQ 접미사)
 * @returns YahooConsensus | null (네트워크 실패 / 잘못된 코드)
 */
export async function fetchYahooConsensus(code: string): Promise<YahooConsensus | null> {
  const baseCode = (code || '').split('.')[0];
  if (!/^\d{1,6}$/.test(baseCode)) return null;
  const padded = baseCode.padStart(6, '0');
  const suffixes = ['.KS', '.KQ'] as const;
  const modules = 'recommendationTrend,earningsHistory';

  for (const suf of suffixes) {
    const url = `${YAHOO_BASE}/${padded}${suf}?modules=${modules}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), YAHOO_TIMEOUT_MS);
    try {
      const res = await guardedFetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuantmasterPro/1.0)' },
        signal: ctrl.signal,
      }, 'HISTORICAL');
      if (!res.ok) {
        clearTimeout(timer);
        continue;
      }
      const json = (await res.json()) as {
        quoteSummary?: {
          result?: Array<{
            recommendationTrend?: { trend?: YahooRecommendationTrendRow[] };
            earningsHistory?: { history?: YahooEarningsHistoryRow[] };
          }>;
        };
      };
      const result = json.quoteSummary?.result?.[0];
      if (!result) {
        clearTimeout(timer);
        continue;
      }
      // recommendationTrend 합성
      const trends = result.recommendationTrend?.trend ?? [];
      let recommendationStrength: number | null = null;
      let trendSampleSize = 0;
      if (trends.length > 0) {
        // 0m (current month) 우선, 부재 시 첫 row
        const cur = trends.find((t) => t.period === '0m') ?? trends[0];
        if (cur) {
          const sb = cur.strongBuy ?? 0;
          const b = cur.buy ?? 0;
          const h = cur.hold ?? 0;
          const s = cur.sell ?? 0;
          const ss = cur.strongSell ?? 0;
          const total = sb + b + h + s + ss;
          if (total > 0) {
            recommendationStrength = (sb + b) / total;
            trendSampleSize = total;
          }
        }
      }
      // earningsHistory 합성 — 최근 4 분기 평균 surprise %
      const history = result.earningsHistory?.history ?? [];
      let earningsSurpriseAvg: number | null = null;
      let surpriseSampleSize = 0;
      if (history.length > 0) {
        const surprises = history
          .map((r) => r.surprisePercent?.raw)
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        if (surprises.length > 0) {
          earningsSurpriseAvg = surprises.reduce((a, b) => a + b, 0) / surprises.length;
          surpriseSampleSize = surprises.length;
        }
      }
      const sampleSize = Math.max(trendSampleSize, surpriseSampleSize);
      const dataPresent = recommendationStrength !== null || earningsSurpriseAvg !== null;
      clearTimeout(timer);
      return {
        recommendationStrength,
        earningsSurpriseAvg,
        sampleSize,
        source: dataPresent ? 'yahoo' : 'unavailable',
      };
    } catch {
      // SDS-ignore: timeout / 네트워크 실패 — 다음 suffix 시도
    } finally {
      clearTimeout(timer);
    }
  }
  // 모든 suffix 실패 — unavailable
  return {
    recommendationStrength: null,
    earningsSurpriseAvg: null,
    sampleSize: 0,
    source: 'unavailable',
  };
}
