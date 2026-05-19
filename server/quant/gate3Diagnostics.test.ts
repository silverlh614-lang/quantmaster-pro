import { describe, expect, it } from 'vitest';
import { DEFAULT_CONDITION_WEIGHTS, evaluateServerGate, type ServerGateResult } from '../quantFilter.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';

function q(overrides: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended { return {
  price: 120,currentPrice:120,changePercent:2.5,rsi14:58,rsi5dAgo:52,return5d:4,return20d:12,ma5:118,ma20:112,ma60:104,volume:300000,avgVolume:100000,avgVolume20d:100000,volumeRatio:2.5,tradingValue:1200000000,high5d:119,high20d:119,high60d:119,low20d:100,low60d:90,bbWidthCurrent:6,bbWidth20dAvg:10,atr:1.2,atr14:1.2,atr5d:1.1,macdHistogram:1.2,macd5dHistAgo:-0.3,dailyVolumeDrying:true,atr20avg:2,vol5dAvg:1,vol20dAvg:1,per:12,weeklyRSI:55,ma60TrendUp:true,...overrides } as YahooQuoteExtended; }

function run(quote:YahooQuoteExtended):ServerGateResult { return evaluateServerGate(quote, DEFAULT_CONDITION_WEIGHTS, 1, null, null); }

describe('Gate3 diagnostics wiring',()=>{
  it('all inputs available',()=>{ const r=run(q()); const g3=r.gateLayerSummary!.gate3 as any;
    expect(g3.sourceCoverage.missingInputs).toEqual([]);
    expect(g3.sourceCoverage.allRequiredDataAvailable).toBe(true);
    expect(g3.externalDataCoverage.technicalIndicators.status).toBe('VERIFIED');
    expect(g3.externalDataCoverage.volumeStructure.status).toBe('VERIFIED');
    expect(g3.externalDataCoverage.priceStructure.status).toBe('VERIFIED');
    expect(g3.externalDataCoverage.technicalIndicators.marketSignal).toBe(false);
  });
  it('RSI/MACD missing',()=>{ const r=run(q({rsi14: undefined as never, macdHistogram: undefined as never})); const g3=r.gateLayerSummary!.gate3 as any;
    expect(g3.sourceCoverage.missingInputs).toEqual(expect.arrayContaining(['quote.rsi14','quote.macdHistogram']));
    expect(['MISSING','CALCULATION_MISSING']).toContain(g3.externalDataCoverage.technicalIndicators.status);
  });
  it('avgVolume missing',()=>{ const r=run(q({avgVolume: undefined as never})); const g3=r.gateLayerSummary!.gate3 as any; const vb=g3.wiring.find((w:any)=>w.key==='volume_breakout');
    expect(vb.missingInputs).toContain('quote.avgVolume');
    expect(['MISSING','CALCULATION_MISSING']).toContain(g3.externalDataCoverage.volumeStructure.status);
  });
  it('high20d missing',()=>{ const r=run(q({high20d: undefined as never})); const g3=r.gateLayerSummary!.gate3 as any; const th=g3.wiring.find((w:any)=>w.key==='turtle_high');
    expect(th.missingInputs).toContain('quote.high20d');
    expect(['MISSING','CALCULATION_MISSING']).toContain(g3.externalDataCoverage.priceStructure.status);
  });
  it('intraday missing is optional',()=>{ const r=run(q()); const g3=r.gateLayerSummary!.gate3 as any;
    expect(['STAGE_NOT_FETCHED','MISSING']).toContain(g3.externalDataCoverage.intradayTiming.status);
    expect(g3.externalDataCoverage.intradayTiming.required).toBe(false);
  });
});
