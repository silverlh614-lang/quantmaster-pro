import { describe, expect, it } from 'vitest';
import { DEFAULT_CONDITION_WEIGHTS, evaluateServerGate, type ServerGateResult } from '../quantFilter.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';
import { normalizeGate3VolumeTiming } from './gate3Diagnostics.js';

function q(overrides: Record<string, unknown> = {}): YahooQuoteExtended { return {
  price: 10000,currentPrice:10000,changePercent:2.5,rsi14:58,rsi5dAgo:52,return5d:4,return20d:12,ma5:118,ma20:112,ma60:104,volume:2400000,avgVolume:1000000,avgVolume20d:1100000,volumeRatio:2.4,tradingValue:24000000000,avgTradingValue20d:11000000000,high5d:119,high20d:119,high60d:119,low20d:100,low60d:90,bbWidthCurrent:6,bbWidth20dAvg:10,atr:1.2,atr14:1.2,atr5d:1.1,atr20avg:2,recentVolumeAvg3d:300000,contractionCount:3,rangeContraction:0.2,macdHistogram:1.2,macd5dHistAgo:-0.3,dailyVolumeDrying:true,vol5dAvg:1,vol20dAvg:1,per:12,weeklyRSI:55,ma60TrendUp:true,...overrides } as unknown as YahooQuoteExtended; }
const run=(quote:YahooQuoteExtended):ServerGateResult=>evaluateServerGate(quote, DEFAULT_CONDITION_WEIGHTS, 1, null, null);

describe('Gate3 diagnostics wiring',()=>{
  it('normal breakout volume inputs are verified',()=>{ const g3=(run(q()).gateLayerSummary!.gate3 as any); const vt=g3.externalDataCoverage.volumeTiming;
    expect(vt.values.volumeRatio).toBeCloseTo(2.4,5); expect(vt.values.tradingValueRatio).toBeCloseTo(24000000000/11000000000,5); expect(vt.marketSignal).toBe(false);
  });
  it('trading value fallback',()=>{ const vt=normalizeGate3VolumeTiming({quote:q({volume:200000,avgVolume:undefined as never,avgVolume20d:100000,tradingValue:undefined as never,avgTradingValue20d:undefined as never,currentPrice:10000}) as unknown as Record<string, unknown>});
    expect(vt.tradingValue).toBe(2000000000); expect(vt.avgTradingValue20d).toBe(1000000000); expect(vt.notes).toContain('FALLBACK_TRADING_VALUE_FROM_VOLUME_PRICE');
  });
  it('avgVolume missing is missing/degraded not weak',()=>{ const vt=normalizeGate3VolumeTiming({quote:q({avgVolume:undefined as never,avgVolume20d:undefined as never}) as unknown as Record<string, unknown>});
    expect(vt.volumeRatio).toBeNull(); expect(['MISSING','DEGRADED','CALCULATION_MISSING']).toContain(vt.status); expect(vt.missingFields).toContain('avgVolume'); expect(vt.marketSignal).toBe(false);
  });
  it('dry-up pass and missing split',()=>{ const pass=normalizeGate3VolumeTiming({quote:q({recentVolumeAvg3d:300000,avgVolume20d:1000000}) as never}); expect(pass.dryUp.dryUpRatio).toBeCloseTo(0.3,5); expect(['PASS','FAIL']).toContain(pass.dryUp.status);
    const miss=normalizeGate3VolumeTiming({quote:q({recentVolumeAvg3d:undefined as never}) as never}); expect(miss.dryUp.status).toBe('MISSING'); expect(miss.dryUp.reason).toContain('INPUT_MISSING');
  });
  it('vcp missing => calc missing and no bearish signal promotion',()=>{ const miss=run(q({bbWidthCurrent:undefined as never,atr14:undefined as never,contractionCount:undefined as never})); const vt=(miss.gateLayerSummary!.gate3 as any).externalDataCoverage.volumeTiming;
    expect(['MISSING','UNKNOWN']).toContain(vt.vcp.status); expect(vt.calculationIssue).toBe(true); expect(vt.marketSignal).toBe(false);
  });
  it('intraday missing -> daily granularity',()=>{ const vt=normalizeGate3VolumeTiming({quote:q() as never, intraday:null}); expect(vt.dataGranularity).toBe('DAILY'); expect(vt.notes).toContain('INTRADAY_NOT_FETCHED'); expect(vt.marketSignal).toBe(false); });
});
