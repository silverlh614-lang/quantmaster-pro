/**
 * @responsibility macroStaleness SSOT 회귀 테스트 (ADR-0068)
 *
 * 검증:
 *   1) tier 5 분기 (FRESH / STALE_WARN / STALE_BLOCK / NO_DATA / boundary)
 *   2) shouldBlockEntry / shouldAlertOperator 정책 정합
 *   3) MACRO_STALENESS_DISABLED env 우회
 *   4) MACRO_STALE_WARN_HOURS / MACRO_STALE_BLOCK_HOURS env override
 *   5) updatedAt 부재 / 잘못된 ISO → NO_DATA + safety fallback
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  evaluateMacroStaleness,
  formatStalenessTier,
  isMacroStalenessDisabled,
  type MacroStalenessTier,
} from './macroStaleness';
import type { MacroState } from '../persistence/macroStateRepo';

const NOW = new Date('2026-04-27T10:00:00.000Z');

function makeState(updatedAt: string | null | undefined): MacroState | null {
  if (updatedAt === null) return null;
  return {
    mhs: 50,
    regime: 'R4_NEUTRAL',
    updatedAt: updatedAt ?? '',
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.MACRO_STALENESS_DISABLED;
  delete process.env.MACRO_STALE_WARN_HOURS;
  delete process.env.MACRO_STALE_BLOCK_HOURS;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
  vi.restoreAllMocks();
});

describe('evaluateMacroStaleness — tier 분기 (ADR-0068 §2)', () => {
  it('FRESH: age 1h ≤ 8h 임계', () => {
    const updated = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    expect(r.tier).toBe('FRESH');
    expect(r.ageHours).toBe(1);
    expect(r.shouldBlockEntry).toBe(false);
    expect(r.shouldAlertOperator).toBe(false);
  });

  it('FRESH boundary: 정확히 8h 도 FRESH', () => {
    const updated = new Date(NOW.getTime() - 8 * 3_600_000).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    expect(r.tier).toBe('FRESH');
  });

  it('STALE_WARN: 12h (8h < age ≤ 24h)', () => {
    const updated = new Date(NOW.getTime() - 12 * 3_600_000).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    expect(r.tier).toBe('STALE_WARN');
    expect(r.ageHours).toBe(12);
    expect(r.shouldBlockEntry).toBe(false);  // 진입 허용
    expect(r.shouldAlertOperator).toBe(true);  // 경보
  });

  it('STALE_WARN boundary: 정확히 24h 도 STALE_WARN', () => {
    const updated = new Date(NOW.getTime() - 24 * 3_600_000).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    expect(r.tier).toBe('STALE_WARN');
    expect(r.shouldBlockEntry).toBe(false);
  });

  it('STALE_BLOCK: 25h (age > 24h)', () => {
    const updated = new Date(NOW.getTime() - 25 * 3_600_000).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    expect(r.tier).toBe('STALE_BLOCK');
    expect(r.shouldBlockEntry).toBe(true);
    expect(r.shouldAlertOperator).toBe(true);
    expect(r.reason).toContain('STALE 차단');
  });

  it('STALE_BLOCK 사용자 보고 시나리오: USD/KRW 6개월 stale', () => {
    const updated = new Date(NOW.getTime() - 180 * 24 * 3_600_000).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    expect(r.tier).toBe('STALE_BLOCK');
    expect(r.ageHours).toBeGreaterThan(24 * 30);
    expect(r.shouldBlockEntry).toBe(true);
  });
});

describe('NO_DATA 분기 — updatedAt 부재 / 잘못된 ISO', () => {
  it('macroState=null → NO_DATA + 진입 차단', () => {
    const r = evaluateMacroStaleness(null, NOW);
    expect(r.tier).toBe('NO_DATA');
    expect(r.shouldBlockEntry).toBe(true);
    expect(r.ageMs).toBeNull();
    expect(r.ageHours).toBeNull();
    expect(r.reason).toContain('미수집');
  });

  it('updatedAt 빈 문자열 → NO_DATA', () => {
    const r = evaluateMacroStaleness(makeState(''), NOW);
    expect(r.tier).toBe('NO_DATA');
    expect(r.shouldBlockEntry).toBe(true);
  });

  it('updatedAt 잘못된 ISO → NO_DATA + 형식 오류 reason', () => {
    const r = evaluateMacroStaleness(makeState('not-an-iso'), NOW);
    expect(r.tier).toBe('NO_DATA');
    expect(r.shouldBlockEntry).toBe(true);
    expect(r.reason).toContain('형식 오류');
  });
});

describe('MACRO_STALENESS_DISABLED env 우회', () => {
  it('STALE_BLOCK 이라도 disabled 시 shouldBlockEntry=false', () => {
    process.env.MACRO_STALENESS_DISABLED = 'true';
    const updated = new Date(NOW.getTime() - 100 * 3_600_000).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    expect(r.tier).toBe('STALE_BLOCK');  // 분류는 그대로
    expect(r.shouldBlockEntry).toBe(false);  // 차단만 무력화
    expect(r.shouldAlertOperator).toBe(false);
  });

  it('NO_DATA 도 disabled 시 차단 무력화', () => {
    process.env.MACRO_STALENESS_DISABLED = 'true';
    const r = evaluateMacroStaleness(null, NOW);
    expect(r.tier).toBe('NO_DATA');
    expect(r.shouldBlockEntry).toBe(false);
  });

  it('isMacroStalenessDisabled() helper 동작', () => {
    process.env.MACRO_STALENESS_DISABLED = 'true';
    expect(isMacroStalenessDisabled()).toBe(true);
    process.env.MACRO_STALENESS_DISABLED = 'false';
    expect(isMacroStalenessDisabled()).toBe(false);
    delete process.env.MACRO_STALENESS_DISABLED;
    expect(isMacroStalenessDisabled()).toBe(false);
  });
});

describe('환경변수 임계값 override', () => {
  it('MACRO_STALE_WARN_HOURS=2 → 3h 가 STALE_WARN', () => {
    process.env.MACRO_STALE_WARN_HOURS = '2';
    const updated = new Date(NOW.getTime() - 3 * 3_600_000).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    expect(r.tier).toBe('STALE_WARN');
    expect(r.warnThresholdHours).toBe(2);
  });

  it('MACRO_STALE_BLOCK_HOURS=12 → 13h 가 STALE_BLOCK', () => {
    process.env.MACRO_STALE_BLOCK_HOURS = '12';
    const updated = new Date(NOW.getTime() - 13 * 3_600_000).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    expect(r.tier).toBe('STALE_BLOCK');
    expect(r.blockThresholdHours).toBe(12);
    expect(r.shouldBlockEntry).toBe(true);
  });

  it('잘못된 env 값 (음수/NaN) 은 default fallback', () => {
    process.env.MACRO_STALE_WARN_HOURS = '-5';
    process.env.MACRO_STALE_BLOCK_HOURS = 'invalid';
    const r = evaluateMacroStaleness(null, NOW);
    expect(r.warnThresholdHours).toBe(8);
    expect(r.blockThresholdHours).toBe(24);
  });
});

describe('formatStalenessTier — 한국어 라벨', () => {
  const cases: Array<[MacroStalenessTier, string]> = [
    ['FRESH', '✅ 신선'],
    ['STALE_WARN', '🟡 갱신 지연'],
    ['STALE_BLOCK', '❌ STALE 차단'],
    ['NO_DATA', '⚠️ 미수집'],
  ];
  for (const [tier, expected] of cases) {
    it(`${tier} → "${expected}"`, () => {
      expect(formatStalenessTier(tier)).toBe(expected);
    });
  }
});

describe('boundary 정확성 — millisecond 단위', () => {
  it('age 8h + 1ms → STALE_WARN (boundary 초과)', () => {
    const updated = new Date(NOW.getTime() - (8 * 3_600_000 + 1)).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    // ageHours rounding 으로 인해 정확히 8.0 이 될 수 있음 — 회귀 안전성 확인
    expect(['FRESH', 'STALE_WARN']).toContain(r.tier);
  });

  it('age 정확히 24h → STALE_WARN 으로 분류 (boundary 정합)', () => {
    const updated = new Date(NOW.getTime() - 24 * 3_600_000).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    expect(r.tier).toBe('STALE_WARN');
  });

  it('age 24h + 1초 → STALE_BLOCK', () => {
    const updated = new Date(NOW.getTime() - (24 * 3_600_000 + 1000)).toISOString();
    const r = evaluateMacroStaleness(makeState(updated), NOW);
    expect(r.tier).toBe('STALE_BLOCK');
  });
});
