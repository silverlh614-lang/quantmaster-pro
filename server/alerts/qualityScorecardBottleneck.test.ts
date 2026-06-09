// @responsibility detectBottleneckStages 회귀 — 추세 상대 병목 감지(7일 평균 대비 급락).
import { describe, it, expect, vi } from 'vitest';

vi.mock('./telegramClient.js', () => ({ sendTelegramAlert: vi.fn() }));
vi.mock('../clients/geminiClient.js', () => ({ callGemini: vi.fn() }));
vi.mock('../persistence/shadowTradeRepo.js', () => ({ loadShadowTrades: vi.fn(() => []) }));
vi.mock('../persistence/watchlistRepo.js', () => ({ loadWatchlist: vi.fn(() => []) }));
vi.mock('../persistence/macroStateRepo.js', () => ({ loadMacroState: vi.fn(() => null) }));
vi.mock('../trading/scanTracer.js', () => ({
  loadTodayScanTraces: vi.fn(() => []),
  summarizeScanTraces: vi.fn(() => ({
    totalCandidates: 0,
    yahooFail: 0,
    gateFail: 0,
    priceFail: 0,
    rrrFail: 0,
    buyExecuted: 0,
  })),
}));
vi.mock('./reportGenerator.js', () => ({
  collectTodayBuyEvents: vi.fn(() => []),
  collectTodayRealizations: vi.fn(() => []),
  summarizeTodayBuyEvents: vi.fn(() => ({ totalBuys: 0 })),
  summarizeTodayRealizations: vi.fn(() => ({ wins: 0, losses: 0, realizationCount: 0 })),
}));

import { detectBottleneckStages, type StageYieldSnapshot } from './qualityScorecard.js';

const stage = (o: Partial<StageYieldSnapshot> & { label: string }): StageYieldSnapshot => ({
  today: 0,
  avg7: 0,
  hasSample: true,
  absoluteFloor: 10,
  hint: 'x',
  ...o,
});

describe('detectBottleneckStages — 추세 상대 병목 감지', () => {
  it('2026-06-09 리포트 시나리오 — Gate 급락은 발화, Signal 호조는 미발화', () => {
    // 실제 리포트: Gate 13.5%/평소 44.6% (붕괴), Signal 6.3%/평소 2.3% (2.7배 호조)
    const out = detectBottleneckStages([
      stage({ label: 'Discovery', today: 11.8, avg7: 16.9, absoluteFloor: 5 }),
      stage({ label: 'Gate', today: 13.5, avg7: 44.6, absoluteFloor: 20 }),
      stage({ label: 'Signal', today: 6.3, avg7: 2.3, absoluteFloor: 10 }),
      stage({ label: 'Trade', today: 100, avg7: 33.3, absoluteFloor: 30 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('Gate 13.5%');
    expect(out[0]).toContain('평소 44.6% 대비 급락');
    expect(out.join(' ')).not.toContain('Signal'); // 오진 회귀 방지 (핵심)
  });

  it('평균 이상 단계는 절대값이 낮아도 발화하지 않는다', () => {
    expect(detectBottleneckStages([stage({ label: 'Signal', today: 6.3, avg7: 2.3 })])).toEqual([]);
  });

  it('평균 대비 40%+ 급락 시 발화한다 (RELATIVE_FLOOR 0.6)', () => {
    // 50% → 25% = 0.5배 (< 0.6), 25%p 하락
    expect(detectBottleneckStages([stage({ label: 'Gate', today: 25, avg7: 50 })])).toHaveLength(1);
    // 50% → 35% = 0.7배 (> 0.6) → 경계 내, 미발화
    expect(detectBottleneckStages([stage({ label: 'Gate', today: 35, avg7: 50 })])).toEqual([]);
  });

  it('저베이스 단계의 미세 하락은 MIN_DROP_PP(2%p)로 차단한다', () => {
    // 2.3% → 1.0% = 0.43배(급락 비율 충족)이나 하락폭 1.3%p < 2%p → 미발화
    expect(detectBottleneckStages([stage({ label: 'Signal', today: 1.0, avg7: 2.3 })])).toEqual([]);
    // 5.0% → 0.5% = 4.5%p 하락 → 발화
    expect(detectBottleneckStages([stage({ label: 'Signal', today: 0.5, avg7: 5.0 })])).toHaveLength(1);
  });

  it('부트스트랩(avg7=0) — 절대 바닥값으로 폴백한다', () => {
    // 이력 부재 시 today < absoluteFloor 면 힌트와 함께 발화
    const out = detectBottleneckStages([
      stage({ label: 'Gate', today: 12, avg7: 0, absoluteFloor: 20, hint: 'Gate 조건 과다?' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('Gate 12%');
    expect(out[0]).toContain('Gate 조건 과다?');
    // 바닥값 이상이면 미발화
    expect(
      detectBottleneckStages([stage({ label: 'Gate', today: 25, avg7: 0, absoluteFloor: 20 })]),
    ).toEqual([]);
  });

  it('표본 부족(hasSample=false) 단계는 평가하지 않는다', () => {
    expect(
      detectBottleneckStages([stage({ label: 'Signal', today: 0, avg7: 50, hasSample: false })]),
    ).toEqual([]);
  });
});
