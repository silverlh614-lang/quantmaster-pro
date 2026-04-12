import { describe, expect, it } from 'vitest';
import { evaluateMarketRegimeClassifier } from './quant/marketRegimeClassifier';
import type { MarketRegimeClassifierInput } from '../types/quant';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function input(overrides: Partial<MarketRegimeClassifierInput> = {}): MarketRegimeClassifierInput {
  return {
    vkospi: 20,
    foreignNetBuy4wTrend: 0,
    kospiAbove200MA: true,
    dxyDirection: 'FLAT',
    ...overrides,
  };
}

// ─── RISK_OFF_CRISIS 단위 테스트 ──────────────────────────────────────────────

describe('evaluateMarketRegimeClassifier — RISK_OFF_CRISIS', () => {
  it('VKOSPI ≥ 30 → RISK_OFF_CRISIS (극공포)', () => {
    const result = evaluateMarketRegimeClassifier(input({ vkospi: 30 }));
    expect(result.classification).toBe('RISK_OFF_CRISIS');
    expect(result.buyingHalted).toBe(true);
    expect(result.cashRatioMinPct).toBe(70);
    expect(result.positionSizeLimitPct).toBe(0);
  });

  it('VKOSPI = 45 → RISK_OFF_CRISIS', () => {
    const result = evaluateMarketRegimeClassifier(input({ vkospi: 45 }));
    expect(result.classification).toBe('RISK_OFF_CRISIS');
  });

  it('외국인 순매도 + KOSPI 200일선 아래 + 달러 강세 → RISK_OFF_CRISIS', () => {
    const result = evaluateMarketRegimeClassifier(input({
      vkospi: 25,
      foreignNetBuy4wTrend: -5000,
      kospiAbove200MA: false,
      dxyDirection: 'UP',
    }));
    expect(result.classification).toBe('RISK_OFF_CRISIS');
    expect(result.buyingHalted).toBe(true);
  });

  it('gate2RequiredOverride는 null (CRISIS는 Gate 2 완화 없음)', () => {
    const result = evaluateMarketRegimeClassifier(input({ vkospi: 35 }));
    expect(result.gate2RequiredOverride).toBeNull();
    expect(result.gate1Strengthened).toBe(true);
  });
});

// ─── RISK_OFF_CORRECTION 단위 테스트 ─────────────────────────────────────────

describe('evaluateMarketRegimeClassifier — RISK_OFF_CORRECTION', () => {
  it('VKOSPI ≥ 22 → RISK_OFF_CORRECTION', () => {
    const result = evaluateMarketRegimeClassifier(input({ vkospi: 22 }));
    expect(result.classification).toBe('RISK_OFF_CORRECTION');
    expect(result.gate1Strengthened).toBe(true);
    expect(result.positionSizeLimitPct).toBe(50);
    expect(result.cashRatioMinPct).toBe(30);
    expect(result.buyingHalted).toBe(false);
  });

  it('VKOSPI = 29 → RISK_OFF_CORRECTION (30 미만)', () => {
    const result = evaluateMarketRegimeClassifier(input({ vkospi: 29 }));
    expect(result.classification).toBe('RISK_OFF_CORRECTION');
  });

  it('외국인 순매도 + 달러 강세 → RISK_OFF_CORRECTION', () => {
    const result = evaluateMarketRegimeClassifier(input({
      vkospi: 18,
      foreignNetBuy4wTrend: -1000,
      dxyDirection: 'UP',
    }));
    expect(result.classification).toBe('RISK_OFF_CORRECTION');
    expect(result.positionSizeLimitPct).toBe(50);
  });

  it('외국인 순매도 + KOSPI 200일선 아래 (달러 중립) → RISK_OFF_CORRECTION', () => {
    const result = evaluateMarketRegimeClassifier(input({
      vkospi: 19,
      foreignNetBuy4wTrend: -500,
      kospiAbove200MA: false,
      dxyDirection: 'FLAT',
    }));
    expect(result.classification).toBe('RISK_OFF_CORRECTION');
  });

  it('gate2RequiredOverride는 null (표준 기준 유지)', () => {
    const result = evaluateMarketRegimeClassifier(input({ vkospi: 22 }));
    expect(result.gate2RequiredOverride).toBeNull();
  });
});

// ─── RISK_ON_BULL 단위 테스트 ────────────────────────────────────────────────

describe('evaluateMarketRegimeClassifier — RISK_ON_BULL', () => {
  it('이상적인 강세 4신호 → RISK_ON_BULL', () => {
    const result = evaluateMarketRegimeClassifier(input({
      vkospi: 14,
      foreignNetBuy4wTrend: 5000,
      kospiAbove200MA: true,
      dxyDirection: 'DOWN',
    }));
    expect(result.classification).toBe('RISK_ON_BULL');
    expect(result.gate2RequiredOverride).toBe(8);   // 9→8 완화
    expect(result.gate1Strengthened).toBe(false);
    expect(result.positionSizeLimitPct).toBe(100);
    expect(result.buyingHalted).toBe(false);
    expect(result.cashRatioMinPct).toBe(0);
  });

  it('3신호만 충족 (달러 보합) → RISK_ON_BULL', () => {
    const result = evaluateMarketRegimeClassifier(input({
      vkospi: 15,
      foreignNetBuy4wTrend: 3000,
      kospiAbove200MA: true,
      dxyDirection: 'FLAT',
    }));
    expect(result.classification).toBe('RISK_ON_BULL');
    expect(result.gate2RequiredOverride).toBe(8);
  });

  it('VKOSPI 17 경계값 — RISK_ON_BULL 포함', () => {
    const result = evaluateMarketRegimeClassifier(input({
      vkospi: 17.9,
      foreignNetBuy4wTrend: 3000,
      kospiAbove200MA: true,
      dxyDirection: 'FLAT',
    }));
    expect(result.classification).toBe('RISK_ON_BULL');
  });

  it('VKOSPI 18 경계값 — bullSignal 하나 미충족', () => {
    // vkospi < 18 조건 미충족, 외국인 적음 → 3신호 미달 → RISK_ON_EARLY
    const result = evaluateMarketRegimeClassifier(input({
      vkospi: 18,
      foreignNetBuy4wTrend: 1000, // foreignBuying(>2000) 미충족
      kospiAbove200MA: true,
      dxyDirection: 'DOWN',
    }));
    // vkospi<18 false, foreignBuying false → 2 bull signals only → RISK_ON_EARLY
    expect(result.classification).toBe('RISK_ON_EARLY');
  });

  it('actionMessage에 Gate 2 완화 내용 포함', () => {
    const result = evaluateMarketRegimeClassifier(input({
      vkospi: 14,
      foreignNetBuy4wTrend: 5000,
      kospiAbove200MA: true,
      dxyDirection: 'DOWN',
    }));
    expect(result.actionMessage).toContain('Gate 2');
    expect(result.actionMessage).toContain('8');
  });
});

// ─── RISK_ON_EARLY 단위 테스트 ───────────────────────────────────────────────

describe('evaluateMarketRegimeClassifier — RISK_ON_EARLY', () => {
  it('기본 중립 환경 → RISK_ON_EARLY', () => {
    const result = evaluateMarketRegimeClassifier(input());
    expect(result.classification).toBe('RISK_ON_EARLY');
    expect(result.gate2RequiredOverride).toBeNull();
    expect(result.gate1Strengthened).toBe(false);
    expect(result.positionSizeLimitPct).toBe(100);
    expect(result.buyingHalted).toBe(false);
    expect(result.cashRatioMinPct).toBe(0);
  });

  it('VKOSPI 21 (ELEVATED 이하) + 외국인 소폭 순매수 → RISK_ON_EARLY', () => {
    const result = evaluateMarketRegimeClassifier(input({
      vkospi: 21,
      foreignNetBuy4wTrend: 500,
      kospiAbove200MA: true,
      dxyDirection: 'FLAT',
    }));
    expect(result.classification).toBe('RISK_ON_EARLY');
  });
});

// ─── 판정 우선순위 테스트 ─────────────────────────────────────────────────────

describe('evaluateMarketRegimeClassifier — 판정 우선순위', () => {
  it('CRISIS 조건 충족 시 다른 조건보다 우선 (CRISIS > CORRECTION)', () => {
    // VKOSPI 35 = CRISIS, 하지만 나머지 조건이 BULL처럼 보여도 CRISIS 우선
    const result = evaluateMarketRegimeClassifier(input({
      vkospi: 35,
      foreignNetBuy4wTrend: 10000,
      kospiAbove200MA: true,
      dxyDirection: 'DOWN',
    }));
    expect(result.classification).toBe('RISK_OFF_CRISIS');
  });

  it('CORRECTION 조건 충족 시 BULL보다 우선', () => {
    // VKOSPI 22 이상 → CORRECTION (외국인 매수가 아무리 강해도)
    const result = evaluateMarketRegimeClassifier(input({
      vkospi: 22,
      foreignNetBuy4wTrend: 10000,
      kospiAbove200MA: true,
      dxyDirection: 'DOWN',
    }));
    expect(result.classification).toBe('RISK_OFF_CORRECTION');
  });
});

// ─── 반환값 구조 완전성 테스트 ────────────────────────────────────────────────

describe('evaluateMarketRegimeClassifier — 반환값 구조', () => {
  it('모든 필드 반환됨 (null/undefined 없음)', () => {
    const result = evaluateMarketRegimeClassifier(input());
    expect(result.classification).toBeDefined();
    expect(result.gate1Strengthened).toBeDefined();
    expect(result.positionSizeLimitPct).toBeDefined();
    expect(result.buyingHalted).toBeDefined();
    expect(result.cashRatioMinPct).toBeDefined();
    expect(result.gate1BreachThreshold).toBeDefined();
    expect(result.inputs).toBeDefined();
    expect(result.description).toBeDefined();
    expect(result.actionMessage).toBeDefined();
    expect(result.lastUpdated).toBeDefined();
  });

  it('inputs 필드가 입력값을 그대로 반영함 (투명성)', () => {
    const inp = input({ vkospi: 18.5, foreignNetBuy4wTrend: 1234 });
    const result = evaluateMarketRegimeClassifier(inp);
    expect(result.inputs.vkospi).toBe(18.5);
    expect(result.inputs.foreignNetBuy4wTrend).toBe(1234);
  });

  it('lastUpdated가 ISO 8601 형식', () => {
    const result = evaluateMarketRegimeClassifier(input());
    expect(() => new Date(result.lastUpdated)).not.toThrow();
    expect(result.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
