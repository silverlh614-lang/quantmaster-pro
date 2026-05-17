import { describe, expect, it } from 'vitest';
import { runAdvisoryScreenerPipeline } from './advisoryScreenerPipeline.js';
import type { ScreenerUniverseItem } from './quantScreenerTypes.js';

function candidate(): ScreenerUniverseItem {
  return {
    symbol: '000003',
    name: '파이프라인테스트',
    market: 'KOSPI',
    marketCapKrw: { value: 300_000_000_000, confidence: 'VERIFIED' },
    avgTradingValue20dKrw: { value: 3_000_000_000, confidence: 'VERIFIED' },
    latestClose: { value: 9_600, confidence: 'VERIFIED' },
    per: { value: 8, confidence: 'VERIFIED' },
    isManaged: { value: false, confidence: 'VERIFIED' },
    isTradingHalt: { value: false, confidence: 'VERIFIED' },
    volume: { value: 400, confidence: 'VERIFIED' },
    avgVolume20d: { value: 100, confidence: 'VERIFIED' },
    high52w: { value: 10_000, confidence: 'VERIFIED' },
    ma20: { value: 9_000, confidence: 'VERIFIED' },
    relativeStrengthPct: { value: 3, confidence: 'VERIFIED' },
    institutionForeignNetBuy3d: { value: true, confidence: 'VERIFIED' },
    volatilityContraction: { value: true, confidence: 'VERIFIED' },
  };
}

describe('runAdvisoryScreenerPipeline', () => {
  it('returns executionImpact NONE without live execution permission', async () => {
    const result = await runAdvisoryScreenerPipeline({ universe: [candidate()], aiEnabled: true, now: new Date('2026-05-17T00:00:00.000Z') });
    expect(result.executionImpact).toBe('NONE');
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.shadowLearning).toBe(true);
    expect(result.candidates[0].aiAnalysis?.confidence).toBe('AI_ESTIMATED');
    expect(result.candidates[0].dataConfidence.verified).toBeGreaterThan(0);
  });

  it('keeps stages inside advisory-only allowed set', async () => {
    const result = await runAdvisoryScreenerPipeline({ universe: [candidate()], aiEnabled: true });
    expect(['OBSERVE', 'SHADOW_SCORE', 'ADVISORY']).toContain(result.candidates[0].stage);
  });

  it('returns empty result when no candidates pass', async () => {
    const result = await runAdvisoryScreenerPipeline({ universe: [], aiEnabled: true });
    expect(result.candidates).toEqual([]);
    expect(result.telemetry.aiSkippedReason).toBe('NO_CANDIDATES');
  });
});
