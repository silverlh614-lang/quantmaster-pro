// @responsibility ADR-0156 Yahoo 컨센서스 클라이언트 SDK — 절대 규칙 #3 동기 사본

/**
 * ADR-0156 YahooConsensus — recommendationTrend + earningsHistory 합성.
 *
 * 변경 시 의무 — `server/clients/yahooConsensusClient.ts:17` 와 동시 갱신.
 */
export interface YahooConsensus {
  recommendationStrength: number | null;   // 0.0 ~ 1.0 (strongBuy + buy 비율)
  earningsSurpriseAvg: number | null;       // % (양수=beat)
  sampleSize: number;
  source: 'yahoo' | 'unavailable';
}

const YAHOO_CONSENSUS_TIMEOUT_MS = 8000;

/**
 * 종목별 Yahoo 컨센서스 fetch.
 *
 * - source='unavailable' (한국 종목 부분 지원, 데이터 부재): 정상 응답 — 호출자 fallback
 * - timeout / 4xx / 5xx / 네트워크 실패: null 반환 (호출자 stock.checklist 보존)
 *
 * KIS quota 0 침범 (Yahoo 외부 API).
 */
export async function fetchYahooConsensus(code: string): Promise<YahooConsensus | null> {
  const baseCode = (code || '').split('.')[0];
  if (!/^\d{1,6}$/.test(baseCode)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), YAHOO_CONSENSUS_TIMEOUT_MS);
  try {
    const url = `/api/yahoo-consensus/snapshot?code=${encodeURIComponent(baseCode)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as YahooConsensus;
    if (typeof json !== 'object' || json === null) return null;
    return json;
  } catch {
    // SDS-ignore: 네트워크 실패 시 null fallback
    return null;
  } finally {
    clearTimeout(timer);
  }
}
