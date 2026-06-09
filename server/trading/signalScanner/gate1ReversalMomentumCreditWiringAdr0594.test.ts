// @responsibility ADR-0594 PRICE_MOMENTUM 가산 배선 회귀 — flag OFF byte-equivalent + flag ON risk-on 가산(≤20 clamp) + non-risk-on 불가산.
import { describe, expect, it, afterEach } from 'vitest';
import { buildMinimumSignalScoreTrace } from './minimumSignalScoreTrace.js';

const verifiedSupply = {
  status: 'VERIFIED' as const,
  providerIssue: false,
  marketSignal: false,
  gate1Severity: 'NONE' as const,
  reason: ['ok'],
};

function priceMomentumComponent(opts: {
  regime: string;
  changePercent?: number;
  return5d?: number;
  return20d?: number;
}) {
  const trace = buildMinimumSignalScoreTrace({
    trace: {
      symbol: 'REV',
      stageReached: 'WATCHLIST',
      blockers: [],
      executionImpact: 'NONE',
      return5d: opts.return5d ?? 4,
      return20d: opts.return20d ?? 10,
      changePercent: opts.changePercent,
    } as Parameters<typeof buildMinimumSignalScoreTrace>[0]['trace'],
    hasGate1Blocker: false,
    regime: opts.regime,
    marketSession: 'NORMAL',
    supplyProviderHealth: verifiedSupply,
    supplyConfluenceState: 'NEUTRAL',
    hasSectorEnergyDiagnostic: false,
  });
  return trace.components.find((c) => c.code === 'PRICE_MOMENTUM');
}

afterEach(() => {
  delete process.env.GATE1_REVERSAL_MOMENTUM_ENABLED;
});

describe('ADR-0594 PRICE_MOMENTUM reversal credit wiring', () => {
  it('flag OFF (default) → PRICE_MOMENTUM weightedScore byte-equivalent (changePercent 무시)', () => {
    const noChange = priceMomentumComponent({ regime: 'R3_EARLY' });
    const withStrongChange = priceMomentumComponent({ regime: 'R3_EARLY', changePercent: 7.45 });
    expect(withStrongChange?.weightedScore).toBe(noChange?.weightedScore);
    expect((withStrongChange?.rawValue as { reversalCreditApplied?: boolean })?.reversalCreditApplied).toBe(false);
  });

  it('flag ON + risk-on regime + 강세종목 → weightedScore 상향 (가산 적용)', () => {
    const baseline = priceMomentumComponent({ regime: 'R3_EARLY', changePercent: 7.45 });
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const credited = priceMomentumComponent({ regime: 'R3_EARLY', changePercent: 7.45 });
    expect(credited!.weightedScore).toBeGreaterThan(baseline!.weightedScore);
    expect((credited?.rawValue as { reversalCreditApplied?: boolean })?.reversalCreditApplied).toBe(true);
  });

  it('flag ON + risk-on → maxScore 20 천장 불변 (가산 후 clamp)', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    // 강한 다일집계(return5d/20d 큼) + 과급등 changePercent → weightedScore <= 20 보장.
    const credited = priceMomentumComponent({
      regime: 'R3_EARLY',
      changePercent: 25,
      return5d: 30,
      return20d: 50,
    });
    expect(credited!.maxScore).toBe(20);
    expect(credited!.weightedScore).toBeLessThanOrEqual(20);
  });

  it('flag ON + non-risk-on regime (R4_NEUTRAL) → byte-equivalent (불가산)', () => {
    const off = priceMomentumComponent({ regime: 'R4_NEUTRAL', changePercent: 7.45 });
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const on = priceMomentumComponent({ regime: 'R4_NEUTRAL', changePercent: 7.45 });
    expect(on?.weightedScore).toBe(off?.weightedScore);
    expect((on?.rawValue as { reversalCreditApplied?: boolean })?.reversalCreditApplied).toBe(false);
  });

  it('flag ON + risk-on + changePercent 부재 → 불가산 (보수, 불변식 #6)', () => {
    process.env.GATE1_REVERSAL_MOMENTUM_ENABLED = 'true';
    const c = priceMomentumComponent({ regime: 'R3_EARLY', changePercent: undefined });
    expect((c?.rawValue as { reversalGateReason?: string })?.reversalGateReason).toBe(
      'TODAY_CHANGE_PERCENT_MISSING',
    );
  });
});
