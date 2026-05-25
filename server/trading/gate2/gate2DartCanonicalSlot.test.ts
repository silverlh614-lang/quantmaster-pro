import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Gate2DartEvaluationFinancials } from './gate2ExternalDataProvider/types.js';
import type { SymbolDartFinancialsSlot } from '../sourceSnapshot/symbolSnapshotData.js';

// ─── mocks ───────────────────────────────────────────────────────────────────
// cache record lookup (cacheHit 판정용) — read-only.
const getGate2ExternalCacheRecord = vi.fn();
vi.mock('./gate2ExternalCache.js', () => ({
  getGate2ExternalCacheRecord: (symbol: string) => getGate2ExternalCacheRecord(symbol),
}));

// cache-first 단일 통로 — 동적 import 로 위임됨. 호출 횟수로 quota(신규 외부호출) 무회귀 검증.
const getGate2DartFinancialsForEvaluation = vi.fn();
vi.mock('./gate2ExternalDataProvider.js', () => ({
  getGate2DartFinancialsForEvaluation: (symbol: string) =>
    getGate2DartFinancialsForEvaluation(symbol),
}));

const SAMPLE_FIN = {
  symbol: '005930',
  roe: 12.5,
  opm: 18.2,
  ocfRatio: 1.4,
  netIncome: 100_000,
} as unknown as Gate2DartEvaluationFinancials;

function cacheHitRecord() {
  return {
    projection: { financialSnapshot: { confidence: 'VERIFIED' } },
  };
}

describe('ADR-0529 gate2DartCanonicalSlot — slot build (collector cache-first 위임)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
  });
  afterEach(() => {
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
  });

  it('cache HIT 시 cacheHit=true / source=GATE2_EXTERNAL_CACHE / cadence=QUARTERLY_CACHED 슬롯 (외부호출 위임은 1회, 신규 quota 0)', async () => {
    getGate2ExternalCacheRecord.mockReturnValue(cacheHitRecord());
    getGate2DartFinancialsForEvaluation.mockResolvedValue(SAMPLE_FIN);
    const { buildSymbolDartFinancialsSlot } = await import('./gate2DartCanonicalSlot.js');

    const slot = await buildSymbolDartFinancialsSlot('005930');

    expect(slot.cacheHit).toBe(true);
    expect(slot.source).toBe('GATE2_EXTERNAL_CACHE');
    expect(slot.cadence).toBe('QUARTERLY_CACHED');
    expect(slot.financials).toBe(SAMPLE_FIN);
    // cache-first 단일 통로만 위임 — 슬롯 build 가 별도 fetch 로직을 신설하지 않음.
    expect(getGate2DartFinancialsForEvaluation).toHaveBeenCalledTimes(1);
  });

  it('cache MISS 시 cacheHit=false / source=DART (기존 함수 내부 ≤1 fetch — 기존과 동일)', async () => {
    getGate2ExternalCacheRecord.mockReturnValue(null);
    getGate2DartFinancialsForEvaluation.mockResolvedValue(SAMPLE_FIN);
    const { buildSymbolDartFinancialsSlot } = await import('./gate2DartCanonicalSlot.js');

    const slot = await buildSymbolDartFinancialsSlot('005930');

    expect(slot.cacheHit).toBe(false);
    expect(slot.source).toBe('DART');
    expect(slot.cadence).toBe('QUARTERLY_CACHED');
    expect(slot.financials).toBe(SAMPLE_FIN);
  });

  it('DART 부재(null) 시 cadence=MISSING 슬롯 (실패 경로 — read site fallback)', async () => {
    getGate2ExternalCacheRecord.mockReturnValue(null);
    getGate2DartFinancialsForEvaluation.mockResolvedValue(null);
    const { buildSymbolDartFinancialsSlot } = await import('./gate2DartCanonicalSlot.js');

    const slot = await buildSymbolDartFinancialsSlot('005930');

    expect(slot.financials).toBeNull();
    expect(slot.cadence).toBe('MISSING');
    expect(slot.source).toBe('NONE');
    expect(slot.cacheHit).toBe(false);
  });
});

describe('ADR-0529 gate2DartCanonicalSlot — read-site resolve (byte-equivalent)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
  });
  afterEach(() => {
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
  });

  function slotOf(fin: Gate2DartEvaluationFinancials | null): SymbolDartFinancialsSlot {
    return {
      financials: fin,
      cadence: fin ? 'QUARTERLY_CACHED' : 'MISSING',
      source: fin ? 'GATE2_EXTERNAL_CACHE' : 'NONE',
      cacheHit: Boolean(fin),
      fetchedAt: new Date().toISOString(),
    };
  }

  it('flag ON + 슬롯 non-null → 슬롯 financials 사용 (외부호출 0). 같은 데이터가 fallback 경로와 deep-equal (byte-equivalent)', async () => {
    process.env.USE_UNIFIED_SOURCE_SNAPSHOT = 'true';
    getGate2DartFinancialsForEvaluation.mockResolvedValue(SAMPLE_FIN);
    const { resolveDartFinancialsForEvaluation } = await import('./gate2DartCanonicalSlot.js');

    const fromSlot = await resolveDartFinancialsForEvaluation('005930', slotOf(SAMPLE_FIN));
    // 슬롯 경로는 cache-first 함수를 호출하지 않는다 (외부호출 0).
    expect(getGate2DartFinancialsForEvaluation).not.toHaveBeenCalled();

    const fromFallback = await resolveDartFinancialsForEvaluation('005930', null);
    // 동일 데이터 출처(슬롯의 financials 는 동일 함수가 채운 값) → deep-equal.
    expect(fromSlot).toEqual(fromFallback);
  });

  it('flag OFF → 슬롯 있어도 무시하고 기존 cache-first 경로 fallback (회귀 0)', async () => {
    delete process.env.USE_UNIFIED_SOURCE_SNAPSHOT;
    getGate2DartFinancialsForEvaluation.mockResolvedValue(SAMPLE_FIN);
    const { resolveDartFinancialsForEvaluation } = await import('./gate2DartCanonicalSlot.js');

    const out = await resolveDartFinancialsForEvaluation('005930', slotOf(SAMPLE_FIN));

    expect(out).toBe(SAMPLE_FIN);
    expect(getGate2DartFinancialsForEvaluation).toHaveBeenCalledTimes(1);
  });

  it('flag ON + 슬롯 부재(undefined) → 기존 경로 fallback (cold-start 회귀 0)', async () => {
    process.env.USE_UNIFIED_SOURCE_SNAPSHOT = 'true';
    getGate2DartFinancialsForEvaluation.mockResolvedValue(SAMPLE_FIN);
    const { resolveDartFinancialsForEvaluation } = await import('./gate2DartCanonicalSlot.js');

    const out = await resolveDartFinancialsForEvaluation('005930');

    expect(out).toBe(SAMPLE_FIN);
    expect(getGate2DartFinancialsForEvaluation).toHaveBeenCalledTimes(1);
  });

  it('flag ON + 슬롯 financials=null(MISSING) → 기존 경로 fallback (회귀 0)', async () => {
    process.env.USE_UNIFIED_SOURCE_SNAPSHOT = 'true';
    getGate2DartFinancialsForEvaluation.mockResolvedValue(SAMPLE_FIN);
    const { resolveDartFinancialsForEvaluation } = await import('./gate2DartCanonicalSlot.js');

    const out = await resolveDartFinancialsForEvaluation('005930', slotOf(null));

    expect(out).toBe(SAMPLE_FIN);
    expect(getGate2DartFinancialsForEvaluation).toHaveBeenCalledTimes(1);
  });
});
