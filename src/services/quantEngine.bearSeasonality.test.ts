import { describe, expect, it } from 'vitest';
import { evaluateBearRegime, evaluateBearSeasonality } from './quant/bearEngine';
import { evaluateGate0 } from './quant/gateEngine';
import type { MacroEnvironment } from '../types/quant';

function createMacroEnv(partial: Partial<MacroEnvironment> = {}): MacroEnvironment {
  return {
    bokRateDirection: 'HOLDING',
    us10yYield: 4.1,
    krUsSpread: -0.5,
    m2GrowthYoY: 4.0,
    bankLendingGrowth: 3.2,
    nominalGdpGrowth: 3.0,
    oeciCliKorea: 99.5,
    exportGrowth3mAvg: 1.5,
    vkospi: 26,
    samsungIri: 1.1,
    vix: 20,
    usdKrw: 1340,
    ...partial,
  };
}

describe('Bear seasonality calendar', () => {
  it('applies +20% inverse entry weight when bearish season and VKOSPI is rising', () => {
    const macro = createMacroEnv({ vkospiRising: true });
    const result = evaluateBearSeasonality(macro, new Date('2026-09-20T00:00:00.000Z'));

    expect(result.isBearSeason).toBe(true);
    expect(result.inverseEntryWeightPct).toBe(20);
    expect(result.gateThresholdAdjustment).toBe(-1);
  });

  it('keeps zero inverse weight outside seasonal window', () => {
    const macro = createMacroEnv({ vkospiRising: true });
    const result = evaluateBearSeasonality(macro, new Date('2026-02-12T00:00:00.000Z'));

    expect(result.isBearSeason).toBe(false);
    expect(result.inverseEntryWeightPct).toBe(0);
    expect(result.gateThresholdAdjustment).toBe(0);
  });

  it('makes Gate -1 threshold more sensitive during bearish season', () => {
    const macro = createMacroEnv({
      vkospiRising: false,
      kospiBelow120ma: true,
      kospiIchimokuBearish: true,
      samsungIriDelta: 3.2,
      foreignFuturesSellDays: 10,
      usdKrw: 1360,
      mhsTrend: 'DETERIORATING',
    });

    const gate0 = evaluateGate0(macro);
    const seasonality = evaluateBearSeasonality(macro, new Date('2026-10-05T00:00:00.000Z'));
    const bearRegime = evaluateBearRegime(macro, gate0, seasonality);

    expect(seasonality.gateThresholdAdjustment).toBe(-1);
    expect(bearRegime.threshold).toBe(4);
    expect(bearRegime.regime).toBe('BEAR');
  });
});
