/**
 * @responsibility regimeBalancedSampler.evaluateRegimeCoverageSuggestion 회귀 테스트 — ADR-0007 § 임계 충족/미달.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./suggestNotifier.js', () => ({
  sendSuggestAlert: vi.fn().mockResolvedValue(true),
}));

vi.mock('./recommendationTracker.js', () => ({
  getRecommendations: vi.fn(),
}));

import { sendSuggestAlert } from './suggestNotifier.js';
import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';
import { evaluateRegimeCoverageSuggestion, REGIME_SAMPLE_TARGETS } from './regimeBalancedSampler.js';

const mockSend = sendSuggestAlert as unknown as ReturnType<typeof vi.fn>;
const mockGetRecs = getRecommendations as unknown as ReturnType<typeof vi.fn>;

function mkRec(regime: string, signalTimeIso: string): RecommendationRecord {
  return {
    id: Math.random().toString(),
    stockCode: '000000',
    stockName: 't',
    signalTime: signalTimeIso,
    priceAtRecommend: 10_000,
    stopLoss: 9_500,
    targetPrice: 12_000,
    kellyPct: 5,
    gateScore: 9,
    signalType: 'BUY',
    status: 'WIN',
    entryRegime: regime,
  } as RecommendationRecord;
}

describe('evaluateRegimeCoverageSuggestion', () => {
  beforeEach(() => {
    mockSend.mockClear();
    mockGetRecs.mockReset();
  });

  it('모든 레짐이 목표의 50% 이상 → no-op', async () => {
    const entries: RecommendationRecord[] = [];
    for (const [regime, target] of Object.entries(REGIME_SAMPLE_TARGETS)) {
      for (let i = 0; i < target; i++) {
        entries.push(mkRec(regime, '2026-04-20T00:00:00Z'));
      }
    }
    mockGetRecs.mockReturnValue(entries);
    const ok = await evaluateRegimeCoverageSuggestion(new Date('2026-04-24T00:00:00Z'));
    expect(ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('R6_DEFENSE 50% 미만 + 최근 30일 진입 0건 → suggest 1회', async () => {
    const entries: RecommendationRecord[] = [];
    // 충족 레짐들
    for (const [regime, target] of Object.entries(REGIME_SAMPLE_TARGETS)) {
      if (regime === 'R6_DEFENSE') continue;
      for (let i = 0; i < target; i++) {
        entries.push(mkRec(regime, '2026-04-20T00:00:00Z'));
      }
    }
    // R6_DEFENSE 는 target 의 20% 만 + 전부 오래된 데이터 (60일 전)
    const r6Target = REGIME_SAMPLE_TARGETS.R6_DEFENSE;
    for (let i = 0; i < Math.floor(r6Target * 0.2); i++) {
      entries.push(mkRec('R6_DEFENSE', '2026-02-20T00:00:00Z'));
    }
    mockGetRecs.mockReturnValue(entries);

    const ok = await evaluateRegimeCoverageSuggestion(new Date('2026-04-24T00:00:00Z'));
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0];
    expect(payload.moduleKey).toBe('regimeCoverage');
    expect(payload.signature).toContain('R6_DEFENSE');
  });

  it('부족 레짐이지만 최근 30일 내 진입 기록이 있으면 → no-op (dry 조건 미달)', async () => {
    const entries: RecommendationRecord[] = [];
    for (const [regime, target] of Object.entries(REGIME_SAMPLE_TARGETS)) {
      if (regime === 'R1_TURBO') continue;
      for (let i = 0; i < target; i++) {
        entries.push(mkRec(regime, '2026-04-20T00:00:00Z'));
      }
    }
    // R1_TURBO 목표 대비 20% 만, 단 최근 5일 내 진입 1건 — dry 미달
    entries.push(mkRec('R1_TURBO', '2026-04-20T00:00:00Z'));
    mockGetRecs.mockReturnValue(entries);

    const ok = await evaluateRegimeCoverageSuggestion(new Date('2026-04-24T00:00:00Z'));
    expect(ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
