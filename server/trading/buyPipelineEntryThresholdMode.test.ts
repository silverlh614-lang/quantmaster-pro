// @responsibility ADR-0608 buildBuyTrade entryThresholdMode 스탬프 회귀 가드 — 라벨 영속 + 미전달 후방호환
import { describe, it, expect, vi } from 'vitest';

vi.mock('../persistence/incidentRepo.js', () => ({
  getLatestIncidentAt: () => null,
}));
vi.mock('../persistence/sectorMapRepo.js', () => ({
  getSectorByCode: () => '반도체',
}));

import { buildBuyTrade, type BuildBuyTradeParams } from './buyPipeline.js';

const baseParams: BuildBuyTradeParams = {
  idPrefix: 'srv_test',
  stockCode: '005930',
  stockName: '삼성전자',
  currentPrice: 100,
  shadowEntryPrice: 100,
  quantity: 10,
  stopLossPlan: { initialStopLoss: 90, regimeStopLoss: 90, hardStopLoss: 90, dynamicStopLoss: 90 } as any,
  targetPrice: 120,
  shadowMode: true,
  regime: 'R3_EARLY',
  profileType: 'A',
  watchlistSource: undefined,
  profitTranches: [],
  trailPct: 0.10,
};

describe('ADR-0608 buildBuyTrade entryThresholdMode 스탬프', () => {
  it('(4) REGIME_AWARE_SHADOW 전달 시 영속 — 표본 격리 라벨', () => {
    const trade = buildBuyTrade({ ...baseParams, entryThresholdMode: 'REGIME_AWARE_SHADOW' });
    expect(trade.entryThresholdMode).toBe('REGIME_AWARE_SHADOW');
  });

  it('(4) LEGACY 전달 시 영속', () => {
    const trade = buildBuyTrade({ ...baseParams, entryThresholdMode: 'LEGACY' });
    expect(trade.entryThresholdMode).toBe('LEGACY');
  });

  it('(5) 미전달(후방호환) → entryThresholdMode 미영속 (LEGACY 표본 동일 취급)', () => {
    const trade = buildBuyTrade({ ...baseParams });
    expect(trade.entryThresholdMode).toBeUndefined();
  });

  it('(5) undefined 명시 전달도 미영속 (스프레드 가드)', () => {
    const trade = buildBuyTrade({ ...baseParams, entryThresholdMode: undefined });
    expect(trade.entryThresholdMode).toBeUndefined();
  });

  it('라벨 스탬프가 기존 필드(mode/entryRegime/profileType) 영향 0', () => {
    const trade = buildBuyTrade({ ...baseParams, entryThresholdMode: 'REGIME_AWARE_SHADOW' });
    expect(trade.mode).toBe('SHADOW');
    expect(trade.entryRegime).toBe('R3_EARLY');
    expect(trade.profileType).toBe('A');
  });
});
