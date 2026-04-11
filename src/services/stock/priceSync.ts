import { enrichStockWithRealData } from './enrichment';
import { fetchHistoricalData } from './historicalData';
import type { StockRecommendation } from './types';

export async function fetchCurrentPrice(code: string): Promise<number | null> {
  try {
    const data = await fetchHistoricalData(code, '1d');
    if (data && data.meta?.regularMarketPrice) {
      return data.meta.regularMarketPrice;
    }
    if (data && data.indicators?.quote?.[0]?.close) {
      const quotes = data.indicators.quote[0].close;
      return quotes[quotes.length - 1];
    }
    return null;
  } catch (error) {
    console.error(`Error fetching current price for ${code}:`, error);
    return null;
  }
}

// KIS 실시간 현재가 조회 — dataSourceType: 'REALTIME'
export async function syncStockPriceKIS(stock: StockRecommendation): Promise<StockRecommendation> {
  try {
    const res = await fetch('/api/kis/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/uapi/domestic-stock/v1/quotations/inquire-price',
        method: 'GET',
        headers: { 'tr_id': 'FHKST01010100', 'custtype': 'P' },
        params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: stock.code },
      }),
    });
    const data = await res.json();
    const currentPrice = parseInt(data.output?.stck_prpr || '0', 10);
    if (!currentPrice) throw new Error(`KIS 가격 조회 실패: ${JSON.stringify(data)}`);
    return {
      ...stock,
      currentPrice,
      dataSourceType: 'REALTIME',
      priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (KIS 실시간)`,
    };
  } catch (err) {
    console.error(`[ERROR] syncStockPriceKIS 실패 (${stock.code}):`, err);
    return {
      ...stock,
      dataSourceType: 'STALE',
      priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (KIS 조회 실패)`,
    };
  }
}

/**
 * syncStockPrice — 가격 신뢰도 계층 (AI 추정 완전 배제)
 * 1순위: KIS 실시간  → dataSourceType: 'REALTIME'
 * 2순위: Yahoo Finance 서버 프록시 → dataSourceType: 'YAHOO'
 * 3순위: 마지막 알려진 가격 유지   → dataSourceType: 'STALE'
 */
export async function syncStockPrice(stock: StockRecommendation): Promise<StockRecommendation> {
  // 1순위: KIS 실시간
  try {
    const kisResult = await syncStockPriceKIS(stock);
    console.log(`[가격동기화] KIS 실시간 성공: ${stock.name} ${kisResult.currentPrice}원`);
    return await enrichStockWithRealData(kisResult);
  } catch (kisErr: any) {
    console.warn(`[가격동기화] KIS 실패 → Yahoo 시도: ${kisErr.message}`);
  }

  // 2순위: Yahoo Finance (/api/historical-data 서버 프록시)
  const baseCode = stock.code.replace(/\.(KS|KQ)$/, '');
  const suffixes = ['.KS', '.KQ'];
  for (const suffix of suffixes) {
    try {
      const symbol = `${baseCode}${suffix}`;
      const res = await fetch(`/api/historical-data?symbol=${symbol}&range=1d&interval=1m`);
      if (res.ok) {
        const data = await res.json();
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice as number | undefined;
        if (price && price > 0) {
          console.log(`[가격동기화] Yahoo Finance 성공 (${symbol}): ${stock.name} ${price}원`);
          const updated: StockRecommendation = {
            ...stock,
            currentPrice: Math.round(price),
            dataSourceType: 'YAHOO',
            priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (Yahoo Finance)`,
          };
          return await enrichStockWithRealData(updated);
        }
      }
    } catch (yahooErr: any) {
      console.warn(`[가격동기화] Yahoo ${baseCode}${suffix} 실패: ${yahooErr.message}`);
    }
  }

  // 3순위: 마지막 알려진 가격 유지
  console.warn(`[가격동기화] 모든 소스 실패 — STALE 유지: ${stock.name}`);
  return {
    ...stock,
    dataSourceType: 'STALE',
    priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (가격 업데이트 실패)`,
  };
}
