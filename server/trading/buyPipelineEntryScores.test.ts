// @responsibility buildBuyTrade entryConditionScores wiring 회귀 가드 (PR-1, ADR-0006)
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  regime: 'R2_BULL',
  profileType: 'A',
  watchlistSource: undefined,
  profitTranches: [],
  trailPct: 0.10,
};

describe('buildBuyTrade entryConditionScores wiring (PR-1, ADR-0006)', () => {
  it('p.entryConditionScores 미전달 시 trade.entryConditionScores=undefined (후방호환)', () => {
    const trade = buildBuyTrade({ ...baseParams });
    expect(trade.entryConditionScores).toBeUndefined();
  });

  it('p.entryConditionScores 빈 객체 전달 시 미영속 (학습 오염 차단)', () => {
    const trade = buildBuyTrade({ ...baseParams, entryConditionScores: {} });
    expect(trade.entryConditionScores).toBeUndefined();
  });

  it('27 키 객체 전달 시 영속 — 모든 키 보존', () => {
    const scores: Record<number, number> = {};
    for (let i = 1; i <= 27; i++) scores[i] = 5;
    // ADR-0149: round-trip schema 검증 — ID 위치 임의. 의미 매핑은
    // server/learning/conditionMappingFix.test.ts 가 별도 검증.
    scores[9] = 7;
    scores[18] = 7;
    const trade = buildBuyTrade({ ...baseParams, entryConditionScores: scores });
    expect(trade.entryConditionScores).toBeDefined();
    expect(Object.keys(trade.entryConditionScores!)).toHaveLength(27);
    expect(trade.entryConditionScores![9]).toBe(7);
    expect(trade.entryConditionScores![18]).toBe(7);
  });

  it('단일 키만 전달해도 영속 (PRE_BREAKOUT 등 합성 라벨 호출 site 호환)', () => {
    const trade = buildBuyTrade({
      ...baseParams,
      entryConditionScores: { 9: 7 },
    });
    expect(trade.entryConditionScores).toEqual({ 9: 7 });
  });

  it('기존 필드 (entryKellySnapshot / entryATR14 / entryRegime / profileType) 영향 0', () => {
    const trade = buildBuyTrade({
      ...baseParams,
      entryATR14: 1500,
      entryConditionScores: { 9: 7 },
    });
    expect(trade.entryATR14).toBe(1500);
    expect(trade.entryRegime).toBe('R2_BULL');
    expect(trade.profileType).toBe('A');
    expect(trade.entryConditionScores).toEqual({ 9: 7 });
  });
});
