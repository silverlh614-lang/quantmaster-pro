// @responsibility ADR-0107 — formatGateZeroContext 회귀 (Gate 0개 평가 시 차단 사유 분기).
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
    quoteFail: 0,
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

import { formatGateZeroContext } from './qualityScorecard.js';

describe('formatGateZeroContext — Gate 0개 평가 차단 사유 분기 (ADR-0107)', () => {
  it('macro=null → macroState 부재 안내', () => {
    expect(formatGateZeroContext(null)).toBe('ℹ️ 평가 도달 0건 — macroState 부재');
  });

  it('bearDefenseMode=true → 🛑 R6_DEFENSE 차단 안내', () => {
    expect(formatGateZeroContext({ bearDefenseMode: true })).toBe(
      '🛑 Bear 방어 모드 — Gate 평가 차단 (R6_DEFENSE)',
    );
  });

  it('mhs < 30 → 🛑 매수중단 임계 안내', () => {
    expect(formatGateZeroContext({ mhs: 25 })).toBe(
      '🛑 MHS 25 (매수중단 임계 30 미만) — Gate 평가 차단',
    );
  });

  it('mhs = 30 boundary → 통과 (일반 안내)', () => {
    const result = formatGateZeroContext({ mhs: 30 });
    expect(result).toContain('운영자 진단 필요');
    expect(result).not.toContain('매수중단');
  });

  it('regime=RED → 🟠 매크로 RED 차단 안내', () => {
    expect(formatGateZeroContext({ regime: 'RED' })).toBe('🟠 매크로 RED — Gate 평가 차단');
  });

  it('정상 GREEN regime + mhs 70 → 일반 안내 (FOMC/VIX 게이팅 또는 cron 점검)', () => {
    expect(formatGateZeroContext({ regime: 'GREEN', mhs: 70 })).toBe(
      'ℹ️ 평가 도달 0건 — 운영자 진단 필요 (FOMC/VIX 게이팅 또는 스캔 cron 점검)',
    );
  });

  it('우선순위 — bearDefense > mhs<30 > regime=RED', () => {
    expect(
      formatGateZeroContext({ bearDefenseMode: true, mhs: 25, regime: 'RED' }),
    ).toBe('🛑 Bear 방어 모드 — Gate 평가 차단 (R6_DEFENSE)');
  });
});
