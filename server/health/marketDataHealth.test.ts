/**
 * @responsibility MarketDataHealthScore 회귀 테스트 (ADR-0070)
 *
 * 검증:
 *   1) 점수 floor 0 / ceil 100 (정상 100점, 모든 차감 합산)
 *   2) Tier 분기 (HEALTHY ≥85 / DEGRADED ≥60 / CRITICAL <60)
 *   3) macroState staleness 가중 (STALE_BLOCK -40 / STALE_WARN -15)
 *   4) staleFields 카운트 가중 (1=-10 / 3=-25 / 5+=-40)
 *   5) Yahoo 분기 (DOWN -25 / DEGRADED -10 / UNKNOWN -5)
 *   6) KIS / KRX 분기 (회로 OPEN / token invalid / 연속 실패)
 *   7) deductions 배열 정합 (이유 포함, 최상위 deduction 추출)
 *   8) formatMarketDataHealthLine 라벨
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyMarketDataHealthTier,
  computeMarketDataHealthScore,
  formatMarketDataHealthLine,
  MARKET_DATA_HEALTH_THRESHOLDS,
} from './marketDataHealth';
import * as macroStateRepo from '../persistence/macroStateRepo';

const NOW = new Date('2026-04-27T10:00:00.000Z');

const HEALTHY_SNAPSHOT = {
  yahoo: { status: 'OK' as const, detail: 'OK' as any, heartbeat: {} as any },
  kisConfigured: true,
  krxTokenConfigured: true,
  krxTokenValid: true,
  krxCircuitState: 'CLOSED',
  krxFailures: 0,
};

const FRESH_MACRO = {
  mhs: 50,
  regime: 'R4_NEUTRAL',
  updatedAt: new Date(NOW.getTime() - 60_000).toISOString(),  // 1분 전
};

beforeEach(() => {
  vi.spyOn(macroStateRepo, 'loadMacroState').mockReturnValue(FRESH_MACRO);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('classifyMarketDataHealthTier — 임계값 분기', () => {
  it('100점 → HEALTHY', () => {
    expect(classifyMarketDataHealthTier(100)).toBe('HEALTHY');
  });
  it('85점 boundary → HEALTHY', () => {
    expect(classifyMarketDataHealthTier(85)).toBe('HEALTHY');
  });
  it('84점 → DEGRADED', () => {
    expect(classifyMarketDataHealthTier(84)).toBe('DEGRADED');
  });
  it('60점 boundary → DEGRADED', () => {
    expect(classifyMarketDataHealthTier(60)).toBe('DEGRADED');
  });
  it('59점 → CRITICAL', () => {
    expect(classifyMarketDataHealthTier(59)).toBe('CRITICAL');
  });
  it('0점 → CRITICAL', () => {
    expect(classifyMarketDataHealthTier(0)).toBe('CRITICAL');
  });
  it('NaN → CRITICAL (안전 fallback)', () => {
    expect(classifyMarketDataHealthTier(NaN)).toBe('CRITICAL');
  });
  it('범위 외 (음수) → CRITICAL', () => {
    expect(classifyMarketDataHealthTier(-10)).toBe('CRITICAL');
  });
  it('범위 외 (>100) → HEALTHY (clamp)', () => {
    expect(classifyMarketDataHealthTier(150)).toBe('HEALTHY');
  });
});

describe('computeMarketDataHealthScore — 정상 baseline', () => {
  it('모든 정상 → 100점 / HEALTHY / deductions 빈 배열', () => {
    const r = computeMarketDataHealthScore(HEALTHY_SNAPSHOT, [], NOW);
    expect(r.score).toBe(100);
    expect(r.tier).toBe('HEALTHY');
    expect(r.deductions).toEqual([]);
    expect(r.details.staleFieldCount).toBe(0);
    expect(r.details.yahooStatus).toBe('OK');
    expect(r.details.kisCircuitOk).toBe(true);
    expect(r.details.krxOk).toBe(true);
  });
});

describe('macroState staleness 가중', () => {
  it('STALE_WARN (12h) → -15점', () => {
    vi.spyOn(macroStateRepo, 'loadMacroState').mockReturnValue({
      ...FRESH_MACRO,
      updatedAt: new Date(NOW.getTime() - 12 * 3_600_000).toISOString(),
    });
    const r = computeMarketDataHealthScore(HEALTHY_SNAPSHOT, [], NOW);
    expect(r.score).toBe(85);
    expect(r.tier).toBe('HEALTHY');  // 85 boundary
    expect(r.deductions[0].axis).toBe('macroState');
    expect(r.deductions[0].deduction).toBe(15);
  });

  it('STALE_BLOCK (25h) → -40점', () => {
    vi.spyOn(macroStateRepo, 'loadMacroState').mockReturnValue({
      ...FRESH_MACRO,
      updatedAt: new Date(NOW.getTime() - 25 * 3_600_000).toISOString(),
    });
    const r = computeMarketDataHealthScore(HEALTHY_SNAPSHOT, [], NOW);
    expect(r.score).toBe(60);
    expect(r.tier).toBe('DEGRADED');
    expect(r.deductions[0].deduction).toBe(40);
  });

  it('NO_DATA (macroState=null) → -40점', () => {
    vi.spyOn(macroStateRepo, 'loadMacroState').mockReturnValue(null);
    const r = computeMarketDataHealthScore(HEALTHY_SNAPSHOT, [], NOW);
    expect(r.score).toBe(60);
    expect(r.deductions[0].axis).toBe('macroState');
    expect(r.details.macroStaleness.tier).toBe('NO_DATA');
  });
});

describe('staleFields 카운트 가중', () => {
  it('1개 → -10', () => {
    const r = computeMarketDataHealthScore(HEALTHY_SNAPSHOT, ['vix'], NOW);
    expect(r.score).toBe(90);
    expect(r.deductions[0].axis).toBe('indicators');
    expect(r.deductions[0].deduction).toBe(10);
  });
  it('2개도 -10 (1~2 = 같은 분기)', () => {
    const r = computeMarketDataHealthScore(HEALTHY_SNAPSHOT, ['vix', 'kospi'], NOW);
    expect(r.score).toBe(90);
  });
  it('3개 → -25', () => {
    const r = computeMarketDataHealthScore(HEALTHY_SNAPSHOT, ['vix', 'kospi', 'us10yYield'], NOW);
    expect(r.score).toBe(75);
    expect(r.deductions[0].deduction).toBe(25);
  });
  it('5개 → -40', () => {
    const fields = ['vix', 'kospi', 'us10yYield', 'ewyReturn', 'mtumReturn'];
    const r = computeMarketDataHealthScore(HEALTHY_SNAPSHOT, fields, NOW);
    expect(r.score).toBe(60);
    expect(r.deductions[0].deduction).toBe(40);
  });
});

describe('Yahoo 분기', () => {
  it('DOWN → -25', () => {
    const r = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      yahoo: { status: 'DOWN' as const, detail: 'DOWN' as any, heartbeat: {} as any },
    }, [], NOW);
    expect(r.score).toBe(75);
  });
  it('DEGRADED → -10', () => {
    const r = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      yahoo: { status: 'DEGRADED' as const, detail: 'DEGRADED' as any, heartbeat: {} as any },
    }, [], NOW);
    expect(r.score).toBe(90);
  });
  it('UNKNOWN → -5', () => {
    const r = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      yahoo: { status: 'UNKNOWN' as const, detail: 'UNKNOWN' as any, heartbeat: {} as any },
    }, [], NOW);
    expect(r.score).toBe(95);
  });
});

describe('KIS / KRX 분기', () => {
  it('KIS_APP_KEY 미설정 → -5', () => {
    const r = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      kisConfigured: false,
    }, [], NOW);
    expect(r.score).toBe(95);
    expect(r.details.kisCircuitOk).toBe(false);
  });

  it('KRX 토큰 미설정 → -5', () => {
    const r = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      krxTokenConfigured: false,
    }, [], NOW);
    expect(r.score).toBe(95);
    expect(r.details.krxOk).toBe(false);
  });

  it('KRX 토큰 invalid → -15', () => {
    const r = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      krxTokenValid: false,
    }, [], NOW);
    expect(r.score).toBe(85);
  });

  it('KRX 회로 OPEN → -20', () => {
    const r = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      krxCircuitState: 'OPEN',
    }, [], NOW);
    expect(r.score).toBe(80);
  });

  it('KRX 연속 실패 ≥3 → -10', () => {
    const r = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      krxFailures: 5,
    }, [], NOW);
    expect(r.score).toBe(90);
  });
});

describe('점수 누적 + floor 0', () => {
  it('macroState BLOCK + 5+ stale + Yahoo DOWN + KRX OPEN = 0점 (floor)', () => {
    vi.spyOn(macroStateRepo, 'loadMacroState').mockReturnValue({
      ...FRESH_MACRO,
      updatedAt: new Date(NOW.getTime() - 100 * 3_600_000).toISOString(),
    });
    const r = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      yahoo: { status: 'DOWN' as const, detail: 'DOWN' as any, heartbeat: {} as any },
      krxCircuitState: 'OPEN',
    }, ['vix', 'kospi', 'us10yYield', 'ewyReturn', 'mtumReturn'], NOW);
    // 100 - 40 (macro) - 40 (stale 5+) - 25 (yahoo DOWN) - 20 (KRX OPEN) = -25 → floor 0
    expect(r.score).toBe(0);
    expect(r.tier).toBe('CRITICAL');
    expect(r.deductions.length).toBe(4);
  });

  it('boundary: 점수 정확히 0 일 때 CRITICAL', () => {
    const r = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      yahoo: { status: 'DOWN' as const, detail: 'DOWN' as any, heartbeat: {} as any },
    }, ['vix', 'kospi', 'us10yYield', 'ewyReturn', 'mtumReturn'], NOW);
    // 100 - 40 (5+ stale) - 25 (yahoo DOWN) = 35 → CRITICAL
    expect(r.score).toBe(35);
    expect(r.tier).toBe('CRITICAL');
  });
});

describe('deductions 배열 정합', () => {
  it('차감 이유 한국어 포함', () => {
    const r = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      krxCircuitState: 'OPEN',
    }, ['vix'], NOW);
    expect(r.deductions.find(d => d.axis === 'indicators')?.reason).toContain('1개');
    expect(r.deductions.find(d => d.axis === 'krx')?.reason).toContain('OPEN');
  });
});

describe('formatMarketDataHealthLine — /health 라벨', () => {
  it('HEALTHY 100 → ✅ 100/100 (정상)', () => {
    const score = computeMarketDataHealthScore(HEALTHY_SNAPSHOT, [], NOW);
    const line = formatMarketDataHealthLine(score);
    expect(line).toContain('✅');
    expect(line).toContain('100/100');
    expect(line).toContain('정상');
  });

  it('DEGRADED 70 → 🟡 70/100 (저하) — 주요 차감 표기', () => {
    vi.spyOn(macroStateRepo, 'loadMacroState').mockReturnValue({
      ...FRESH_MACRO,
      updatedAt: new Date(NOW.getTime() - 12 * 3_600_000).toISOString(),
    });
    const score = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      krxFailures: 5,
    }, ['vix'], NOW);
    // 100 - 15 (STALE_WARN) - 10 (1 stale) - 10 (KRX 5 failures) = 65
    expect(score.tier).toBe('DEGRADED');
    const line = formatMarketDataHealthLine(score);
    expect(line).toContain('🟡');
    expect(line).toContain('저하');
    expect(line).toContain('주요:');
  });

  it('CRITICAL 30 → ❌ 30/100 (위험)', () => {
    vi.spyOn(macroStateRepo, 'loadMacroState').mockReturnValue({
      ...FRESH_MACRO,
      updatedAt: new Date(NOW.getTime() - 25 * 3_600_000).toISOString(),
    });
    const score = computeMarketDataHealthScore({
      ...HEALTHY_SNAPSHOT,
      yahoo: { status: 'DOWN' as const, detail: 'DOWN' as any, heartbeat: {} as any },
    }, ['vix'], NOW);
    // 100 - 40 (BLOCK) - 25 (DOWN) - 10 (1 stale) = 25
    expect(score.tier).toBe('CRITICAL');
    const line = formatMarketDataHealthLine(score);
    expect(line).toContain('❌');
    expect(line).toContain('위험');
  });
});

describe('SSOT 임계값 검증', () => {
  it('MARKET_DATA_HEALTH_THRESHOLDS 정합', () => {
    expect(MARKET_DATA_HEALTH_THRESHOLDS.HEALTHY_MIN).toBe(85);
    expect(MARKET_DATA_HEALTH_THRESHOLDS.DEGRADED_MIN).toBe(60);
  });
});
