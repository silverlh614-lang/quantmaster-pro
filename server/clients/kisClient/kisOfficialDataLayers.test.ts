// @responsibility KIS official API layer separation regression tests.

import { describe, expect, it } from 'vitest';
import { KIS_OFFICIAL_DATA_LAYERS, KIS_SOURCE_PIPELINE_ORDER } from './kisOfficialDataLayers.js';

describe('KIS official data layers', () => {
  it('separates quote from OHLCV-derived technical indicators', () => {
    expect(KIS_OFFICIAL_DATA_LAYERS.quoteProvider).toMatchObject({
      endpoint: '/uapi/domestic-stock/v1/quotations/inquire-price',
      normalizedType: 'KisNormalizedQuote',
      providesTechnicalIndicators: false,
    });
    expect(KIS_OFFICIAL_DATA_LAYERS.ohlcvChartProvider).toMatchObject({
      endpoint: '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
      normalizedType: 'KisDailyCandle',
    });
    expect(KIS_OFFICIAL_DATA_LAYERS.ohlcvChartProvider.computes).toEqual(['ma20', 'ma60', 'rsi14', 'atr14']);
  });

  it('documents the raw-to-normalized-to-feature-to-common-gate order', () => {
    expect(KIS_SOURCE_PIPELINE_ORDER).toEqual([
      'KisRawResponse',
      'KisNormalizedQuote/KisDailyCandle/KisInvestorFlow',
      'FeatureSnapshot',
      'CommonGate',
    ]);
  });
});
