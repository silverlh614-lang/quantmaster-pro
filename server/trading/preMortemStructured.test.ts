/**
 * preMortemStructured.test.ts — Phase 3-⑫ 구조화 Pre-Mortem + 종결 매칭 회귀.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPreMortemStructured,
  matchExitInvalidation,
} from './preMortemStructured.js';
import type { ServerShadowTrade } from '../persistence/shadowTradeRepo.js';

describe('buildPreMortemStructured — 4 필드 결정론적 생성', () => {
  it('모든 필수 필드가 채워진다 (Gemini 독립)', () => {
    const pm = buildPreMortemStructured({
      entryPrice: 50_000, targetPrice: 57_500, stopLoss: 47_500,
      regime: 'R2_BULL', sector: '반도체',
      gateScore: 7.5, mtas: 8.0, atr14: 800, ma60: 48_000, avgVolume: 1_000_000,
      profileType: 'B', profitTrancheCount: 3,
    });
    expect(pm.primaryThesis).toContain('R2_BULL');
    expect(pm.primaryThesis).toContain('반도체');
    expect(pm.invalidationConditions.length).toBeGreaterThanOrEqual(4);
    expect(pm.invalidationConditions.find(c => c.id === 'HARD_STOP_HIT')).toBeTruthy();
    expect(pm.invalidationConditions.find(c => c.id === 'MA60_BREAK')).toBeTruthy();
    expect(pm.invalidationConditions.find(c => c.id === 'VOLUME_DROP')).toBeTruthy();
    expect(pm.stopLossTrigger.hardStop).toBe(47_500);
    expect(pm.stopLossTrigger.regime).toBe('R2_BULL');
    expect(pm.targetScenario.targetPrice).toBe(57_500);
    expect(pm.targetScenario.rrr).toBeGreaterThan(2.5);
    expect(pm.targetScenario.expectedDays).toBe(15); // profile B
    expect(pm.targetScenario.profitTrancheCount).toBe(3);
  });

  it('ma60·avgVolume 없으면 MA60_BREAK·VOLUME_DROP 조건 생략', () => {
    const pm = buildPreMortemStructured({
      entryPrice: 50_000, targetPrice: 55_000, stopLoss: 48_000,
      regime: 'R3_EARLY',
    });
    expect(pm.invalidationConditions.find(c => c.id === 'MA60_BREAK')).toBeUndefined();
    expect(pm.invalidationConditions.find(c => c.id === 'VOLUME_DROP')).toBeUndefined();
    expect(pm.invalidationConditions.find(c => c.id === 'HARD_STOP_HIT')).toBeTruthy();
  });

  it('profile 별 expectedDays 차등', () => {
    const a = buildPreMortemStructured({ entryPrice: 100, targetPrice: 110, stopLoss: 95, regime: 'R1', profileType: 'A' });
    const c = buildPreMortemStructured({ entryPrice: 100, targetPrice: 110, stopLoss: 95, regime: 'R1', profileType: 'C' });
    const d = buildPreMortemStructured({ entryPrice: 100, targetPrice: 110, stopLoss: 95, regime: 'R1', profileType: 'D' });
    expect(a.targetScenario.expectedDays).toBe(30);
    expect(c.targetScenario.expectedDays).toBe(7);
    expect(d.targetScenario.expectedDays).toBe(3);
  });
});

describe('matchExitInvalidation — 종결 시점 매칭', () => {
  const baseTrade: ServerShadowTrade = {
    id: 't1', stockCode: '005930', stockName: '삼성전자',
    signalTime: '2026-04-20T00:00:00Z',
    signalPrice: 50_000, shadowEntryPrice: 50_000, quantity: 10,
    stopLoss: 47_500, hardStopLoss: 47_500, targetPrice: 55_000,
    status: 'ACTIVE', entryRegime: 'R2_BULL',
    preMortemStructured: buildPreMortemStructured({
      entryPrice: 50_000, targetPrice: 55_000, stopLoss: 47_500,
      regime: 'R2_BULL', ma60: 48_000, avgVolume: 1_000_000,
    }),
  };

  it('HARD_STOP_HIT — 가격이 hardStop 이하', () => {
    const m = matchExitInvalidation(baseTrade, {
      currentPrice: 47_000, currentRegime: 'R2_BULL',
    });
    expect(m?.id).toBe('HARD_STOP_HIT');
    expect(m?.observedValue).toBe(47_000);
  });

  it('HARD_STOP_HIT 우선 — MA60 이탈이어도 가격이 stop 이하면 HARD_STOP_HIT', () => {
    const m = matchExitInvalidation(baseTrade, {
      currentPrice: 46_000, currentRegime: 'R4_NEUTRAL',
    });
    expect(m?.id).toBe('HARD_STOP_HIT');
  });

  it('MA60_BREAK — 가격이 hardStop 위이지만 MA60 아래', () => {
    const m = matchExitInvalidation(baseTrade, {
      currentPrice: 47_800, currentRegime: 'R2_BULL',
    });
    expect(m?.id).toBe('MA60_BREAK');
  });

  it('REGIME_DOWNGRADE — 레짐 악화', () => {
    const m = matchExitInvalidation(baseTrade, {
      currentPrice: 49_000, currentRegime: 'R5_CAUTION',
    });
    expect(m?.id).toBe('REGIME_DOWNGRADE');
  });

  it('preMortemStructured 미부착 trade → null', () => {
    const bare = { ...baseTrade, preMortemStructured: undefined };
    const m = matchExitInvalidation(bare, { currentPrice: 45_000, currentRegime: 'R2_BULL' });
    expect(m).toBeNull();
  });
});
