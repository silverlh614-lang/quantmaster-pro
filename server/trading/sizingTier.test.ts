/**
 * sizingTier.test.ts — Phase 4-⑧(수정) 신뢰도 티어 기반 사이징 회귀.
 */

import { describe, it, expect } from 'vitest';
import {
  classifySizingTier,
  canReserveProbingSlot,
  TIER_KELLY_FACTOR,
  PROBING_MAX_SLOTS,
  CONVICTION_MIN_LIVE_GATE,
  CONVICTION_MIN_MTAS,
  STANDARD_MIN_LIVE_GATE,
  PROBING_MIN_CONDITIONS,
} from './sizingTier.js';

describe('classifySizingTier — CONVICTION', () => {
  it('Gate ≥ 8 & MTAS ≥ 8 & sector aligned → CONVICTION Kelly×1.0', () => {
    const d = classifySizingTier({
      liveGate: 8.5, mtas: 8.5, gate1Pass: true,
      sectorAligned: true, conditionsMatched: 5,
    });
    expect(d.tier).toBe('CONVICTION');
    expect(d.kellyFactor).toBe(1.0);
  });

  it('Gate 8 / MTAS 8 경계값은 CONVICTION', () => {
    const d = classifySizingTier({
      liveGate: 8.0, mtas: 8.0, gate1Pass: true,
      sectorAligned: true, conditionsMatched: 4,
    });
    expect(d.tier).toBe('CONVICTION');
  });

  it('섹터 미정렬 → CONVICTION 탈락, STANDARD 로 강등', () => {
    const d = classifySizingTier({
      liveGate: 8.5, mtas: 8.5, gate1Pass: true,
      sectorAligned: false, conditionsMatched: 5,
    });
    expect(d.tier === 'CONVICTION').toBe(false);
  });
});

describe('classifySizingTier — STANDARD', () => {
  it('Gate 1 통과 & liveGate 6~8 → STANDARD Kelly×0.6', () => {
    const d = classifySizingTier({
      liveGate: 7.0, mtas: 6.5, gate1Pass: true,
      sectorAligned: false, conditionsMatched: 4,
    });
    expect(d.tier).toBe('STANDARD');
    expect(d.kellyFactor).toBe(0.6);
  });

  it('Gate 1 미달이면 STANDARD 가 아님', () => {
    const d = classifySizingTier({
      liveGate: 7.0, mtas: 6.5, gate1Pass: false,
      sectorAligned: false, conditionsMatched: 4,
    });
    expect(d.tier === 'STANDARD').toBe(false);
  });

  it('liveGate = CONVICTION_MIN 이면 STANDARD 가 아님 (CONVICTION 조건 미달 시 null)', () => {
    const d = classifySizingTier({
      liveGate: 8.0, mtas: 7.0, gate1Pass: true,
      sectorAligned: false, conditionsMatched: 4,
    });
    // Gate 8 상한이 [6, 8) 이므로 STANDARD 에 속하지 않음
    expect(d.tier === 'STANDARD').toBe(false);
  });
});

describe('classifySizingTier — PROBING', () => {
  it('Gate 1 미달 + 3개 조건 만족 → PROBING Kelly×0.25', () => {
    const d = classifySizingTier({
      liveGate: 5.0, mtas: 5.0, gate1Pass: false,
      sectorAligned: false, conditionsMatched: 3,
    });
    expect(d.tier).toBe('PROBING');
    expect(d.kellyFactor).toBe(0.25);
  });

  it('Gate 1 미달 + 조건 2개만 만족 → null (탐색도 미달)', () => {
    const d = classifySizingTier({
      liveGate: 5.0, mtas: 5.0, gate1Pass: false,
      sectorAligned: false, conditionsMatched: 2,
    });
    expect(d.tier).toBeNull();
    expect(d.kellyFactor).toBe(0);
  });
});

describe('canReserveProbingSlot — 최대 1슬롯', () => {
  it('현재 0개 → 허용', () => {
    expect(canReserveProbingSlot(0)).toBe(true);
  });

  it('현재 1개 → 차단', () => {
    expect(canReserveProbingSlot(1)).toBe(false);
  });

  it('PROBING_MAX_SLOTS 가 1 로 고정 (구조적 제한)', () => {
    expect(PROBING_MAX_SLOTS).toBe(1);
  });
});

describe('Kelly 차등 불변식', () => {
  it('CONVICTION > STANDARD > PROBING', () => {
    expect(TIER_KELLY_FACTOR.CONVICTION).toBeGreaterThan(TIER_KELLY_FACTOR.STANDARD);
    expect(TIER_KELLY_FACTOR.STANDARD).toBeGreaterThan(TIER_KELLY_FACTOR.PROBING);
  });

  it('임계값 불변식 — CONVICTION 8 / STANDARD 6 / PROBING 3 조건', () => {
    expect(CONVICTION_MIN_LIVE_GATE).toBe(8);
    expect(CONVICTION_MIN_MTAS).toBe(8);
    expect(STANDARD_MIN_LIVE_GATE).toBe(6);
    expect(PROBING_MIN_CONDITIONS).toBe(3);
  });
});
