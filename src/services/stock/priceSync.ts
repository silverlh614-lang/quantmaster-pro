// @responsibility stock priceSync 서비스 모듈
import { enrichStockWithRealData } from './enrichment';
import { fetchHistoricalData } from './historicalData';
import { debugLog } from '../../utils/debug';
import type { StockRecommendation } from './types';

/**
 * Recalculate targetPrice and stopLoss proportionally when currentPrice changes.
 * Preserves the original percentage gaps relative to the price the AI used.
 */
function recalculatePriceLevels(stock: StockRecommendation, newPrice: number): Partial<StockRecommendation> {
  const oldPrice = stock.currentPrice;
  if (!oldPrice || oldPrice <= 0 || !newPrice || newPrice <= 0 || oldPrice === newPrice) return {};

  const result: Partial<StockRecommendation> = {};

  if (stock.targetPrice && stock.targetPrice > 0) {
    const targetPct = (stock.targetPrice - oldPrice) / oldPrice;
    result.targetPrice = Math.round(newPrice * (1 + targetPct));
  }
  if (stock.targetPrice2 && stock.targetPrice2 > 0) {
    const target2Pct = (stock.targetPrice2 - oldPrice) / oldPrice;
    result.targetPrice2 = Math.round(newPrice * (1 + target2Pct));
  }
  if (stock.stopLoss && stock.stopLoss > 0) {
    const stopPct = (stock.stopLoss - oldPrice) / oldPrice;
    result.stopLoss = Math.round(newPrice * (1 + stopPct));
  }
  if (stock.entryPrice && stock.entryPrice > 0) {
    const entryPct = (stock.entryPrice - oldPrice) / oldPrice;
    result.entryPrice = Math.round(newPrice * (1 + entryPct));
  }
  if (stock.entryPrice2 && stock.entryPrice2 > 0) {
    const entry2Pct = (stock.entryPrice2 - oldPrice) / oldPrice;
    result.entryPrice2 = Math.round(newPrice * (1 + entry2Pct));
  }

  return result;
}

/**
 * anchorPrice — currentPrice 변화에 비례해 target/stop 을 일괄 보정.
 * 가격 기준 = 상승률 기준. ratio=1 이면 no-op (STALE 경로 안전).
 */
function anchorPrice(stock: StockRecommendation, price: number): StockRecommendation {
  if (!price || price <= 0) return stock;

  const old = stock.currentPrice;
  if (!old || old <= 0) {
    return { ...stock, currentPrice: price };
  }

  const ratio = price / old;

  return {
    ...stock,
    currentPrice: price,
    targetPrice: stock.targetPrice ? Math.round(stock.targetPrice * ratio) : stock.targetPrice,
    targetPrice2: stock.targetPrice2 ? Math.round(stock.targetPrice2 * ratio) : stock.targetPrice2,
    stopLoss: stock.stopLoss ? Math.round(stock.stopLoss * ratio) : stock.stopLoss,
  };
}

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
    const priceLevels = recalculatePriceLevels(stock, currentPrice);
    return {
      ...stock,
      ...priceLevels,
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
    debugLog(`[가격동기화] KIS 실시간 성공: ${stock.name} ${kisResult.currentPrice}원`);
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
          const roundedPrice = Math.round(price);
          debugLog(`[가격동기화] Yahoo Finance 성공 (${symbol}): ${stock.name} ${roundedPrice}원`);
          const priceLevels = recalculatePriceLevels(stock, roundedPrice);
          const updated: StockRecommendation = {
            ...stock,
            ...priceLevels,
            currentPrice: roundedPrice,
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
  const stale: StockRecommendation = {
    ...stock,
    dataSourceType: 'STALE',
    priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (가격 업데이트 실패)`,
  };
  const finalPrice = stale.currentPrice;
  return anchorPrice(stale, finalPrice);
}
