/**
 * @responsibility regimeBalancedSampler.evaluateRegimeCoverageSuggestion 회귀 테스트
 *
 * - ADR-0007 § 임계 충족/미달
 * - ADR-0124 (사용자 4/30 보고): shadow trade 30일 진입 카운트 합산 false positive 차단
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./suggestNotifier.js', () => ({
  sendSuggestAlert: vi.fn().mockResolvedValue(true),
}));

vi.mock('./recommendationTracker.js', () => ({
  getRecommendations: vi.fn(),
}));

vi.mock('../persistence/shadowTradeRepo.js', () => ({
  loadShadowTrades: vi.fn().mockReturnValue([]),
}));

import { sendSuggestAlert } from './suggestNotifier.js';
import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { evaluateRegimeCoverageSuggestion, REGIME_SAMPLE_TARGETS } from './regimeBalancedSampler.js';

const mockSend = sendSuggestAlert as unknown as ReturnType<typeof vi.fn>;
const mockGetRecs = getRecommendations as unknown as ReturnType<typeof vi.fn>;
const mockLoadShadow = loadShadowTrades as unknown as ReturnType<typeof vi.fn>;

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
    mockLoadShadow.mockReset();
    mockLoadShadow.mockReturnValue([]);
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

  // ─── ADR-0124 사용자 4/30 false positive 차단 ────────────────────────────────

  it('ADR-0124: 부족 레짐 + recommendation 0건 + shadow trade 30일 진입 1건 → no-op (false positive 차단)', async () => {
    // R6_DEFENSE 충족 미달 + 30일 dry on recommendations
    const entries: RecommendationRecord[] = [];
    for (const [regime, target] of Object.entries(REGIME_SAMPLE_TARGETS)) {
      if (regime === 'R6_DEFENSE') continue;
      for (let i = 0; i < target; i++) entries.push(mkRec(regime, '2026-04-20T00:00:00Z'));
    }
    for (let i = 0; i < 3; i++) entries.push(mkRec('R6_DEFENSE', '2026-02-20T00:00:00Z'));
    mockGetRecs.mockReturnValue(entries);

    // shadow trade — R6_DEFENSE 진입 1건 (최근 5일 내)
    mockLoadShadow.mockReturnValue([
      { stockCode: '000001', signalTime: '2026-04-20T00:00:00Z', entryRegime: 'R6_DEFENSE' },
    ]);

    const ok = await evaluateRegimeCoverageSuggestion(new Date('2026-04-24T00:00:00Z'));
    expect(ok).toBe(false); // shadow 진입 카운트 ≥ 1 → dry 조건 미달
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('ADR-0124: rationale 메시지에 추천/실거래 카운트 분리 표기', async () => {
    const entries: RecommendationRecord[] = [];
    for (const [regime, target] of Object.entries(REGIME_SAMPLE_TARGETS)) {
      if (regime === 'R6_DEFENSE') continue;
      for (let i = 0; i < target; i++) entries.push(mkRec(regime, '2026-04-20T00:00:00Z'));
    }
    for (let i = 0; i < 3; i++) entries.push(mkRec('R6_DEFENSE', '2026-02-20T00:00:00Z'));
    mockGetRecs.mockReturnValue(entries);
    mockLoadShadow.mockReturnValue([]); // shadow 진입 0건 — dry 충족

    const ok = await evaluateRegimeCoverageSuggestion(new Date('2026-04-24T00:00:00Z'));
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0];
    // ADR-0124: "추천 X건 + 실거래 Y건" 형식 명시
    expect(payload.rationale).toContain('추천 0건');
    expect(payload.rationale).toContain('실거래 0건');
  });

  it('ADR-0124: ENV LEARNING_REGIME_COVERAGE_SUGGEST_DISABLED=true → 즉시 false 반환', async () => {
    const original = process.env.LEARNING_REGIME_COVERAGE_SUGGEST_DISABLED;
    process.env.LEARNING_REGIME_COVERAGE_SUGGEST_DISABLED = 'true';
    try {
      const entries: RecommendationRecord[] = [];
      for (const [regime, target] of Object.entries(REGIME_SAMPLE_TARGETS)) {
        if (regime === 'R6_DEFENSE') continue;
        for (let i = 0; i < target; i++) entries.push(mkRec(regime, '2026-04-20T00:00:00Z'));
      }
      mockGetRecs.mockReturnValue(entries);

      const ok = await evaluateRegimeCoverageSuggestion(new Date('2026-04-24T00:00:00Z'));
      expect(ok).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
      // ENV 우회 시 history/shadow read 자체 안 함 (early return)
      expect(mockGetRecs).not.toHaveBeenCalled();
      expect(mockLoadShadow).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.LEARNING_REGIME_COVERAGE_SUGGEST_DISABLED;
      else process.env.LEARNING_REGIME_COVERAGE_SUGGEST_DISABLED = original;
    }
  });

  it('ADR-0124: loadShadowTrades throw → graceful fallback (recommendation 만 사용)', async () => {
    const entries: RecommendationRecord[] = [];
    for (const [regime, target] of Object.entries(REGIME_SAMPLE_TARGETS)) {
      if (regime === 'R6_DEFENSE') continue;
      for (let i = 0; i < target; i++) entries.push(mkRec(regime, '2026-04-20T00:00:00Z'));
    }
    for (let i = 0; i < 3; i++) entries.push(mkRec('R6_DEFENSE', '2026-02-20T00:00:00Z'));
    mockGetRecs.mockReturnValue(entries);
    mockLoadShadow.mockImplementation(() => {
      throw new Error('영속 손상');
    });

    const ok = await evaluateRegimeCoverageSuggestion(new Date('2026-04-24T00:00:00Z'));
    // throw 흡수 → 빈 배열로 처리 → recommendation 만으로 dry 판정 (정상 동작)
    expect(ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('ADR-0124: 사용자 보고 시나리오 — R2_BULL recommendation 0건 + shadow 진입 다수 → 발송 차단', async () => {
    // 사용자 4/30 텔레그램 시나리오 재현:
    // "R2_BULL 0/30 (0%) · 최근 30일 진입 0건" 메시지 발송 — but 실제 SHADOW 진입 발생
    const entries: RecommendationRecord[] = [];
    for (const [regime, target] of Object.entries(REGIME_SAMPLE_TARGETS)) {
      if (regime === 'R2_BULL') continue;
      for (let i = 0; i < target; i++) entries.push(mkRec(regime, '2026-04-20T00:00:00Z'));
    }
    // R2_BULL recommendation 0건 (사용자 시나리오 정합)
    mockGetRecs.mockReturnValue(entries);

    // 하지만 SHADOW 진입은 5건 발생 (사용자 보고 — "실제 진입이 발생했는데도")
    mockLoadShadow.mockReturnValue([
      { stockCode: '005930', signalTime: '2026-04-20T01:00:00Z', entryRegime: 'R2_BULL' },
      { stockCode: '000660', signalTime: '2026-04-21T01:00:00Z', entryRegime: 'R2_BULL' },
      { stockCode: '035420', signalTime: '2026-04-22T01:00:00Z', entryRegime: 'R2_BULL' },
      { stockCode: '247540', signalTime: '2026-04-23T01:00:00Z', entryRegime: 'R2_BULL' },
      { stockCode: '105560', signalTime: '2026-04-23T02:00:00Z', entryRegime: 'R2_BULL' },
    ]);

    const ok = await evaluateRegimeCoverageSuggestion(new Date('2026-04-24T00:00:00Z'));
    // 핵심: shadow 진입 5건이 dry 조건 미달시킴 → 발송 차단
    expect(ok).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
