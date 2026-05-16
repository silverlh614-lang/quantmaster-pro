import { describe, expect, it } from 'vitest';
import { computeEffectiveKelly, formatKellyPolicyBlockedLog } from './kellyPolicyBlock.js';

describe('kellyPolicyBlock', () => {
  it('forces Kelly to zero when R6_DEFENSE blocks live entry', () => {
    const result = computeEffectiveKelly({
      baseKelly: 0.8,
      vixMultiplier: 0.7,
      ipsMultiplier: 1,
      accountMultiplier: 1.08,
      kellyFloor: 0.15,
      liveEntryAllowed: false,
      macroRegime: 'R6_DEFENSE',
      executionMode: 'SHADOW_ONLY',
      marketSessionState: 'NON_TRADING_DAY',
      blockReasons: ['R6_DEFENSE'],
    });

    expect(result.blockedByPolicy).toBe(true);
    expect(result.floorApplied).toBe(false);
    expect(result.effectiveKelly).toBe(0);

    const log = formatKellyPolicyBlockedLog({
      macroRegime: 'R6_DEFENSE',
      executionMode: 'SHADOW_ONLY',
      marketSessionState: 'NON_TRADING_DAY',
      liveEntryAllowed: false,
      shadowLearningAllowed: true,
      result,
    });
    expect(log).toContain('[KELLY_POLICY_BLOCKED]');
    expect(log).toContain('effectiveKelly=0');
    expect(log).not.toContain('유효 ×0.15');
  });

  it('applies floor only when live entry is allowed', () => {
    const result = computeEffectiveKelly({
      baseKelly: 0.08,
      vixMultiplier: 1,
      ipsMultiplier: 1,
      accountMultiplier: 1,
      kellyFloor: 0.15,
      liveEntryAllowed: true,
      macroRegime: 'R2_NEUTRAL',
      executionMode: 'NORMAL',
      marketSessionState: 'OPEN',
    });

    expect(result.blockedByPolicy).toBe(false);
    expect(result.floorApplied).toBe(true);
    expect(result.rawKelly).toBeCloseTo(0.08);
    expect(result.effectiveKelly).toBe(0.15);
  });
});
