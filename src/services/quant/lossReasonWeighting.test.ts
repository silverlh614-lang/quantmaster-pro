/**
 * @responsibility lossReasonWeighting SSOT 회귀 테스트 (ADR-0022 PR-E)
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  LOSS_REASON_LEARNING_MULTIPLIER,
  getTradeLearningWeight,
  isLossReasonWeightingDisabled,
  summarizeLossReasonBreakdown,
} from './lossReasonWeighting';
import type { TradeRecord, LossReason } from '../../types/portfolio';
import type { ConditionId } from '../../types/core';

const ORIGINAL_ENV = process.env.LEARNING_LOSS_REASON_WEIGHTING_DISABLED;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.LEARNING_LOSS_REASON_WEIGHTING_DISABLED;
  } else {
    process.env.LEARNING_LOSS_REASON_WEIGHTING_DISABLED = ORIGINAL_ENV;
  }
});

function makeTrade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: 'test',
    stockCode: 'A',
    stockName: 'A',
    sector: 'IT',
    buyDate: new Date().toISOString(),
    buyPrice: 1000,
    quantity: 10,
    positionSize: 10,
    systemSignal: 'BUY',
    recommendation: '절반 포지션',
    gate1Score: 5,
    gate2Score: 5,
    gate3Score: 5,
    finalScore: 150,
    conditionScores: {} as Record<ConditionId, number>,
    followedSystem: true,
    status: 'CLOSED',
    returnPct: -5,
    ...overrides,
  };
}

describe('LOSS_REASON_LEARNING_MULTIPLIER — SSOT 정합성', () => {
  it('9 LossReason 모두 매핑 + 0~1.5 범위', () => {
    const reasons: LossReason[] = [
      'STOP_TOO_TIGHT', 'MACRO_SHOCK', 'OVERHEATED_ENTRY', 'STOP_TOO_LOOSE',
      'FALSE_BREAKOUT', 'SECTOR_ROTATION_OUT', 'EARNINGS_MISS',
      'LIQUIDITY_TRAP', 'UNCLASSIFIED',
    ];
    for (const r of reasons) {
      const m = LOSS_REASON_LEARNING_MULTIPLIER[r];
      expect(typeof m).toBe('number');
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1.5);
    }
  });

  it('STOP_TOO_TIGHT 0.3 / MACRO_SHOCK 0.2 / OVERHEATED 1.5 / STOP_TOO_LOOSE 1.5', () => {
    expect(LOSS_REASON_LEARNING_MULTIPLIER.STOP_TOO_TIGHT).toBe(0.3);
    expect(LOSS_REASON_LEARNING_MULTIPLIER.MACRO_SHOCK).toBe(0.2);
    expect(LOSS_REASON_LEARNING_MULTIPLIER.OVERHEATED_ENTRY).toBe(1.5);
    expect(LOSS_REASON_LEARNING_MULTIPLIER.STOP_TOO_LOOSE).toBe(1.5);
    expect(LOSS_REASON_LEARNING_MULTIPLIER.UNCLASSIFIED).toBe(1.0);
  });
});

describe('getTradeLearningWeight', () => {
  it('수익 거래 (returnPct >= 0) → 1.0 (lossReason 무관)', () => {
    expect(getTradeLearningWeight(makeTrade({ returnPct: 5 }))).toBe(1.0);
    expect(getTradeLearningWeight(makeTrade({ returnPct: 0 }))).toBe(1.0);
    expect(getTradeLearningWeight(makeTrade({
      returnPct: 5,
      lossReason: 'STOP_TOO_TIGHT', // 데이터 오염 시뮬레이션
    }))).toBe(1.0);
  });

  it('lossReason 부재 손실 (v1/v2 호환) → 1.0 fallback', () => {
    expect(getTradeLearningWeight(makeTrade({ returnPct: -5 }))).toBe(1.0);
  });

  it('STOP_TOO_TIGHT 손실 → 0.3', () => {
    expect(getTradeLearningWeight(makeTrade({
      returnPct: -5,
      lossReason: 'STOP_TOO_TIGHT',
    }))).toBe(0.3);
  });

  it('MACRO_SHOCK 손실 → 0.2', () => {
    expect(getTradeLearningWeight(makeTrade({
      returnPct: -8,
      lossReason: 'MACRO_SHOCK',
    }))).toBe(0.2);
  });

  it('OVERHEATED_ENTRY 손실 → 1.5 (강화)', () => {
    expect(getTradeLearningWeight(makeTrade({
      returnPct: -7,
      lossReason: 'OVERHEATED_ENTRY',
    }))).toBe(1.5);
  });

  it('STOP_TOO_LOOSE 손실 → 1.5 (강화)', () => {
    expect(getTradeLearningWeight(makeTrade({
      returnPct: -20,
      lossReason: 'STOP_TOO_LOOSE',
    }))).toBe(1.5);
  });

  it('UNCLASSIFIED 손실 → 1.0', () => {
    expect(getTradeLearningWeight(makeTrade({
      returnPct: -5,
      lossReason: 'UNCLASSIFIED',
    }))).toBe(1.0);
  });

  it('LEARNING_LOSS_REASON_WEIGHTING_DISABLED=true → 모든 trade 1.0 (롤백)', () => {
    process.env.LEARNING_LOSS_REASON_WEIGHTING_DISABLED = 'true';
    expect(isLossReasonWeightingDisabled()).toBe(true);
    expect(getTradeLearningWeight(makeTrade({
      returnPct: -5,
      lossReason: 'STOP_TOO_TIGHT', // 정상은 0.3
    }))).toBe(1.0);
    expect(getTradeLearningWeight(makeTrade({
      returnPct: -7,
      lossReason: 'OVERHEATED_ENTRY', // 정상은 1.5
    }))).toBe(1.0);
  });

  it('returnPct=NaN/Infinity → 1.0 안전 fallback', () => {
    expect(getTradeLearningWeight(makeTrade({
      returnPct: NaN,
      lossReason: 'STOP_TOO_TIGHT',
    }))).toBe(1.0);
    expect(getTradeLearningWeight(makeTrade({
      returnPct: Infinity,
      lossReason: 'MACRO_SHOCK',
    }))).toBe(1.0);
  });
});

describe('summarizeLossReasonBreakdown', () => {
  it('빈 배열 → 빈 객체', () => {
    expect(summarizeLossReasonBreakdown([])).toEqual({});
  });

  it('수익 거래 스킵 + 손실 거래만 카운트', () => {
    const trades = [
      makeTrade({ returnPct: 5 }),                                  // 수익 — 스킵
      makeTrade({ returnPct: -5, lossReason: 'STOP_TOO_TIGHT' }),
      makeTrade({ returnPct: -5, lossReason: 'STOP_TOO_TIGHT' }),
      makeTrade({ returnPct: -8, lossReason: 'MACRO_SHOCK' }),
    ];
    const breakdown = summarizeLossReasonBreakdown(trades);
    expect(breakdown).toEqual({ STOP_TOO_TIGHT: 2, MACRO_SHOCK: 1 });
    expect(breakdown.OVERHEATED_ENTRY).toBeUndefined();
  });

  it('lossReason 부재 손실 → UNCLASSIFIED 로 카운트', () => {
    const trades = [
      makeTrade({ returnPct: -5 }), // lossReason 부재
      makeTrade({ returnPct: -5, lossReason: 'STOP_TOO_TIGHT' }),
    ];
    const breakdown = summarizeLossReasonBreakdown(trades);
    expect(breakdown.UNCLASSIFIED).toBe(1);
    expect(breakdown.STOP_TOO_TIGHT).toBe(1);
  });
});
