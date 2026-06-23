// @responsibility ADR-0650 isPullbackLaneForwardObservationEnabled flag SSOT 회귀 — default OFF·정확 'true' opt-IN.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPullbackLaneForwardObservationEnabled } from './gateConfig.js';

describe('ADR-0650 isPullbackLaneForwardObservationEnabled (flag SSOT)', () => {
  const ORIGINAL = process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED;

  beforeEach(() => {
    delete process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED;
    else process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED = ORIGINAL;
  });

  it('미설정(기본) → false', () => {
    expect(isPullbackLaneForwardObservationEnabled()).toBe(false);
  });

  it("정확히 'true' → true", () => {
    process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED = 'true';
    expect(isPullbackLaneForwardObservationEnabled()).toBe(true);
  });

  it("'true' 외 값(임의값)은 모두 false (opt-IN 안전 기본)", () => {
    for (const v of ['1', 'TRUE', 'yes', 'on', 'false', '']) {
      process.env.PULLBACK_LANE_FORWARD_OBSERVATION_ENABLED = v;
      expect(isPullbackLaneForwardObservationEnabled()).toBe(false);
    }
  });
});
