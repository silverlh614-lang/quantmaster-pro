// @responsibility ADR-0117 watchlistManager applyEntryPriceDrift DATA_HOLD 회귀
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyEntryPriceDrift } from './watchlistManager.js';
import type { WatchlistEntry } from '../persistence/watchlistRepo.js';

const ORIGINAL_ENV = process.env.DATA_QUALITY_STRICT_DISABLED;

beforeEach(() => {
  delete process.env.DATA_QUALITY_STRICT_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.DATA_QUALITY_STRICT_DISABLED;
  else process.env.DATA_QUALITY_STRICT_DISABLED = ORIGINAL_ENV;
});

function makeEntry(overrides: Partial<WatchlistEntry>): WatchlistEntry {
  return {
    code: '098460',
    name: '고영',
    entryPrice: 12610,
    stopLoss: 12000,
    targetPrice: 14500,
    addedAt: '2026-04-30T00:00:00.000Z',
    addedBy: 'AUTO',
    section: 'MOMENTUM',
    ...overrides,
  };
}

describe('applyEntryPriceDrift — ADR-0117 DATA_HOLD 분기', () => {
  it('drift 95% (60~150% INVALID 영역) → DATA_HOLD', () => {
    // 60~150% drift — corporateActionDetector 미감지 (>150% 만 detect) →
    // safePctChangeStrict 가 sanity 위반 차단 → DATA_HOLD 반환.
    const entry = makeEntry({ entryPrice: 10000 });
    const result = applyEntryPriceDrift(entry, 19500); // +95%
    expect(result).toBe('DATA_HOLD');
  });

  it('drift -95% → DATA_HOLD', () => {
    const entry = makeEntry({ entryPrice: 100000 });
    const result = applyEntryPriceDrift(entry, 5000); // -95%
    expect(result).toBe('DATA_HOLD');
  });

  it('drift 50% (NORMAL/WARN 영역) → REMOVE 또는 UPDATE (DATA_HOLD 아님)', () => {
    const entry = makeEntry({ entryPrice: 10000 });
    const result = applyEntryPriceDrift(entry, 15000); // +50%
    expect(result).toBe('REMOVE');
  });

  it('drift +200% → CORPORATE_ACTION (>150%, ADR-0113)', () => {
    const entry = makeEntry({ entryPrice: 10000 });
    const result = applyEntryPriceDrift(entry, 30000); // +200%
    expect(result).toBe('CORPORATE_ACTION');
  });

  it('drift -100% (currentPrice=0) → KEEP (ZERO 가드 우선)', () => {
    const entry = makeEntry({ entryPrice: 10000 });
    const result = applyEntryPriceDrift(entry, 0);
    expect(result).toBe('KEEP');
  });

  it('drift 5% (정상) → KEEP', () => {
    const entry = makeEntry({ entryPrice: 10000 });
    const result = applyEntryPriceDrift(entry, 10500);
    expect(result).toBe('KEEP');
  });

  it('ENV DATA_QUALITY_STRICT_DISABLED=true — 95% drift 도 KEEP (sanity 우회)', () => {
    process.env.DATA_QUALITY_STRICT_DISABLED = 'true';
    const entry = makeEntry({ entryPrice: 10000 });
    // ENV 우회 → strict 가 ok=true 반환 → driftPct=95% → +10% 임계 통과 →
    // AUTO 라 REMOVE (정상 동작 복원)
    const result = applyEntryPriceDrift(entry, 19500);
    expect(result).toBe('REMOVE');
  });
});
