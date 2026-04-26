/**
 * @responsibility classifyLossReason 회귀 테스트 (ADR-0021 PR-D)
 */
import { describe, it, expect } from 'vitest';
import {
  classifyLossReason,
  buildLossReasonMeta,
  MACRO_SHOCK_VKOSPI_DELTA,
  STOP_TOO_LOOSE_RETURN_PCT_MAX,
} from './lossReasonClassifier';
import type { ConditionId } from '../../types/core';

describe('classifyLossReason — 수익 거래 / 비정상 입력', () => {
  it('returnPct >= 0 → UNCLASSIFIED (수익은 분류 진입 안 함)', () => {
    expect(classifyLossReason({ returnPct: 5 })).toBe('UNCLASSIFIED');
    expect(classifyLossReason({ returnPct: 0 })).toBe('UNCLASSIFIED');
  });

  it('returnPct = NaN/Infinity → UNCLASSIFIED 안전 fallback', () => {
    expect(classifyLossReason({ returnPct: NaN })).toBe('UNCLASSIFIED');
    expect(classifyLossReason({ returnPct: Infinity })).toBe('UNCLASSIFIED');
  });
});

describe('classifyLossReason — MACRO_SHOCK 우선순위 1', () => {
  it('VKOSPI +8 + returnPct -3% → MACRO_SHOCK', () => {
    const r = classifyLossReason({
      returnPct: -3,
      vkospiAtBuy: 18,
      vkospiAtSell: 26, // +8
    });
    expect(r).toBe('MACRO_SHOCK');
  });

  it('VKOSPI +10 + returnPct -8% → MACRO_SHOCK (다른 분기 동시 매칭이라도 우선)', () => {
    const r = classifyLossReason({
      returnPct: -8,
      holdingDays: 2,
      sellReason: 'STOP_LOSS', // STOP_TOO_TIGHT 도 매칭 가능
      vkospiAtBuy: 20,
      vkospiAtSell: 30, // +10
    });
    expect(r).toBe('MACRO_SHOCK'); // 우선순위 1
  });

  it('VKOSPI +7 (8 미만) → MACRO_SHOCK 미진입', () => {
    const r = classifyLossReason({
      returnPct: -3,
      vkospiAtBuy: 18,
      vkospiAtSell: 25, // +7, 임계 미달
    });
    expect(r).not.toBe('MACRO_SHOCK');
  });

  it('VKOSPI 데이터 부재 시 MACRO_SHOCK 자동 스킵', () => {
    const r = classifyLossReason({
      returnPct: -3,
      // vkospiAtBuy / vkospiAtSell 모두 undefined
    });
    expect(r).not.toBe('MACRO_SHOCK');
  });

  it('VKOSPI 1개만 있을 때 MACRO_SHOCK 자동 스킵', () => {
    expect(classifyLossReason({ returnPct: -3, vkospiAtBuy: 18 })).not.toBe('MACRO_SHOCK');
    expect(classifyLossReason({ returnPct: -3, vkospiAtSell: 26 })).not.toBe('MACRO_SHOCK');
  });
});

describe('classifyLossReason — STOP_TOO_TIGHT 우선순위 2', () => {
  it('holdingDays 2 + returnPct -5% + STOP_LOSS → STOP_TOO_TIGHT', () => {
    const r = classifyLossReason({
      returnPct: -5,
      holdingDays: 2,
      sellReason: 'STOP_LOSS',
    });
    expect(r).toBe('STOP_TOO_TIGHT');
  });

  it('holdingDays 4 (임계 초과) → STOP_TOO_TIGHT 미진입', () => {
    const r = classifyLossReason({
      returnPct: -5,
      holdingDays: 4,
      sellReason: 'STOP_LOSS',
    });
    expect(r).not.toBe('STOP_TOO_TIGHT');
  });

  it('returnPct -2% (-3% 초과) → STOP_TOO_TIGHT 미진입', () => {
    const r = classifyLossReason({
      returnPct: -2,
      holdingDays: 2,
      sellReason: 'STOP_LOSS',
    });
    expect(r).not.toBe('STOP_TOO_TIGHT');
  });

  it('returnPct -10% (boundary 미만) → STOP_TOO_TIGHT 미진입', () => {
    const r = classifyLossReason({
      returnPct: -10,
      holdingDays: 2,
      sellReason: 'STOP_LOSS',
    });
    expect(r).not.toBe('STOP_TOO_TIGHT');
  });

  it('sellReason !== STOP_LOSS → STOP_TOO_TIGHT 미진입 (수동 매도는 제외)', () => {
    const r = classifyLossReason({
      returnPct: -5,
      holdingDays: 2,
      sellReason: 'MANUAL',
    });
    expect(r).not.toBe('STOP_TOO_TIGHT');
  });
});

describe('classifyLossReason — OVERHEATED_ENTRY 우선순위 3', () => {
  it('holdingDays 4 + 조건 17 (심리적 객관성) = 2 → OVERHEATED_ENTRY', () => {
    const conditionScores: Partial<Record<ConditionId, number>> = { 17: 2 };
    const r = classifyLossReason({
      returnPct: -7,
      holdingDays: 4,
      conditionScores,
    });
    expect(r).toBe('OVERHEATED_ENTRY');
  });

  it('holdingDays 5 + 조건 25 (VCP) = 0 → OVERHEATED_ENTRY', () => {
    const conditionScores: Partial<Record<ConditionId, number>> = { 25: 0 };
    const r = classifyLossReason({
      returnPct: -7,
      holdingDays: 5,
      conditionScores,
    });
    expect(r).toBe('OVERHEATED_ENTRY');
  });

  it('holdingDays 6 (임계 초과) → OVERHEATED_ENTRY 미진입', () => {
    const conditionScores: Partial<Record<ConditionId, number>> = { 17: 2 };
    const r = classifyLossReason({
      returnPct: -7,
      holdingDays: 6,
      conditionScores,
    });
    expect(r).not.toBe('OVERHEATED_ENTRY');
  });

  it('조건 17 = 5 + 25 = 8 (둘 다 정상) → OVERHEATED_ENTRY 미진입', () => {
    const conditionScores: Partial<Record<ConditionId, number>> = { 17: 5, 25: 8 };
    const r = classifyLossReason({
      returnPct: -7,
      holdingDays: 4,
      conditionScores,
    });
    expect(r).not.toBe('OVERHEATED_ENTRY');
  });

  it('conditionScores 부재 → OVERHEATED_ENTRY 자동 스킵', () => {
    const r = classifyLossReason({
      returnPct: -7,
      holdingDays: 4,
    });
    expect(r).not.toBe('OVERHEATED_ENTRY');
  });
});

describe('classifyLossReason — STOP_TOO_LOOSE 우선순위 4', () => {
  it('returnPct -15% → STOP_TOO_LOOSE', () => {
    expect(classifyLossReason({ returnPct: STOP_TOO_LOOSE_RETURN_PCT_MAX })).toBe('STOP_TOO_LOOSE');
  });

  it('returnPct -20% → STOP_TOO_LOOSE', () => {
    expect(classifyLossReason({ returnPct: -20 })).toBe('STOP_TOO_LOOSE');
  });

  it('returnPct -14% (boundary 미달) → UNCLASSIFIED', () => {
    expect(classifyLossReason({ returnPct: -14 })).toBe('UNCLASSIFIED');
  });
});

describe('classifyLossReason — UNCLASSIFIED fallback', () => {
  it('-3% < returnPct < -15% + 분기 조건 모두 미해당', () => {
    const r = classifyLossReason({
      returnPct: -10,
      holdingDays: 10, // STOP_TOO_TIGHT 아니고 OVERHEATED 아님
      sellReason: 'MANUAL',
    });
    expect(r).toBe('UNCLASSIFIED');
  });

  it('-3% 정확 (boundary, STOP_TOO_TIGHT 매칭됨)', () => {
    const r = classifyLossReason({
      returnPct: -3,
      holdingDays: 1,
      sellReason: 'STOP_LOSS',
    });
    expect(r).toBe('STOP_TOO_TIGHT'); // -3% 정확 → boundary 포함
  });

  it('-2.99% (STOP_TOO_TIGHT 미달)', () => {
    const r = classifyLossReason({
      returnPct: -2.99,
      holdingDays: 1,
      sellReason: 'STOP_LOSS',
    });
    expect(r).toBe('UNCLASSIFIED');
  });
});

describe('우선순위 충돌 — MACRO_SHOCK + STOP_TOO_TIGHT 동시 매칭', () => {
  it('VKOSPI +12 + holdingDays 1 + returnPct -5% + STOP_LOSS → MACRO_SHOCK 우선', () => {
    const r = classifyLossReason({
      returnPct: -5,
      holdingDays: 1,
      sellReason: 'STOP_LOSS',
      vkospiAtBuy: 18,
      vkospiAtSell: 30,
    });
    expect(r).toBe('MACRO_SHOCK');
  });
});

describe('우선순위 충돌 — STOP_TOO_TIGHT + STOP_TOO_LOOSE 충돌 불가능', () => {
  it('STOP_TOO_TIGHT 범위(-3% ~ -10%) 와 STOP_TOO_LOOSE 범위(<= -15%) 는 disjoint', () => {
    // -10% < returnPct → STOP_TOO_TIGHT 자동 미진입 (boundary 정확)
    // returnPct <= -10% → STOP_TOO_TIGHT 미진입, STOP_TOO_LOOSE 는 -15% 까지 미진입
    const r = classifyLossReason({
      returnPct: -12,
      holdingDays: 2,
      sellReason: 'STOP_LOSS',
    });
    expect(r).toBe('UNCLASSIFIED'); // 어느 분기에도 안 걸림 (gap zone)
  });
});

describe('buildLossReasonMeta', () => {
  it('lossReasonAuto=true + lossReasonClassifiedAt ISO 형식', () => {
    const meta = buildLossReasonMeta('MACRO_SHOCK', new Date('2026-04-26T01:00:00.000Z'));
    expect(meta.lossReason).toBe('MACRO_SHOCK');
    expect(meta.lossReasonAuto).toBe(true);
    expect(meta.lossReasonClassifiedAt).toBe('2026-04-26T01:00:00.000Z');
  });
});

describe('MACRO_SHOCK_VKOSPI_DELTA 상수 검증', () => {
  it('값이 8 (포인트)', () => {
    expect(MACRO_SHOCK_VKOSPI_DELTA).toBe(8);
  });
});
