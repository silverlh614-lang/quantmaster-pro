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
import type { TranchePlan } from '../../types/quant';

export function calculateTranchePlan(currentPrice: number, stopLoss: number, targetPrice: number): TranchePlan {
  const risk = currentPrice - stopLoss;
  const reward = targetPrice - currentPrice;

  return {
    tranche1: { size: 30, trigger: `${currentPrice.toLocaleString()} (즉시)`, status: 'PENDING' },
    tranche2: { size: 40, trigger: `${Math.round(currentPrice - (risk * 0.382)).toLocaleString()} (피보나치 38.2%)`, status: 'PENDING' },
    tranche3: { size: 30, trigger: `${Math.round(currentPrice + (reward * 0.1)).toLocaleString()} (모멘텀 가속)`, status: 'PENDING' }
  };
}

/**
 * AI 응답이 토큰 한도로 잘려 trading 필드(targetPrice/stopLoss/entryPrice)가 0 으로
 * 남은 경우를 보정한다. 현재가 기반 기본값:
 *   - targetPrice: +20% (1차 목표 표준)
 *   - targetPrice2: +35%
 *   - entryPrice:   현재가
 *   - stopLoss:     -7%
 * 이미 유효값이 있으면(> 0) 그대로 통과.
 */
export function applyTradingFieldFallbacks<
  T extends {
    targetPrice?: number;
    targetPrice2?: number;
    entryPrice?: number;
    stopLoss?: number;
  }
>(stock: T, currentPrice: number): T {
  if (!currentPrice || currentPrice <= 0) return stock;
  const isValid = (v: number | undefined): v is number => typeof v === 'number' && v > 0;
  return {
    ...stock,
    targetPrice:  isValid(stock.targetPrice)  ? stock.targetPrice  : Math.round(currentPrice * 1.20),
    targetPrice2: isValid(stock.targetPrice2) ? stock.targetPrice2 : Math.round(currentPrice * 1.35),
    entryPrice:   isValid(stock.entryPrice)   ? stock.entryPrice   : Math.round(currentPrice),
    stopLoss:     isValid(stock.stopLoss)     ? stock.stopLoss     : Math.round(currentPrice * 0.93),
  };
}

export async function enrichStockWithRealData(stock: StockRecommendation): Promise<StockRecommendation> {
  // Fix 2 — enrich 실패 경로에서도 targetPrice/stopLoss 가 0 으로 남지 않도록
  // AI 전용 폴백 경로에 동일한 현재가 기반 기본값 적용.
  const aiFallback = (): StockRecommendation => {
    const fallback = applyTradingFieldFallbacks(
      { targetPrice: stock.targetPrice, targetPrice2: stock.targetPrice2,
        entryPrice: stock.entryPrice, stopLoss: stock.stopLoss },
      stock.currentPrice || 0,
    );
    return {
      ...stock,
      targetPrice:  fallback.targetPrice  ?? stock.targetPrice,
      targetPrice2: fallback.targetPrice2 ?? stock.targetPrice2,
      entryPrice:   fallback.entryPrice   ?? stock.entryPrice,
      stopLoss:     fallback.stopLoss     ?? stock.stopLoss,
      dataSourceType: 'AI',
    };
  };

  try {
    const data = await fetchHistoricalData(stock.code, '1y');
    if (!data || !data.timestamp || !data.indicators?.quote?.[0]) {
      return aiFallback();
    }

    const quotes = data.indicators.quote[0];
    const closes = (quotes.close as (number | null)[]).filter((v): v is number => v !== null);
    const highs = (quotes.high as (number | null)[]).filter((v): v is number => v !== null);
    const lows = (quotes.low as (number | null)[]).filter((v): v is number => v !== null);
    const volumes = (quotes.volume as (number | null)[]).filter((v): v is number => v !== null);

    if (closes.length < 26) return aiFallback();

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

    // Fix 2 — AI 응답 토큰 절단으로 targetPrice/stopLoss/entryPrice 가 0 으로 남는
    // 경우를 실시간 현재가 기반 기본값으로 보정. 이미 유효값이 있으면 그대로 사용.
    const resolvedPrice = currentPrice || stock.currentPrice || 0;
    const fallbackFields = applyTradingFieldFallbacks(
      { targetPrice: stock.targetPrice, targetPrice2: stock.targetPrice2,
        entryPrice: stock.entryPrice, stopLoss: stock.stopLoss },
      resolvedPrice,
    );

    const enriched: StockRecommendation = {
      ...stock,
      currentPrice: currentPrice || stock.currentPrice,
      targetPrice:  fallbackFields.targetPrice  ?? stock.targetPrice,
      targetPrice2: fallbackFields.targetPrice2 ?? stock.targetPrice2,
      entryPrice:   fallbackFields.entryPrice   ?? stock.entryPrice,
      stopLoss:     fallbackFields.stopLoss     ?? stock.stopLoss,
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
    return aiFallback();
  }
}
