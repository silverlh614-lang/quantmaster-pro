// @responsibility ADR-0117 + ADR-0301 watchlistManager applyEntryPriceDrift DATA_HOLD/CORPORATE_ACTION 분기 회귀
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
    // 방금 추가된 종목(=신선한 entryPrice) 직후의 큰 drift 는 단일일 불연속(분할/권리락/데이터
    // 오염)을 모델링한다 — 한국 ±30% 일일 제한폭으로 organic 달성 불가. 본 테스트군은 그
    // 코퍼레이트 액션/DATA_HOLD 분류를 검증한다. (수 주 보유 organic 랠리 케이스는
    // watchlistManager.test.ts 의 'organic 모멘텀 랠리' describe 가 별도 검증.)
    addedAt: new Date().toISOString(),
    addedBy: 'AUTO',
    section: 'MOMENTUM',
    ...overrides,
  };
}

describe('applyEntryPriceDrift — ADR-0117 DATA_HOLD 분기', () => {
  it('drift 95% → CORPORATE_ACTION (ADR-0301: abs > 80% STRONG → SPLIT 의심)', () => {
    // ADR-0301 STRONG_DRIFT_PCT 80 — corporateActionDetector 가 abs 95% 를 SPLIT 으로
    // 분류 → applyEntryPriceDrift 가 sanity 게이트보다 먼저 CORPORATE_ACTION 반환.
    const entry = makeEntry({ entryPrice: 10000 });
    const result = applyEntryPriceDrift(entry, 19500); // +95%
    expect(result).toBe('CORPORATE_ACTION');
  });

  it('drift -95% → CORPORATE_ACTION (ADR-0301: abs > 80% — 음수도 SPLIT 의심)', () => {
    const entry = makeEntry({ entryPrice: 100000 });
    const result = applyEntryPriceDrift(entry, 5000); // -95%
    expect(result).toBe('CORPORATE_ACTION');
  });

  it('drift +260% → DATA_HOLD (ADR-0301 ABSOLUTE_DEAD_ZONE >250% — 실제 데이터 오염)', () => {
    // ABSOLUTE_DEAD_ZONE_LIMIT 250 초과 — 코퍼레이트 액션 아닌 데이터 오염 →
    // CORPORATE_ACTION 분기보다 우선 DATA_HOLD 반환.
    const entry = makeEntry({ entryPrice: 10000 });
    const result = applyEntryPriceDrift(entry, 36000); // +260%
    expect(result).toBe('DATA_HOLD');
  });

  it('drift 50% (NORMAL/WARN 영역) → REMOVE 또는 UPDATE (DATA_HOLD 아님)', () => {
    const entry = makeEntry({ entryPrice: 10000 });
    const result = applyEntryPriceDrift(entry, 15000); // +50%
    expect(result).toBe('REMOVE');
  });

  it('drift +200% → CORPORATE_ACTION (>80% STRONG, ADR-0301)', () => {
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

  it('ENV DATA_QUALITY_STRICT_DISABLED=true — 95% drift 도 CORPORATE_ACTION (sanity 게이트보다 우선)', () => {
    process.env.DATA_QUALITY_STRICT_DISABLED = 'true';
    const entry = makeEntry({ entryPrice: 10000 });
    // ADR-0301 CORPORATE_ACTION 분기가 ADR-0117 sanity 게이트보다 위 — ENV 우회와 무관하게
    // abs 95% > 80% STRONG → CORPORATE_ACTION 반환.
    const result = applyEntryPriceDrift(entry, 19500);
    expect(result).toBe('CORPORATE_ACTION');
  });

  it('ENV CORPORATE_ACTION_DETECTOR_DISABLED=true — 95% drift → DATA_HOLD (ADR-0117 sanity 게이트)', () => {
    const original = process.env.CORPORATE_ACTION_DETECTOR_DISABLED;
    process.env.CORPORATE_ACTION_DETECTOR_DISABLED = 'true';
    try {
      const entry = makeEntry({ entryPrice: 10000 });
      // detector disabled → CORPORATE_ACTION 미감지 → safePctChangeStrict 가
      // maxAbsPct 90 초과(95%) 차단 → DATA_HOLD 반환 (ADR-0117 거래 차단 게이트).
      const result = applyEntryPriceDrift(entry, 19500);
      expect(result).toBe('DATA_HOLD');
    } finally {
      if (original === undefined) delete process.env.CORPORATE_ACTION_DETECTOR_DISABLED;
      else process.env.CORPORATE_ACTION_DETECTOR_DISABLED = original;
    }
  });
});
