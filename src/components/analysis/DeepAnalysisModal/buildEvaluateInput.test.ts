// @responsibility buildDeepAnalysisEvaluateInput 회귀 테스트 (cc 분해 검증)
import { describe, it, expect } from 'vitest';
import {
  buildDeepAnalysisEvaluateInput,
  deriveRrr,
  type DeepAnalysisEvaluateContext,
} from './buildEvaluateInput';
import type { StockRecommendation } from '../../../services/stockService';

const baseStock: StockRecommendation = {
  code: '005930',
  name: '삼성전자',
  type: 'STRONG_BUY',
  reason: '강한 모멘텀',
  currentPrice: 70000,
  targetPrice: 84000,
  stopLoss: 65000,
  confidenceScore: 80,
  marketCapCategory: 'LARGE',
  relatedSectors: ['반도체'],
  isSectorTopPick: true,
  sectorLeaderNewHigh: false,
  isPullbackVolumeLow: false,
  marketSentiment: { vkospi: 18, iri: 4.0 },
  aiConvictionScore: { marketPhase: 'BULL' },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const baseCtx: DeepAnalysisEvaluateContext = {
  marketOverview: { dynamicWeights: { '1': 1.2 } },
  macroEnv: null,
  exportRatio: 0.4,
  smartMoneyData: null,
  exportMomentumData: null,
  geoRiskData: null,
  creditSpreadData: null,
  extendedRegimeData: null,
  economicRegimeData: null,
  supplyChainData: null,
  financialStressData: null,
  newsFrequencyScores: [],
  globalCorrelation: null,
  weeklyRsiValues: [],
};

describe('deriveRrr', () => {
  it('정상 입력 시 (target - current) / (current - stop) 반환', () => {
    expect(deriveRrr({ ...baseStock })).toBeCloseTo((84000 - 70000) / (70000 - 65000), 5);
  });

  it('currentPrice <= 0 시 fallback 2.1', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(deriveRrr({ ...baseStock, currentPrice: 0 } as any)).toBe(2.1);
  });

  it('targetPrice <= currentPrice 시 fallback 2.1', () => {
    expect(deriveRrr({ ...baseStock, targetPrice: 70000 })).toBe(2.1);
  });

  it('stopLoss <= 0 시 fallback 2.1', () => {
    expect(deriveRrr({ ...baseStock, stopLoss: 0 })).toBe(2.1);
  });
});

describe('buildDeepAnalysisEvaluateInput', () => {
  it('정상 입력 시 EvaluateStockInput 반환 (rawStockData 27 keys)', () => {
    const out = buildDeepAnalysisEvaluateInput(baseStock, baseCtx);
    expect(Object.keys(out.rawStockData as Record<string, number>).length).toBe(27);
  });

  it('marketPhase=BULL 시 regime.type=상승초기', () => {
    const out = buildDeepAnalysisEvaluateInput(baseStock, baseCtx);
    expect(out.regime.type).toBe('상승초기');
  });

  it('marketPhase=BEAR 시 regime.type=하락', () => {
    const stock = { ...baseStock, aiConvictionScore: { marketPhase: 'BEAR' } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = buildDeepAnalysisEvaluateInput(stock as any, baseCtx);
    expect(out.regime.type).toBe('하락');
  });

  it('marketPhase=SIDEWAYS 시 regime.type=횡보', () => {
    const stock = { ...baseStock, aiConvictionScore: { marketPhase: 'SIDEWAYS' } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = buildDeepAnalysisEvaluateInput(stock as any, baseCtx);
    expect(out.regime.type).toBe('횡보');
  });

  it('marketPhase=알 수 없음 시 regime.type=변동성', () => {
    const stock = { ...baseStock, aiConvictionScore: { marketPhase: 'UNKNOWN' } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = buildDeepAnalysisEvaluateInput(stock as any, baseCtx);
    expect(out.regime.type).toBe('변동성');
  });

  it('marketCapCategory=LARGE 시 profileType=A', () => {
    const out = buildDeepAnalysisEvaluateInput(baseStock, baseCtx);
    expect(out.profileType).toBe('A');
  });

  it('marketCapCategory!=LARGE 시 profileType=B', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stock = { ...baseStock, marketCapCategory: 'MID' } as any;
    const out = buildDeepAnalysisEvaluateInput(stock, baseCtx);
    expect(out.profileType).toBe('B');
  });

  it('relatedSectors[0] 가 sectorRotation.name 으로 전달', () => {
    const out = buildDeepAnalysisEvaluateInput(baseStock, baseCtx);
    expect(out.sectorRotation.name).toBe('반도체');
    expect(out.stockSector).toBe('반도체');
  });

  it('relatedSectors 부재 시 sectorRotation.name=Unknown', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stock = { ...baseStock, relatedSectors: undefined } as any;
    const out = buildDeepAnalysisEvaluateInput(stock, baseCtx);
    expect(out.sectorRotation.name).toBe('Unknown');
    expect(out.stockSector).toBeUndefined();
  });

  it('weeklyRsiValues 빈 배열 시 advancedContext.weeklyRsiValues=undefined', () => {
    const out = buildDeepAnalysisEvaluateInput(baseStock, baseCtx);
    expect(out.advancedContext?.weeklyRsiValues).toBeUndefined();
  });

  it('weeklyRsiValues 비어있지 않으면 그대로 전달', () => {
    const ctx = { ...baseCtx, weeklyRsiValues: [55, 60, 65] };
    const out = buildDeepAnalysisEvaluateInput(baseStock, ctx);
    expect(out.advancedContext?.weeklyRsiValues).toEqual([55, 60, 65]);
  });

  it('macroEnv=null 시 undefined 로 정규화', () => {
    const out = buildDeepAnalysisEvaluateInput(baseStock, baseCtx);
    expect(out.macroEnv).toBeUndefined();
  });

  it('newsFrequencyScores 매칭 시 newsPhase 전달', () => {
    const ctx = { ...baseCtx, newsFrequencyScores: [{ code: '005930', phase: 'PEAK' }] };
    const out = buildDeepAnalysisEvaluateInput(baseStock, ctx);
    expect(out.advancedContext?.newsPhase).toBe('PEAK');
  });

  it('newsFrequencyScores 매칭 없으면 newsPhase=undefined', () => {
    const ctx = { ...baseCtx, newsFrequencyScores: [{ code: '999999', phase: 'PEAK' }] };
    const out = buildDeepAnalysisEvaluateInput(baseStock, ctx);
    expect(out.advancedContext?.newsPhase).toBeUndefined();
  });

  it('extendedRegimeData.regime 우선, 없으면 economicRegimeData.regime', () => {
    const ctx1 = {
      ...baseCtx,
      extendedRegimeData: { regime: 'EXPANSION' },
      economicRegimeData: { regime: 'RECOVERY' },
    };
    expect(buildDeepAnalysisEvaluateInput(baseStock, ctx1).advancedContext?.economicRegime).toBe('EXPANSION');

    const ctx2 = {
      ...baseCtx,
      extendedRegimeData: null,
      economicRegimeData: { regime: 'RECOVERY' },
    };
    expect(buildDeepAnalysisEvaluateInput(baseStock, ctx2).advancedContext?.economicRegime).toBe('RECOVERY');
  });

  it('supplyData.institutionalDailyAmounts 가 있으면 advancedContext 에 전달', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stock = { ...baseStock, supplyData: { institutionalDailyAmounts: [100, 200] } } as any;
    const out = buildDeepAnalysisEvaluateInput(stock, baseCtx);
    expect(out.advancedContext?.institutionalAmounts).toEqual([100, 200]);
  });

  it('extendedRegimeOptions.kospi60dVolatility 정상 전달', () => {
    const ctx = {
      ...baseCtx,
      extendedRegimeData: {
        regime: 'EXPANSION',
        uncertaintyMetrics: { kospi60dVolatility: 0.18, leadingSectorCount: 5 },
      },
    };
    const out = buildDeepAnalysisEvaluateInput(baseStock, ctx);
    expect(out.extendedRegimeOptions?.kospi60dVolatility).toBe(0.18);
    expect(out.extendedRegimeOptions?.leadingSectorCount).toBe(5);
  });

  it('marketOverview.dynamicWeights 가 regime.weightMultipliers 로 전달', () => {
    const out = buildDeepAnalysisEvaluateInput(baseStock, baseCtx);
    expect(out.regime.weightMultipliers).toEqual({ '1': 1.2 });
  });

  it('marketSentiment 부재 시 vKospi=15, samsungIri=3.5 fallback', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stock = { ...baseStock, marketSentiment: undefined } as any;
    const out = buildDeepAnalysisEvaluateInput(stock, baseCtx);
    expect(out.regime.vKospi).toBe(15);
    expect(out.regime.samsungIri).toBe(3.5);
  });
});
