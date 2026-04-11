import {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateStochastic,
  calculateIchimoku,
  detectVCP,
  calculateDisparity
} from "../../utils/indicators";
import { fetchCorpCode, fetchDartFinancials } from './dartDataFetcher';
import { fetchKisSupply, fetchKisShortSelling } from './kisDataFetcher';
import { fetchHistoricalData } from './historicalData';
import type { StockRecommendation } from './types';

export async function enrichStockWithRealData(stock: StockRecommendation): Promise<StockRecommendation> {
  try {
    const data = await fetchHistoricalData(stock.code, '1y');
    if (!data || !data.timestamp || !data.indicators?.quote?.[0]) {
      return { ...stock, dataSourceType: 'AI' };
    }

    const quotes = data.indicators.quote[0];
    const closes = (quotes.close as (number | null)[]).filter((v): v is number => v !== null);
    const highs = (quotes.high as (number | null)[]).filter((v): v is number => v !== null);
    const lows = (quotes.low as (number | null)[]).filter((v): v is number => v !== null);
    const volumes = (quotes.volume as (number | null)[]).filter((v): v is number => v !== null);

    if (closes.length < 26) return { ...stock, dataSourceType: 'AI' };

    const rsi = calculateRSI(closes);
    const macd = calculateMACD(closes);
    const bb = calculateBollingerBands(closes);
    const stoch = calculateStochastic(highs, lows, closes);
    const ichimoku = calculateIchimoku(highs, lows, closes);
    const vcp = detectVCP(closes, volumes);
    const disparity = calculateDisparity(closes);

    const currentPrice = closes[closes.length - 1];

    let dartFinancials = null;
    if (!stock.corpCode) {
      stock.corpCode = await fetchCorpCode(stock.code) || undefined;
    }
    if (stock.corpCode) {
      dartFinancials = await fetchDartFinancials(stock.corpCode);
    }

    let kisSupply = null;
    let kisShort = null;
    const isKoreanStock = /^\d{6}$/.test(stock.code.split('.')[0]);
    if (isKoreanStock) {
      const baseCode = stock.code.split('.')[0];
      kisSupply = await fetchKisSupply(baseCode);
      kisShort = await fetchKisShortSelling(baseCode);
    }

    const enriched: StockRecommendation = {
      ...stock,
      currentPrice: currentPrice || stock.currentPrice,
      dataSourceType: 'REALTIME',
      priceUpdatedAt: `${new Date().toLocaleTimeString('ko-KR')} (Real-time)`,
      supplyData: kisSupply || stock.supplyData,
      shortSelling: kisShort || stock.shortSelling,
      technicalSignals: {
        ...stock.technicalSignals,
        rsi: Math.round(rsi * 10) / 10,
        macdStatus: macd.status,
        macdHistogram: Math.round(macd.histogram * 100) / 100,
        macdHistogramDetail: {
          status: macd.histogram > 0 ? 'BULLISH' : 'BEARISH',
          implication: macd.histogram > 0
            ? 'MACD 히스토그램 양수 전환으로 상승 모멘텀이 강화되고 있습니다.'
            : 'MACD 히스토그램 음수권으로 하락 압력이 존재합니다.'
        },
        bollingerStatus: bb?.status || 'NEUTRAL',
        bbWidth: bb ? Math.round(bb.width * 1000) / 1000 : 0,
        bbWidthDetail: {
          status: bb?.width && bb.width < 0.05 ? 'SQUEEZE' : (bb?.width && bb.width > 0.15 ? 'EXPANSION' : 'NEUTRAL'),
          implication: bb?.width && bb.width < 0.05
            ? '볼린저 밴드 스퀴즈 발생으로 조만간 큰 변동성이 예상됩니다.'
            : (bb?.width && bb.width > 0.15 ? '밴드 확장 중으로 현재 추세가 강하게 유지되고 있습니다.' : '정상적인 변동성 범위 내에 있습니다.')
        },
        stochasticStatus: stoch?.status || 'NEUTRAL',
        stochRsi: stoch ? Math.round(stoch.k * 10) / 10 : 0,
        stochRsiDetail: {
          status: stoch?.status || 'NEUTRAL',
          implication: stoch?.status === 'OVERSOLD'
            ? '스토캐스틱 과매도 구간으로 기술적 반등 가능성이 높습니다.'
            : (stoch?.status === 'OVERBOUGHT' ? '과매수 구간으로 단기 차익 실현 매물에 주의가 필요합니다.' : '중립적인 수급 상태입니다.')
        },
        disparity20: Math.round(disparity * 10) / 10,
        volumeSurge: vcp
      },
      ichimokuStatus: ichimoku.status,
      checklist: {
        ...stock.checklist,
        vcpPattern: vcp ? 1 : 0,
        roeType3: (dartFinancials?.roe ?? 0) >= 15 ? 1 : 0,
        ocfQuality: dartFinancials?.ocfGreaterThanNetIncome ? 1 : 0,
        interestCoverage: (dartFinancials?.interestCoverageRatio ?? 0) >= 3 ? 1 : 0,
        institutionalBuying: kisSupply?.institutionNet > 0 ? 1 : 0,
        supplyInflow: kisSupply?.foreignNet > 0 ? 1 : 0,
      },
      valuation: {
        ...stock.valuation,
        debtRatio: dartFinancials?.debtRatio || stock.valuation.debtRatio,
      },
      financialUpdatedAt: dartFinancials?.updatedAt || stock.financialUpdatedAt
    };

    if (dartFinancials) {
      enriched.roeAnalysis = {
        historicalTrend: stock.roeAnalysis?.historicalTrend || 'N/A',
        strategy: stock.roeAnalysis?.strategy || 'N/A',
        ...stock.roeAnalysis,
        drivers: [
          `실제 ROE: ${dartFinancials.roe.toFixed(2)}% (DART 실계산)`,
          `이자보상배율: ${dartFinancials.interestCoverageRatio.toFixed(2)}배`,
          `OCF > 순이익: ${dartFinancials.ocfGreaterThanNetIncome ? 'YES' : 'NO'}`,
          ...(stock.roeAnalysis?.drivers || [])
        ],
        metrics: {
          netProfitMargin: dartFinancials.netProfitMargin,
          assetTurnover: stock.roeAnalysis?.metrics?.assetTurnover || 0,
          equityMultiplier: stock.roeAnalysis?.metrics?.equityMultiplier || 0,
        }
      };
    }

    return enriched;
  } catch (error) {
    console.error(`Error enriching stock ${stock.name}:`, error);
    return { ...stock, dataSourceType: 'AI' };
  }
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
