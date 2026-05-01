/**
 * @responsibility ADR-0153 Phase 3 globalIntel 합성 회귀 — riskOnEnvironment / cycleVerified /
 * policyAlignment 임계 분기 + ctx 부재 fallback + 다수결 합성 검증.
 */
import { describe, it, expect } from 'vitest';
import {
  synthesizeRiskOnEnvironment,
  synthesizeCycleVerified,
  synthesizePolicyAlignment,
  synthesizeAllGlobalIntel,
  type GlobalIntelSynthesisCtx,
} from './globalIntelSynthesis';

describe('ADR-0153 — synthesizeRiskOnEnvironment (#5 임계 분기)', () => {
  it('ctx 빈 객체 → null (fallback)', () => {
    expect(synthesizeRiskOnEnvironment({})).toBeNull();
  });

  it('bearRegimeResult.defenseMode=true → 0 (시장 위험 회피)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      bearRegimeResult: { defenseMode: true } as any,
      macroEnv: { vkospi: 20 } as any,
      marketRegimeResult: { classification: 'RISK_ON_BULL' } as any,
    };
    expect(synthesizeRiskOnEnvironment(ctx)).toBe(0);
  });

  it('vkospi=20 + RISK_ON_BULL → 1', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: { vkospi: 20 } as any,
      marketRegimeResult: { classification: 'RISK_ON_BULL' } as any,
      bearRegimeResult: { defenseMode: false } as any,
    };
    expect(synthesizeRiskOnEnvironment(ctx)).toBe(1);
  });

  it('vkospi=20 + RISK_ON_EARLY → 1 (정상 진입)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: { vkospi: 20 } as any,
      marketRegimeResult: { classification: 'RISK_ON_EARLY' } as any,
      bearRegimeResult: { defenseMode: false } as any,
    };
    expect(synthesizeRiskOnEnvironment(ctx)).toBe(1);
  });

  it('vkospi=30 + RISK_ON_BULL → 0 (변동성 임계 미달)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: { vkospi: 30 } as any,
      marketRegimeResult: { classification: 'RISK_ON_BULL' } as any,
    };
    expect(synthesizeRiskOnEnvironment(ctx)).toBe(0);
  });

  it('vkospi=20 + RISK_OFF_CORRECTION → 0 (위험 회피 시장)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: { vkospi: 20 } as any,
      marketRegimeResult: { classification: 'RISK_OFF_CORRECTION' } as any,
    };
    expect(synthesizeRiskOnEnvironment(ctx)).toBe(0);
  });

  it('vkospi=24.99 boundary + RISK_ON_BULL → 1 (strict <)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: { vkospi: 24.99 } as any,
      marketRegimeResult: { classification: 'RISK_ON_BULL' } as any,
    };
    expect(synthesizeRiskOnEnvironment(ctx)).toBe(1);
  });

  it('vkospi=25 boundary → 0 (정확 25 미달, strict <)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: { vkospi: 25 } as any,
      marketRegimeResult: { classification: 'RISK_ON_BULL' } as any,
    };
    expect(synthesizeRiskOnEnvironment(ctx)).toBe(0);
  });

  it('vkospi=NaN → 0 (불충분 데이터)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: { vkospi: NaN } as any,
      marketRegimeResult: { classification: 'RISK_ON_BULL' } as any,
    };
    expect(synthesizeRiskOnEnvironment(ctx)).toBe(0);
  });
});

describe('ADR-0153 — synthesizeCycleVerified (#1 주도주 사이클)', () => {
  it('ctx 빈 객체 → null', () => {
    expect(synthesizeCycleVerified({})).toBeNull();
  });

  it('RISK_ON_BULL + leadingSectors 1개 → 1', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      marketRegimeResult: { classification: 'RISK_ON_BULL' } as any,
      sectorEnergyResult: { leadingSectors: [{ sector: 'tech' }] } as any,
    };
    expect(synthesizeCycleVerified(ctx)).toBe(1);
  });

  it('RISK_ON_EARLY + leadingSectors 1개 → 1 (정상 진입)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      marketRegimeResult: { classification: 'RISK_ON_EARLY' } as any,
      sectorEnergyResult: { leadingSectors: [{ sector: 'bio' }] } as any,
    };
    expect(synthesizeCycleVerified(ctx)).toBe(1);
  });

  it('RISK_ON_BULL + leadingSectors 0개 → 0 (주도 섹터 부재)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      marketRegimeResult: { classification: 'RISK_ON_BULL' } as any,
      sectorEnergyResult: { leadingSectors: [] } as any,
    };
    expect(synthesizeCycleVerified(ctx)).toBe(0);
  });

  it('RISK_OFF_CRISIS + leadingSectors 1개 → 0 (위기 시장)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      marketRegimeResult: { classification: 'RISK_OFF_CRISIS' } as any,
      sectorEnergyResult: { leadingSectors: [{ sector: 'tech' }] } as any,
    };
    expect(synthesizeCycleVerified(ctx)).toBe(0);
  });

  it('marketRegime 부재 + leadingSectors 1개 → 0 (강세 미확인)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      sectorEnergyResult: { leadingSectors: [{ sector: 'tech' }] } as any,
    };
    expect(synthesizeCycleVerified(ctx)).toBe(0);
  });
});

describe('ADR-0153 — synthesizePolicyAlignment (#16 다수결 ≥ 2)', () => {
  it('macroEnv 부재 → null', () => {
    expect(synthesizePolicyAlignment({})).toBeNull();
  });

  it('3 조건 모두 충족 → 1 (HOLDING/CUTTING + GDP+ + CLI≥100)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: {
        bokRateDirection: 'HOLDING',
        nominalGdpGrowth: 3.5,
        oeciCliKorea: 100.5,
      } as any,
    };
    expect(synthesizePolicyAlignment(ctx)).toBe(1);
  });

  it('2 조건 충족 (HOLDING + GDP+, CLI<100) → 1 (다수결)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: {
        bokRateDirection: 'HOLDING',
        nominalGdpGrowth: 3.5,
        oeciCliKorea: 99,
      } as any,
    };
    expect(synthesizePolicyAlignment(ctx)).toBe(1);
  });

  it('CUTTING + 2 조건 충족 → 1', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: {
        bokRateDirection: 'CUTTING',
        nominalGdpGrowth: 0,
        oeciCliKorea: 100.1,
      } as any,
    };
    expect(synthesizePolicyAlignment(ctx)).toBe(1);
  });

  it('1 조건만 충족 (HOLDING, 나머지 미달) → 0', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: {
        bokRateDirection: 'HOLDING',
        nominalGdpGrowth: -1,
        oeciCliKorea: 95,
      } as any,
    };
    expect(synthesizePolicyAlignment(ctx)).toBe(0);
  });

  it('HIKING + 0 조건 → 0', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: {
        bokRateDirection: 'HIKING',
        nominalGdpGrowth: -2,
        oeciCliKorea: 92,
      } as any,
    };
    expect(synthesizePolicyAlignment(ctx)).toBe(0);
  });

  it('boundary CLI=100 → 충족 (>= 100)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: {
        bokRateDirection: 'HIKING',  // 0
        nominalGdpGrowth: -1,         // 0
        oeciCliKorea: 100,            // 1
      } as any,
    };
    // 1 조건 충족 → 0 (다수결 < 2)
    expect(synthesizePolicyAlignment(ctx)).toBe(0);
  });

  it('boundary GDP=0 → 미충족 (strict >)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: {
        bokRateDirection: 'HOLDING',  // 1
        nominalGdpGrowth: 0,           // 0 (정확 0 미달)
        oeciCliKorea: 99,              // 0
      } as any,
    };
    // 1 조건 충족 → 0
    expect(synthesizePolicyAlignment(ctx)).toBe(0);
  });

  it('NaN/Infinity 안전 fallback → 0 처리', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: {
        bokRateDirection: 'HIKING',
        nominalGdpGrowth: NaN,
        oeciCliKorea: Infinity,
      } as any,
    };
    expect(synthesizePolicyAlignment(ctx)).toBe(0);
  });
});

describe('ADR-0153 — synthesizeAllGlobalIntel 진단 헬퍼', () => {
  it('3 키 동시 산출 (전체 ctx 가용)', () => {
    const ctx: GlobalIntelSynthesisCtx = {
      macroEnv: {
        vkospi: 18,
        bokRateDirection: 'CUTTING',
        nominalGdpGrowth: 4,
        oeciCliKorea: 102,
      } as any,
      bearRegimeResult: { defenseMode: false } as any,
      marketRegimeResult: { classification: 'RISK_ON_BULL' } as any,
      sectorEnergyResult: { leadingSectors: [{ sector: 'tech' }] } as any,
    };
    const result = synthesizeAllGlobalIntel(ctx);
    expect(result.riskOnEnvironment).toBe(1);
    expect(result.cycleVerified).toBe(1);
    expect(result.policyAlignment).toBe(1);
  });

  it('빈 ctx → 3 키 모두 null', () => {
    const result = synthesizeAllGlobalIntel({});
    expect(result.riskOnEnvironment).toBeNull();
    expect(result.cycleVerified).toBeNull();
    expect(result.policyAlignment).toBeNull();
  });
});
