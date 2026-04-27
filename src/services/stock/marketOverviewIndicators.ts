/**
 * @responsibility marketOverview 가격성 실데이터 prefill SSOT — Yahoo 직접 fetch
 *
 * getMarketOverview 가 Gemini AI 에게 S&P 500 / NASDAQ / Dow / Nikkei / CSI300 /
 * 환율 / 금 / WTI 같은 *가격* 을 추정하도록 위임하던 ADR-0064 이전 구조에서, AI 가
 * 호출마다 다른 hallucinated 값을 답해 화면이 출렁이던 문제를 차단한다.
 *
 * 본 모듈은 8개 가격성 심볼을 Yahoo 프록시로 직접 병렬 fetch 해서 MarketDataPoint
 * 배열로 변환한다. getMarketOverview 가 결과를 AI 프롬프트에 사전 주입하고 응답
 * normalize 시 overlay 로 강제 덮어써 AI hallucination 을 차단한다.
 *
 * 외부 호출 정책:
 * - fetchHistoricalData 가 /api/historical-data 프록시 경유 → 서버 LRU 캐시 + coalescing
 *   (ADR-0009/0010) + EgressGuard IntentTag (ADR-0058) 자동 적용.
 * - 개별 심볼 실패 (장외 OFFHOURS / 네트워크 타임아웃) 는 graceful — failedSymbols 에
 *   기록만 하고 다른 심볼은 계속 처리. 호출자(getMarketOverview)는 null 카테고리에
 *   대해 AI 응답 fallback 을 유지한다 (PR-γ disk snapshot 정착 후엔 fallback 회수도
 *   거의 0).
 */
import { fetchHistoricalData } from './historicalData';
import type { MarketDataPoint } from './types';

/** Yahoo 가격성 심볼 fetch 대상 SSOT. */
export interface IndicatorTarget {
  /** Yahoo Finance 심볼 (예: '^GSPC', 'GC=F', 'JPYKRW=X'). */
  symbol: string;
  /** UI 라벨 — MarketDataPoint.name 으로 그대로 사용. */
  name: string;
}

export const INDEX_TARGETS: ReadonlyArray<IndicatorTarget> = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'NASDAQ' },
  { symbol: '^DJI', name: 'Dow Jones' },
  { symbol: '^N225', name: 'Nikkei 225' },
  { symbol: '000300.SS', name: 'CSI 300' },
];

export const FX_TARGETS: ReadonlyArray<IndicatorTarget> = [
  { symbol: 'JPYKRW=X', name: 'JPY/KRW' },
  { symbol: 'EURKRW=X', name: 'EUR/KRW' },
];

export const COMMODITY_TARGETS: ReadonlyArray<IndicatorTarget> = [
  { symbol: 'GC=F', name: '금 (Gold)' },
  { symbol: 'CL=F', name: 'WTI 원유' },
];

export interface PrefilledMarketData {
  indices: MarketDataPoint[];
  exchangeRates: MarketDataPoint[];
  commodities: MarketDataPoint[];
  /** Fetch 실패한 심볼 — 장외 OFFHOURS 또는 네트워크 오류. UI/디버깅용. */
  failedSymbols: string[];
  /** 수집 시각 ISO. */
  fetchedAt: string;
}

/** Yahoo 응답 chart.result[0] 에서 MarketDataPoint 추출. 가격 없거나 비정상 시 null. */
export function extractDataPoint(target: IndicatorTarget, raw: unknown): MarketDataPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const meta = (raw as { meta?: Record<string, unknown> }).meta;
  if (!meta) return null;

  const price = meta.regularMarketPrice;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;

  const prevRaw = meta.regularMarketPreviousClose ?? meta.previousClose ?? null;
  const prev = typeof prevRaw === 'number' && Number.isFinite(prevRaw) && prevRaw > 0 ? prevRaw : null;

  let change = 0;
  let changePercent = 0;
  if (prev !== null) {
    change = parseFloat((price - prev).toFixed(2));
    changePercent = parseFloat(((price - prev) / prev * 100).toFixed(2));
  }

  return { name: target.name, value: price, change, changePercent };
}

/**
 * 8개 가격성 심볼 (지수 5 + FX 2 + 원자재 2) 병렬 fetch 후 카테고리별 MarketDataPoint
 * 배열 반환. 실패한 심볼은 failedSymbols 에 기록만 하고 다른 심볼은 계속 진행 — 단일
 * 심볼 OFFHOURS 가 전체 prefill 을 차단하지 않게 한다.
 */
export async function fetchPrefilledMarketData(): Promise<PrefilledMarketData> {
  const targets: ReadonlyArray<{ target: IndicatorTarget; category: 'index' | 'fx' | 'commodity' }> = [
    ...INDEX_TARGETS.map(t => ({ target: t, category: 'index' as const })),
    ...FX_TARGETS.map(t => ({ target: t, category: 'fx' as const })),
    ...COMMODITY_TARGETS.map(t => ({ target: t, category: 'commodity' as const })),
  ];

  const settled = await Promise.allSettled(
    targets.map(async ({ target }) => {
      const raw = await fetchHistoricalData(target.symbol, '1d', '1d');
      return extractDataPoint(target, raw);
    }),
  );

  const out: PrefilledMarketData = {
    indices: [],
    exchangeRates: [],
    commodities: [],
    failedSymbols: [],
    fetchedAt: new Date().toISOString(),
  };

  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i];
    const { target, category } = targets[i];
    const point = r.status === 'fulfilled' ? r.value : null;
    if (point) {
      if (category === 'index') out.indices.push(point);
      else if (category === 'fx') out.exchangeRates.push(point);
      else out.commodities.push(point);
    } else {
      out.failedSymbols.push(target.symbol);
    }
  }

  return out;
}

/**
 * AI 응답의 indices/exchangeRates/commodities 를 prefill 결과로 *덮어쓴다*.
 *
 * 정책 (ADR-0064 §3):
 * - prefill 카테고리에 ≥1 항목 있으면 → AI 응답 무시하고 prefill 그대로 사용 (hallucination 차단)
 * - prefill 카테고리 빈 배열이면 (모든 심볼 fetch 실패) → AI 응답 fallback 유지
 *
 * 이 정책은 PR-γ disk snapshot 영속화 정착 후엔 fallback 케이스가 거의 사라진다.
 */
export interface OverlayInput {
  indices: MarketDataPoint[] | undefined;
  exchangeRates: MarketDataPoint[] | undefined;
  commodities: MarketDataPoint[] | undefined;
}
export function applyPrefilledOverlay(
  aiResponse: OverlayInput,
  prefilled: PrefilledMarketData,
): { indices: MarketDataPoint[]; exchangeRates: MarketDataPoint[]; commodities: MarketDataPoint[] } {
  return {
    indices: prefilled.indices.length > 0 ? prefilled.indices : (aiResponse.indices ?? []),
    exchangeRates:
      prefilled.exchangeRates.length > 0 ? prefilled.exchangeRates : (aiResponse.exchangeRates ?? []),
    commodities:
      prefilled.commodities.length > 0 ? prefilled.commodities : (aiResponse.commodities ?? []),
  };
}
