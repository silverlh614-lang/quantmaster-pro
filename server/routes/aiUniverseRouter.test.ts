/**
 * @responsibility aiUniverseRouter 핵심 헬퍼 회귀 테스트 — PR-25-B, ADR-0011
 */
import { describe, it, expect } from 'vitest';
import { formatMarketCapKr } from './aiUniverseRouter.js';

describe('aiUniverseRouter — formatMarketCapKr (PR-25-B)', () => {
  it('0 또는 음수는 빈 문자열', () => {
    expect(formatMarketCapKr(0)).toBe('');
    expect(formatMarketCapKr(-1)).toBe('');
  });

  it('1억 단위 표시', () => {
    expect(formatMarketCapKr(1_0000_0000)).toBe('1억');
    expect(formatMarketCapKr(123_0000_0000)).toBe('123억');
  });

  it('1조 단위 — 나머지 0 이면 조만 표시', () => {
    expect(formatMarketCapKr(1_0000_0000_0000)).toBe('1조');
    expect(formatMarketCapKr(5_0000_0000_0000)).toBe('5조');
  });

  it('조 + 억 조합', () => {
    // 12조 3,450억 = 12 * 1조 + 3450 * 1억 = 12_3450_0000_0000
    expect(formatMarketCapKr(12_3450_0000_0000)).toBe('12조 3,450억');
  });

  it('NaN/Infinity 는 빈 문자열', () => {
    expect(formatMarketCapKr(NaN)).toBe('');
    expect(formatMarketCapKr(Infinity)).toBe('');
  });
});
