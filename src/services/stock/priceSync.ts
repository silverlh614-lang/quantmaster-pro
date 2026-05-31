// @responsibility stock priceSync 서비스 모듈
import { enrichStockWithRealData } from './enrichment';
import { fetchHistoricalData } from './historicalData';
import { fetchAiUniverseSnapshot } from '../../api/aiUniverseClient';
import { debugLog } from '../../utils/debug';
import { clientWarn } from '../../utils/clientWarn';
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
    // KIS inquire-price 는 52주 최고가(w52_hgpr)를 동봉 — Peak Distance 실데이터로 사용.
    const peak52w = parseInt(data.output?.w52_hgpr || '0', 10);
    const priceLevels = recalculatePriceLevels(stock, currentPrice);
    return {
      ...stock,
      ...priceLevels,
      currentPrice,
      ...(peak52w > currentPrice ? { peakPrice: peak52w } : {}),
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
 * syncStockPrice — 가격 신뢰도 계층 (Yahoo 신뢰 철회 · AI 추정 완전 배제)
 * 1순위: KIS 실시간          → dataSourceType: 'REALTIME' (L1)
 * 2순위: Naver 모바일 snapshot → dataSourceType: 'NAVER'    (L3, KRX 직접 시세)
 * 3순위: 마지막 알려진 가격 유지 → dataSourceType: 'STALE'
 */
export async function syncStockPrice(stock: StockRecommendation): Promise<StockRecommendation> {
  // 1순위: KIS 실시간
  try {
    const kisResult = await syncStockPriceKIS(stock);
    debugLog(`[가격동기화] KIS 실시간 성공: ${stock.name} ${kisResult.currentPrice}원`);
    return await enrichStockWithRealData(kisResult);
  } catch (kisErr: any) {
    clientWarn({
      domain: 'PRICE_SYNC',
      code: 'P4_PRICE_SYNC_DEGRADED',
      message: `[가격동기화] KIS UI 가격 동기화 실패 → Naver 모바일 snapshot 시도`,
      dedupKey: `priceSync:kis:${stock.code}`,
      details: { stockCode: stock.code, stockName: stock.name, error: kisErr instanceof Error ? kisErr.message : String(kisErr) },
    });
  }

  // 2순위: Naver 모바일 snapshot (Yahoo 신뢰 철회 — split/통화/티커 매핑 오차로
  // ~10배 왜곡 사례 반복. Naver 는 KRX 시세를 직접 fetch).
  const baseCode = stock.code.split('.')[0];
  try {
    const snap = await fetchAiUniverseSnapshot(baseCode);
    if (snap?.closePrice && snap.closePrice > 0) {
      const roundedPrice = Math.round(snap.closePrice);
      debugLog(`[가격동기화] Naver 모바일 성공 (${baseCode}): ${stock.name} ${roundedPrice}원`);
      const priceLevels = recalculatePriceLevels(stock, roundedPrice);
      const updated: StockRecommendation = {
        ...stock,
        ...priceLevels,
        currentPrice: roundedPrice,
        dataSourceType: 'NAVER',
        priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (Naver 모바일)`,
      };
      return await enrichStockWithRealData(updated);
    }
  } catch (naverErr: any) {
    clientWarn({
      domain: 'PRICE_SYNC',
      code: 'P4_PRICE_SYNC_DEGRADED',
      message: `[가격동기화] Naver 모바일 snapshot 실패`,
      dedupKey: `priceSync:naver:${baseCode}`,
      details: { stockCode: stock.code, stockName: stock.name, error: naverErr instanceof Error ? naverErr.message : String(naverErr) },
    });
  }

  // 3순위: 마지막 알려진 가격 유지
  clientWarn({
    domain: 'PRICE_SYNC',
    code: 'P4_PRICE_SYNC_DEGRADED',
    message: `[가격동기화] 모든 UI 가격 소스(KIS·Naver) 실패 — 화면에 STALE 가격 유지`,
    dedupKey: `priceSync:stale:${stock.code}`,
    details: { stockCode: stock.code, stockName: stock.name, dataSourceType: 'STALE' },
  });
  const stale: StockRecommendation = {
    ...stock,
    dataSourceType: 'STALE',
    priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (가격 업데이트 실패)`,
  };
  const finalPrice = stale.currentPrice;
  return anchorPrice(stale, finalPrice);
}
