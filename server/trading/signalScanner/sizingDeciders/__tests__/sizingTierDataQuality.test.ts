// @responsibility ADR-0117 sizingTierDecider DataQuality BLOCKED 분기 회귀
import { describe, expect, it } from 'vitest';
import { sizingTierDecider } from '../sizingTierDecider.js';
import type { DataQualityInfo } from '../../../../types/dataQuality.js';

const BASE_INPUT = {
  stockName: '삼성전자',
  liveGateScore: 9,
  reCheckGate: { mtas: 8, conditionKeys: ['cond_a', 'cond_b'] },
  regime: 'R2_BULL',
  macroState: null,
  banditDecision: { kellyMultiplier: 1.0, allowEntry: true } as never,
  probingReservedSlots: 0,
};

function dq(status: DataQualityInfo['status']): DataQualityInfo {
  return {
    status,
    reason: `test_${status.toLowerCase()}`,
    updatedAt: new Date().toISOString(),
  };
}

describe('sizingTierDecider — ADR-0117 DataQuality BLOCKED', () => {
  it('dataQuality 부재 → 기존 동작 (후방호환)', () => {
    const r = sizingTierDecider({ ...BASE_INPUT });
    // BLOCKED 분기 미진입 — ok=true 또는 기존 차단 분기
    if (!r.ok) {
      expect(r.logMessage).not.toMatch(/DATA_QUARANTINE/);
    }
  });

  it('dataQuality.status=OK → BLOCKED 미적용 (기존 동작)', () => {
    const r = sizingTierDecider({ ...BASE_INPUT, dataQuality: dq('OK') });
    if (!r.ok) {
      expect(r.logMessage).not.toMatch(/DATA_QUARANTINE/);
    }
  });

  it('STALE_BASE_OR_SPLIT_ADJUSTMENT → BLOCKED', () => {
    const r = sizingTierDecider({
      ...BASE_INPUT,
      dataQuality: dq('STALE_BASE_OR_SPLIT_ADJUSTMENT'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.logMessage).toMatch(/BLOCKED/);
      expect(r.logMessage).toMatch(/DATA_QUARANTINE_STALE_BASE_OR_SPLIT_ADJUSTMENT/);
      expect(r.logMessage).toMatch(/삼성전자/);
    }
  });

  it('ZERO_OR_INVALID_PRICE → BLOCKED', () => {
    const r = sizingTierDecider({
      ...BASE_INPUT,
      dataQuality: dq('ZERO_OR_INVALID_PRICE'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.logMessage).toMatch(/DATA_QUARANTINE_ZERO_OR_INVALID_PRICE/);
    }
  });

  it('SOURCE_UNTRUSTED → BLOCKED', () => {
    const r = sizingTierDecider({
      ...BASE_INPUT,
      dataQuality: dq('SOURCE_UNTRUSTED'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.logMessage).toMatch(/DATA_QUARANTINE_SOURCE_UNTRUSTED/);
    }
  });

  it('OK + 그 외 정상 입력 — BLOCKED 분기 진입 안 함 (다른 분기는 가능)', () => {
    const r = sizingTierDecider({ ...BASE_INPUT, dataQuality: dq('OK') });
    // shouldBlockTradingByDataQuality(OK) === false → BLOCKED 분기 미진입
    if (!r.ok) {
      expect(r.logMessage).not.toMatch(/DATA_QUARANTINE/);
    }
  });
});
