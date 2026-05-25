import { describe, it, expect } from 'vitest';
import {
  injectPerSymbolDartContext,
  readCandidateDartSlot,
  CANDIDATE_DART_SLOT_KEY,
} from './injectPerSymbolDartContext.js';
import type { SymbolSnapshotData, SymbolDartFinancialsSlot } from '../sourceSnapshot/symbolSnapshotData.js';

function slot(financials: unknown): SymbolDartFinancialsSlot {
  return {
    financials: financials as SymbolDartFinancialsSlot['financials'],
    cadence: financials ? 'QUARTERLY_CACHED' : 'MISSING',
    source: financials ? 'GATE2_EXTERNAL_CACHE' : 'NONE',
    cacheHit: Boolean(financials),
    fetchedAt: new Date().toISOString(),
  };
}

function snapshotData(map: Record<string, SymbolDartFinancialsSlot | null>): Record<string, SymbolSnapshotData> {
  const out: Record<string, SymbolSnapshotData> = {};
  for (const [code, s] of Object.entries(map)) {
    out[code] = { code, dartFinancials: s } as unknown as SymbolSnapshotData;
  }
  return out;
}

describe('ADR-0529 injectPerSymbolDartContext — collector 슬롯 carry (fetch 0)', () => {
  it('snapshotData 의 정본 슬롯을 후보 객체에 carry 하고 read site 가 읽을 수 있다', () => {
    const candidates = [{ code: '005930' }, { code: '000660' }];
    const { stats } = injectPerSymbolDartContext(candidates, {
      snapshotData: snapshotData({
        '005930': slot({ roe: 12 }),
        '000660': slot(null),
      }),
    });

    expect(stats.slotAttached).toBe(1);   // 005930 financials non-null
    expect(stats.slotMissing).toBe(1);    // 000660 financials null
    expect(readCandidateDartSlot(candidates[0])?.financials).toEqual({ roe: 12 });
    expect(readCandidateDartSlot(candidates[1])?.financials).toBeNull();
  });

  it('snapshotData 부재 시 no-op (carry 0) — read site 가 기존 경로 fallback (회귀 0)', () => {
    const candidates = [{ code: '005930' }];
    const { stats } = injectPerSymbolDartContext(candidates, {});

    expect(stats.slotAttached).toBe(0);
    expect(CANDIDATE_DART_SLOT_KEY in candidates[0]).toBe(false);
    expect(readCandidateDartSlot(candidates[0])).toBeNull();
  });

  it('snapshot 에 없는 종목은 슬롯 null carry → read site fallback', () => {
    const candidates = [{ code: '900000' }];
    injectPerSymbolDartContext(candidates, {
      snapshotData: snapshotData({ '005930': slot({ roe: 12 }) }),
    });

    expect(readCandidateDartSlot(candidates[0])).toBeNull();
  });

  it('미부착 객체에 readCandidateDartSlot 호출 시 null (안전)', () => {
    expect(readCandidateDartSlot(undefined)).toBeNull();
    expect(readCandidateDartSlot({})).toBeNull();
    expect(readCandidateDartSlot({ code: 'x' })).toBeNull();
  });
});
