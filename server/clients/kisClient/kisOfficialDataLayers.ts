// @responsibility KIS official API data-layer separation map.

import { KIS_OFFICIAL_ENDPOINTS } from './kisOfficialEndpointRegistry.js';

export const KIS_OFFICIAL_DATA_LAYERS = {
  quoteProvider: {
    source: 'KIS_API',
    normalizedType: 'KisNormalizedQuote',
    endpoint: KIS_OFFICIAL_ENDPOINTS.inquirePrice.path,
    trId: KIS_OFFICIAL_ENDPOINTS.inquirePrice.trId,
    providesTechnicalIndicators: false,
  },
  ohlcvChartProvider: {
    source: 'KIS_API',
    normalizedType: 'KisDailyCandle',
    endpoint: KIS_OFFICIAL_ENDPOINTS.inquireDailyItemChartPrice.path,
    trId: KIS_OFFICIAL_ENDPOINTS.inquireDailyItemChartPrice.trId,
    computes: ['ma20', 'ma60', 'rsi14', 'atr14'],
  },
  investorFlowProvider: {
    source: 'KIS_API',
    normalizedType: 'KisInvestorFlow',
    endpoints: [
      KIS_OFFICIAL_ENDPOINTS.inquireInvestor.path,
      KIS_OFFICIAL_ENDPOINTS.investorTradeByStockDaily.path,
    ],
  },
  balanceProvider: {
    source: 'KIS_API',
    endpoints: [
      KIS_OFFICIAL_ENDPOINTS.inquireBalance.path,
      KIS_OFFICIAL_ENDPOINTS.inquireDailyCcld.path,
      KIS_OFFICIAL_ENDPOINTS.inquirePsblOrder.path,
      KIS_OFFICIAL_ENDPOINTS.inquirePsblRvsecncl.path,
    ],
  },
  orderProvider: {
    source: 'KIS_API',
    endpoints: [
      KIS_OFFICIAL_ENDPOINTS.orderCash.path,
      KIS_OFFICIAL_ENDPOINTS.orderRvsecncl.path,
      KIS_OFFICIAL_ENDPOINTS.orderCredit.path,
    ],
  },
} as const;

export const KIS_SOURCE_PIPELINE_ORDER = [
  'KisRawResponse',
  'KisNormalizedQuote/KisDailyCandle/KisInvestorFlow',
  'FeatureSnapshot',
  'CommonGate',
] as const;
