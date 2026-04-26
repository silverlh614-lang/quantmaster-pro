/**
 * @responsibility evaluateInvalidationConditions + composeInvalidationTier 회귀 (ADR-0051 PR-Z3)
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateInvalidationConditions,
  composeInvalidationTier,
  STOP_LOSS_APPROACH_RATIO,
  LOSS_THRESHOLD_PCT,
  type InvalidationKey,
  type InvalidationTier,
} from './invalidationConditions';
import type { PositionItem } from '../services/autoTrading/autoTradingTypes';

function makePosition(overrides: Partial<PositionItem> = {}): PositionItem {
  return {
    id: '005930',
    symbol: '005930',
    name: '삼성전자',
    enteredAt: '2026-04-26T00:00:00Z',
    entryReason: 'test',
    avgPrice: 70_000,
    currentPrice: 70_000,
    quantity: 10,
    pnlPct: 0,
    stopLossPrice: 66_500,    // -5%
    targetPrice1: 77_000,     // +10%
    targetPrice2: 84_000,     // +20%
    trailingStopEnabled: false,
    status: 'HOLD',
    stage: 'HOLD',
    ...overrides,
  };
}

function findCondition(result: ReturnType<typeof evaluateInvalidationConditions>, key: InvalidationKey) {
  const c = result.conditions.find((x) => x.key === key);
  if (!c) throw new Error(`condition ${key} not found`);
  return c;
}

describe('evaluateInvalidationConditions — 4 카테고리 (ADR-0051 §2.1)', () => {
  it('정상 보유 (수익 +5%, stage HOLD, 손절가 충분 여유) → 모두 미충족 + tier OK', () => {
    const r = evaluateInvalidationConditions(makePosition({
      currentPrice: 73_500, pnlPct: 5, stage: 'HOLD',
    }));
    expect(r.metCount).toBe(0);
    expect(r.evaluableCount).toBe(4);
    expect(r.tier).toBe<InvalidationTier>('OK');
    expect(r.conditions.map((c) => c.key)).toEqual([
      'STOP_LOSS_APPROACH', 'LOSS_THRESHOLD', 'STAGE_ESCALATION', 'TARGET_REACHED',
    ]);
  });

  it('STOP_LOSS_APPROACH — 현재가 = 손절가 × 1.05 정확히 → 충족 (경계값 포함)', () => {
    // stopLoss=66500, ratio=1.05 → 현재가 = 69825
    const r = evaluateInvalidationConditions(makePosition({
      currentPrice: 69_825, stopLossPrice: 66_500, pnlPct: -0.25, stage: 'HOLD',
    }));
    expect(findCondition(r, 'STOP_LOSS_APPROACH').met).toBe(true);
  });

  it('STOP_LOSS_APPROACH — 현재가 > 손절가 × 1.05 → 미충족', () => {
    const r = evaluateInvalidationConditions(makePosition({
      currentPrice: 70_000, stopLossPrice: 66_500, pnlPct: 0, stage: 'HOLD',
    }));
    expect(findCondition(r, 'STOP_LOSS_APPROACH').met).toBe(false);
  });

  it('STOP_LOSS_APPROACH — stopLossPrice 부재 → met=null (NA)', () => {
    const r = evaluateInvalidationConditions(makePosition({
      stopLossPrice: undefined, pnlPct: 0,
    }));
    expect(findCondition(r, 'STOP_LOSS_APPROACH').met).toBeNull();
    expect(r.evaluableCount).toBe(3);
  });

  it('LOSS_THRESHOLD — pnlPct=-3 정확히 → 충족 (경계값 포함)', () => {
    const r = evaluateInvalidationConditions(makePosition({ pnlPct: LOSS_THRESHOLD_PCT }));
    expect(findCondition(r, 'LOSS_THRESHOLD').met).toBe(true);
  });

  it('LOSS_THRESHOLD — pnlPct=-2.99 → 미충족', () => {
    const r = evaluateInvalidationConditions(makePosition({ pnlPct: -2.99 }));
    expect(findCondition(r, 'LOSS_THRESHOLD').met).toBe(false);
  });

  it('STAGE_ESCALATION — stage=ALERT → 충족', () => {
    const r = evaluateInvalidationConditions(makePosition({ stage: 'ALERT' }));
    expect(findCondition(r, 'STAGE_ESCALATION').met).toBe(true);
  });

  it('STAGE_ESCALATION — stage=ENTRY → 미충족', () => {
    const r = evaluateInvalidationConditions(makePosition({ stage: 'ENTRY' }));
    expect(findCondition(r, 'STAGE_ESCALATION').met).toBe(false);
  });

  it('STAGE_ESCALATION — stage 부재 → met=null (NA)', () => {
    const r = evaluateInvalidationConditions(makePosition({ stage: undefined }));
    expect(findCondition(r, 'STAGE_ESCALATION').met).toBeNull();
  });

  it('TARGET_REACHED — currentPrice ≥ targetPrice1 → 충족', () => {
    const r = evaluateInvalidationConditions(makePosition({
      currentPrice: 78_000, targetPrice1: 77_000, pnlPct: 11,
    }));
    expect(findCondition(r, 'TARGET_REACHED').met).toBe(true);
  });

  it('TARGET_REACHED — targetPrice1 부재 → met=null (NA)', () => {
    const r = evaluateInvalidationConditions(makePosition({ targetPrice1: undefined }));
    expect(findCondition(r, 'TARGET_REACHED').met).toBeNull();
  });

  it('통합 — STOP_LOSS_APPROACH + LOSS_THRESHOLD + STAGE_ESCALATION 동시 충족 → CRITICAL', () => {
    const r = evaluateInvalidationConditions(makePosition({
      currentPrice: 67_000, pnlPct: -4.3, stage: 'EXIT_PREP', stopLossPrice: 66_500,
    }));
    expect(r.metCount).toBeGreaterThanOrEqual(2);
    expect(r.tier).toBe('CRITICAL');
  });

  it('통합 — 모두 NA (stopLoss/targetPrice/stage 모두 부재 + pnl=NaN) → tier NA', () => {
    const r = evaluateInvalidationConditions(makePosition({
      stopLossPrice: undefined,
      targetPrice1: undefined,
      stage: undefined,
      pnlPct: NaN,
    }));
    expect(r.evaluableCount).toBe(0);
    expect(r.tier).toBe('NA');
  });

  it('detail 텍스트가 임계값 정보 포함 — 손절가 임박', () => {
    const r = evaluateInvalidationConditions(makePosition({
      currentPrice: 69_825, stopLossPrice: 66_500, pnlPct: 0,
    }));
    const c = findCondition(r, 'STOP_LOSS_APPROACH');
    expect(c.detail).toContain('66,500');
    expect(c.detail).toContain('69,825');
  });

  it('STOP_LOSS_APPROACH_RATIO 상수가 ADR-0051 §2.1 (1.05) 와 일치', () => {
    expect(STOP_LOSS_APPROACH_RATIO).toBe(1.05);
  });
});

describe('composeInvalidationTier — ADR-0051 §2.3', () => {
  it('evaluableCount=0 → NA (모두 평가 불가)', () => {
    expect(composeInvalidationTier(0, 0)).toBe('NA');
    expect(composeInvalidationTier(2, 0)).toBe('NA'); // 의미 없는 입력도 안전
  });

  it('metCount=0 → OK', () => {
    expect(composeInvalidationTier(0, 4)).toBe('OK');
    expect(composeInvalidationTier(0, 1)).toBe('OK');
  });

  it('metCount=1 → WARN', () => {
    expect(composeInvalidationTier(1, 4)).toBe('WARN');
    expect(composeInvalidationTier(1, 1)).toBe('WARN');
  });

  it('metCount=2 → CRITICAL', () => {
    expect(composeInvalidationTier(2, 4)).toBe('CRITICAL');
    expect(composeInvalidationTier(2, 2)).toBe('CRITICAL');
  });

  it('metCount=3+ → CRITICAL (최악 유지)', () => {
    expect(composeInvalidationTier(3, 4)).toBe('CRITICAL');
    expect(composeInvalidationTier(4, 4)).toBe('CRITICAL');
  });

  it('NaN 입력 → NA (안전 fallback)', () => {
    expect(composeInvalidationTier(NaN, 4)).toBe('NA');
    expect(composeInvalidationTier(2, NaN)).toBe('NA');
  });
});
