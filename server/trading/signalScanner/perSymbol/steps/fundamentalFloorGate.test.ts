// @responsibility ADR-0659 펀더멘털 deep-junk floor 진입 게이트 테스트.

import { describe, it, expect, afterEach } from 'vitest';
import { evaluateFundamentalFloorGate } from './fundamentalFloorGate.js';
import type { ScanCounters } from '../../scanDiagnostics.js';

function makeCounters(): ScanCounters {
  return { perStageDropoff: {} } as unknown as ScanCounters;
}

const ORIG_FLAG = process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED;
const ORIG_FLOOR = process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT;
afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED;
  else process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED = ORIG_FLAG;
  if (ORIG_FLOOR === undefined) delete process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT;
  else process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT = ORIG_FLOOR;
});

describe('evaluateFundamentalFloorGate (ADR-0659)', () => {
  it('ROE-junk 후보(서산 -55.6) → EXCLUDE + RISK_FUNDAMENTAL_FLOOR_EXCLUDED + perStageDropoff BLOCKED', () => {
    delete process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED; // default ON
    delete process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT; // default -20
    const counters = makeCounters();
    const result = evaluateFundamentalFloorGate({
      stockCode: '079650',
      stockName: '서산',
      scanCounters: counters,
      roePctOverride: -55.6,
    });
    expect(result.decision).toBe('EXCLUDE');
    expect(result.blockReason).toContain('RISK_FUNDAMENTAL_FLOOR_EXCLUDED');
    expect(result.blockReason).toContain('ROE=-55.6');
    expect(counters.perStageDropoff.LIVE_ORDER_BLOCKED?.BLOCKED).toBe(1);
  });

  it('ROE exactly == floor (-20) → EXCLUDE (경계 ≤ 포함, executable entry 아님)', () => {
    delete process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED;
    delete process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT;
    const result = evaluateFundamentalFloorGate({
      stockCode: '111111',
      stockName: '경계종목',
      scanCounters: makeCounters(),
      roePctOverride: -20,
    });
    expect(result.decision).toBe('EXCLUDE');
  });

  it('경미한 적자(-5) → PROCEED (턴어라운드 살림)', () => {
    delete process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED;
    delete process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT;
    const result = evaluateFundamentalFloorGate({
      stockCode: '222222',
      stockName: '턴어라운드',
      scanCounters: makeCounters(),
      roePctOverride: -5,
    });
    expect(result.decision).toBe('PROCEED');
  });

  it('ROE 결손(null) → PROCEED (graceful, 데이터 결손≠junk, 불변식 #6)', () => {
    delete process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED;
    const result = evaluateFundamentalFloorGate({
      stockCode: '333333',
      stockName: '재무미가용',
      scanCounters: makeCounters(),
      roePctOverride: null,
    });
    expect(result.decision).toBe('PROCEED');
  });

  it('flag =false → PROCEED (byte-identical, ROE-junk 이어도 제외 미적용)', () => {
    process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED = 'false';
    const counters = makeCounters();
    const result = evaluateFundamentalFloorGate({
      stockCode: '079650',
      stockName: '서산',
      scanCounters: counters,
      roePctOverride: -55.6,
    });
    expect(result.decision).toBe('PROCEED');
    expect(counters.perStageDropoff.LIVE_ORDER_BLOCKED).toBeUndefined();
  });

  it('floor ENV override (-40) → ROE -30 은 PROCEED, -55 는 EXCLUDE', () => {
    delete process.env.RISK_FUNDAMENTAL_FLOOR_EXCLUSION_ENABLED;
    process.env.RISK_FUNDAMENTAL_ROE_FLOOR_PCT = '-40';
    const mild = evaluateFundamentalFloorGate({
      stockCode: '444444',
      stockName: '중간적자',
      scanCounters: makeCounters(),
      roePctOverride: -30,
    });
    expect(mild.decision).toBe('PROCEED');
    const deep = evaluateFundamentalFloorGate({
      stockCode: '555555',
      stockName: '깊은적자',
      scanCounters: makeCounters(),
      roePctOverride: -55,
    });
    expect(deep.decision).toBe('EXCLUDE');
  });
});
