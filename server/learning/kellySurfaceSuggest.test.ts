import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./suggestNotifier.js', () => ({
  sendSuggestAlert: vi.fn().mockResolvedValue(true),
}));

// getRecommendations 를 직접 주입하는 API 가 없으므로, recommendationTracker 의 로더를 mock.
vi.mock('./recommendationTracker.js', () => ({
  getRecommendations: vi.fn(),
}));

import { sendSuggestAlert } from './suggestNotifier.js';
import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';
import { evaluateKellySurfaceSuggestion } from './kellySurfaceMap.js';

const mockSend = sendSuggestAlert as unknown as ReturnType<typeof vi.fn>;
const mockGetRecs = getRecommendations as unknown as ReturnType<typeof vi.fn>;

function mkRec(
  overrides: Partial<RecommendationRecord> & {
    signalType: 'STRONG_BUY' | 'BUY';
    status: 'WIN' | 'LOSS';
  },
): RecommendationRecord {
  return {
    id: Math.random().toString(),
    stockCode: '000000',
    stockName: 't',
    signalTime: '2026-01-01',
    priceAtRecommend: 10000,
    stopLoss: 9500,
    targetPrice: 12000,
    kellyPct: 5,
    gateScore: 9,
    actualReturn: 0,
    entryRegime: 'R2_BULL',
    ...overrides,
  } as RecommendationRecord;
}

describe('evaluateKellySurfaceSuggestion', () => {
  beforeEach(() => {
    mockSend.mockClear();
    mockGetRecs.mockReset();
  });

  it('currentKellyBy 비어 있으면 즉시 no-op', async () => {
    mockGetRecs.mockReturnValue([]);
    const ok = await evaluateKellySurfaceSuggestion({});
    expect(ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('샘플 < 20 → no-op', async () => {
    const recs: RecommendationRecord[] = [];
    for (let i = 0; i < 10; i++) recs.push(mkRec({ signalType: 'STRONG_BUY', status: 'WIN', actualReturn: 10 }));
    for (let i = 0; i < 5; i++) recs.push(mkRec({ signalType: 'STRONG_BUY', status: 'LOSS', actualReturn: -4 }));
    mockGetRecs.mockReturnValue(recs);

    const ok = await evaluateKellySurfaceSuggestion({ STRONG_BUY: 0.1 });
    expect(ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('샘플≥20 + CI 좁음 + |Δ|≥0.5 → suggest 1회', async () => {
    const recs: RecommendationRecord[] = [];
    // WIN 80건 · LOSS 20건 → p=0.8, b = 10/5 = 2, Kelly* = (0.8*3 - 1)/2 = 0.7
    for (let i = 0; i < 80; i++) recs.push(mkRec({ signalType: 'STRONG_BUY', status: 'WIN', actualReturn: 10 }));
    for (let i = 0; i < 20; i++) recs.push(mkRec({ signalType: 'STRONG_BUY', status: 'LOSS', actualReturn: -5 }));
    mockGetRecs.mockReturnValue(recs);

    // 현재 Kelly 0.05 → |0.7 - 0.05| = 0.65 ≥ 0.5.
    const ok = await evaluateKellySurfaceSuggestion({ STRONG_BUY: 0.05 });
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0];
    expect(payload.moduleKey).toBe('kellySurface');
    expect(payload.signature).toMatch(/^kellySurface-STRONG_BUY-R2_BULL-\d{4}-\d{2}-\d{2}$/);
  });

  it('|Δ| < 0.5 → no-op', async () => {
    const recs: RecommendationRecord[] = [];
    for (let i = 0; i < 80; i++) recs.push(mkRec({ signalType: 'STRONG_BUY', status: 'WIN', actualReturn: 10 }));
    for (let i = 0; i < 20; i++) recs.push(mkRec({ signalType: 'STRONG_BUY', status: 'LOSS', actualReturn: -5 }));
    mockGetRecs.mockReturnValue(recs);

    // 현재 Kelly 0.65 → |0.7 - 0.65| = 0.05 < 0.5.
    const ok = await evaluateKellySurfaceSuggestion({ STRONG_BUY: 0.65 });
    expect(ok).toBe(false);
  });
});
