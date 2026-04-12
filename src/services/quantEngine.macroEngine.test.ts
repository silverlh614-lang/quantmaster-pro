import { describe, expect, it } from 'vitest';
import { evaluateGate0, getRegimeConfig, evaluateMAPCResult, evaluateNikkeiLeadAlpha } from './quant/macroEngine';
import type { MacroEnvironment } from '../types/macro';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function createMacroEnv(partial: Partial<MacroEnvironment> = {}): MacroEnvironment {
  return {
    bokRateDirection: 'HOLDING',
    us10yYield: 4.1,
    krUsSpread: -0.5,
    m2GrowthYoY: 4.0,
    bankLendingGrowth: 3.2,
    nominalGdpGrowth: 3.0,
    oeciCliKorea: 99.5,
    exportGrowth3mAvg: 1.5,
    vkospi: 18,
    samsungIri: 1.1,
    vix: 16,
    usdKrw: 1320,
    ...partial,
  };
}

// ─── evaluateGate0 — 레짐 분류 ────────────────────────────────────────────────

describe('evaluateGate0 — 레짐 분류', () => {
  it('BULL 환경: MHS ≥ 70 → passed=true, mhsLevel=HIGH', () => {
    const env = createMacroEnv({
      bokRateDirection: 'CUTTING',   // +5 이자
      us10yYield: 3.5,               // 임계값 미달 → 페널티 없음
      krUsSpread: 0.5,               // 역전 없음
      m2GrowthYoY: 6.0,             // > nominalGdp → +10 유동성
      nominalGdpGrowth: 3.0,
      bankLendingGrowth: 5.5,        // > 5 → +3
      oeciCliKorea: 102,             // > 101 → +5
      exportGrowth3mAvg: 8.0,        // > 5 → +5
      vkospi: 16,                    // < 20 CALM → 패널티 없음
      vix: 14,                       // < 20 → 패널티 없음
      samsungIri: 1.1,               // >= 0.7 → 패널티 없음
    });
    const result = evaluateGate0(env);
    expect(result.passed).toBe(true);
    expect(result.mhsLevel).toBe('HIGH');
    expect(result.macroHealthScore).toBeGreaterThanOrEqual(70);
    expect(result.buyingHalted).toBe(false);
    expect(result.tradeRegime).toBe('BULL_AGGRESSIVE');
    expect(result.rateCycle).toBe('EASING');
  });

  it('NEUTRAL 환경: MHS 50~69 → mhsLevel=MEDIUM, tradeRegime=BULL_NORMAL', () => {
    // HIKING -10, us10y=4.3 → interest=10
    // m2=4 > gdp=3 → +10 유동성 → liq=25
    // oeciCli=100.5 → eco=15
    // vkospi=22 > 20 CALM → -6 risk=19
    // total = 10+25+15+19 = 69 (MEDIUM)
    const env = createMacroEnv({
      bokRateDirection: 'HIKING',
      us10yYield: 4.3,
      krUsSpread: -0.5,
      m2GrowthYoY: 4.0,
      nominalGdpGrowth: 3.0,
      bankLendingGrowth: 3.0,
      oeciCliKorea: 100.5,
      exportGrowth3mAvg: 3.0,
      vkospi: 22,
      vix: 18,
      samsungIri: 0.8,
      usdKrw: 1320,
    });
    const result = evaluateGate0(env);
    expect(result.mhsLevel).toBe('MEDIUM');
    expect(result.macroHealthScore).toBeGreaterThanOrEqual(50);
    expect(result.macroHealthScore).toBeLessThan(70);
    expect(result.tradeRegime).toBe('BULL_NORMAL');
    expect(result.passed).toBe(true);
    expect(result.buyingHalted).toBe(false);
  });

  it('DEFENSE 환경: MHS < 30 → passed=false, buyingHalted=true, tradeRegime=DEFENSE', () => {
    const env = createMacroEnv({
      bokRateDirection: 'HIKING',
      us10yYield: 5.0,
      krUsSpread: -1.5,
      m2GrowthYoY: 1.0,
      nominalGdpGrowth: 3.0,
      bankLendingGrowth: -2,
      oeciCliKorea: 97,
      exportGrowth3mAvg: -10,
      vkospi: 40,
      vix: 32,
      samsungIri: 0.5,
    });
    const result = evaluateGate0(env);
    expect(result.passed).toBe(false);
    expect(result.buyingHalted).toBe(true);
    expect(result.mhsLevel).toBe('LOW');
    expect(result.macroHealthScore).toBeLessThan(30);
    expect(result.tradeRegime).toBe('DEFENSE');
  });

  it('FX 레짐 — DOLLAR_STRONG: usdKrw ≥ 1350', () => {
    const env = createMacroEnv({ usdKrw: 1360 });
    const result = evaluateGate0(env);
    expect(result.fxRegime).toBe('DOLLAR_STRONG');
  });

  it('FX 레짐 — DOLLAR_WEAK: usdKrw ≤ 1280', () => {
    const env = createMacroEnv({ usdKrw: 1270 });
    const result = evaluateGate0(env);
    expect(result.fxRegime).toBe('DOLLAR_WEAK');
  });

  it('FX 레짐 — NEUTRAL: 1280 < usdKrw < 1350', () => {
    const env = createMacroEnv({ usdKrw: 1320 });
    const result = evaluateGate0(env);
    expect(result.fxRegime).toBe('NEUTRAL');
  });

  it('금리 사이클 — TIGHTENING: bokRateDirection=HIKING', () => {
    const env = createMacroEnv({ bokRateDirection: 'HIKING' });
    const result = evaluateGate0(env);
    expect(result.rateCycle).toBe('TIGHTENING');
  });

  it('금리 사이클 — EASING: bokRateDirection=CUTTING', () => {
    const env = createMacroEnv({ bokRateDirection: 'CUTTING' });
    const result = evaluateGate0(env);
    expect(result.rateCycle).toBe('EASING');
  });

  it('금리 사이클 — PAUSE: bokRateDirection=HOLDING', () => {
    const env = createMacroEnv({ bokRateDirection: 'HOLDING' });
    const result = evaluateGate0(env);
    expect(result.rateCycle).toBe('PAUSE');
  });

  it('details 4개 축 점수가 각각 0-25 범위', () => {
    const env = createMacroEnv();
    const result = evaluateGate0(env);
    const { interestRateScore, liquidityScore, economicScore, riskScore } = result.details;
    [interestRateScore, liquidityScore, economicScore, riskScore].forEach((s) => {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(25);
    });
  });

  it('macroHealthScore = 4개 축 합계', () => {
    const env = createMacroEnv();
    const result = evaluateGate0(env);
    const { interestRateScore, liquidityScore, economicScore, riskScore } = result.details;
    expect(result.macroHealthScore).toBe(
      interestRateScore + liquidityScore + economicScore + riskScore
    );
  });

  it('VKOSPI < 20이면서 MHS ≥ 70 → BULL_AGGRESSIVE', () => {
    const env = createMacroEnv({
      bokRateDirection: 'CUTTING',
      m2GrowthYoY: 6.0,
      nominalGdpGrowth: 3.0,
      bankLendingGrowth: 5.5,
      oeciCliKorea: 102,
      exportGrowth3mAvg: 8.0,
      vkospi: 15,
      vix: 14,
      samsungIri: 1.1,
    });
    const result = evaluateGate0(env);
    expect(result.tradeRegime).toBe('BULL_AGGRESSIVE');
  });

  it('VKOSPI ≥ 20이면서 MHS ≥ 70 → BULL_NORMAL (VKOSPI 조건 미충족)', () => {
    const env = createMacroEnv({
      bokRateDirection: 'CUTTING',
      m2GrowthYoY: 6.0,
      nominalGdpGrowth: 3.0,
      bankLendingGrowth: 5.5,
      oeciCliKorea: 102,
      exportGrowth3mAvg: 8.0,
      vkospi: 21,
      vix: 14,
      samsungIri: 1.1,
    });
    const result = evaluateGate0(env);
    expect(result.tradeRegime).toBe('BULL_NORMAL');
  });
});

// ─── evaluateGate0 — 경계값 테스트 ──────────────────────────────────────────

describe('evaluateGate0 — 경계값', () => {
  it('US10Y 임계값 (4.5%): 초과 시 금리축 -5점', () => {
    const below = createMacroEnv({ us10yYield: 4.4 });
    const above = createMacroEnv({ us10yYield: 4.6 });
    const rBelow = evaluateGate0(below);
    const rAbove = evaluateGate0(above);
    expect(rAbove.details.interestRateScore).toBe(rBelow.details.interestRateScore - 5);
  });

  it('KR-US 스프레드 역전 (-1.0 미만): -5점 적용', () => {
    const ok = createMacroEnv({ krUsSpread: -0.9 });
    const inverted = createMacroEnv({ krUsSpread: -1.1 });
    const rOk = evaluateGate0(ok);
    const rInv = evaluateGate0(inverted);
    expect(rInv.details.interestRateScore).toBe(rOk.details.interestRateScore - 5);
  });

  it('VKOSPI > 25 (ELEVATED): 리스크축 -12점', () => {
    const calm = createMacroEnv({ vkospi: 19 });
    const elevated = createMacroEnv({ vkospi: 26 });
    const rCalm = evaluateGate0(calm);
    const rElevated = evaluateGate0(elevated);
    expect(rElevated.details.riskScore).toBe(rCalm.details.riskScore - 12);
  });

  it('VIX > 30 (FEAR): 리스크축 -10점', () => {
    const calm = createMacroEnv({ vkospi: 19, vix: 15 });
    const fear  = createMacroEnv({ vkospi: 19, vix: 31 });
    const rCalm = evaluateGate0(calm);
    const rFear = evaluateGate0(fear);
    expect(rFear.details.riskScore).toBe(rCalm.details.riskScore - 10);
  });

  it('samsungIri < 0.7: 리스크축 -5점', () => {
    const ok  = createMacroEnv({ vkospi: 19, vix: 15, samsungIri: 0.7 });
    const bad = createMacroEnv({ vkospi: 19, vix: 15, samsungIri: 0.6 });
    const rOk  = evaluateGate0(ok);
    const rBad = evaluateGate0(bad);
    expect(rBad.details.riskScore).toBe(rOk.details.riskScore - 5);
  });
});

// ─── getRegimeConfig ──────────────────────────────────────────────────────────

describe('getRegimeConfig — 레짐별 Gate·Kelly 설정', () => {
  it('MHS ≥ 70 + VKOSPI < 20 → BULL_AGGRESSIVE 설정 (gate2PassCount=7)', () => {
    const cfg = getRegimeConfig(75, 15);
    expect(cfg.gate2PassCount).toBe(7);
    expect(cfg.gate3PassCount).toBe(5);
    expect(cfg.maxPositionKelly).toBe(1.0);
    expect(cfg.allowedSignals).toContain('WATCH');
  });

  it('MHS ≥ 70 + VKOSPI ≥ 20 → BULL_NORMAL 설정 (gate2PassCount=8)', () => {
    const cfg = getRegimeConfig(72, 22);
    expect(cfg.gate2PassCount).toBe(8);
    expect(cfg.gate3PassCount).toBe(6);
    expect(cfg.maxPositionKelly).toBe(0.7);
    expect(cfg.allowedSignals).not.toContain('WATCH');
  });

  it('MHS 50~69 → BULL_NORMAL 설정', () => {
    const cfg = getRegimeConfig(55, 28);
    expect(cfg.gate2PassCount).toBe(8);
    expect(cfg.maxPositionKelly).toBe(0.7);
  });

  it('MHS 30~49 → NEUTRAL 설정 (gate2PassCount=9, Kelly=0.5)', () => {
    const cfg = getRegimeConfig(40, 25);
    expect(cfg.gate2PassCount).toBe(9);
    expect(cfg.gate3PassCount).toBe(7);
    expect(cfg.maxPositionKelly).toBe(0.5);
    expect(cfg.allowedSignals).not.toContain('BUY');
  });

  it('MHS < 30 → DEFENSE 설정 (allowedSignals=[], maxPositionKelly=0)', () => {
    const cfg = getRegimeConfig(25, 30);
    expect(cfg.allowedSignals).toHaveLength(0);
    expect(cfg.maxPositionKelly).toBe(0);
    // gate 조건이 사실상 통과 불가
    expect(cfg.gate2PassCount).toBeGreaterThanOrEqual(99);
    expect(cfg.gate3PassCount).toBeGreaterThanOrEqual(99);
  });

  it('MHS=0 → DEFENSE 설정', () => {
    const cfg = getRegimeConfig(0, 40);
    expect(cfg.maxPositionKelly).toBe(0);
    expect(cfg.allowedSignals).toHaveLength(0);
  });
});

// ─── evaluateMAPCResult ───────────────────────────────────────────────────────

describe('evaluateMAPCResult — MAPC 포지션 자동 조절기', () => {
  it('BULL 환경: adjustedKellyPct = baseKellyPct × (MHS/100)', () => {
    const env = createMacroEnv({
      bokRateDirection: 'CUTTING',
      m2GrowthYoY: 6.0,
      nominalGdpGrowth: 3.0,
      bankLendingGrowth: 5.5,
      oeciCliKorea: 102,
      exportGrowth3mAvg: 8.0,
      vkospi: 16,
      vix: 14,
      samsungIri: 1.1,
    });
    const gate0 = evaluateGate0(env);
    const result = evaluateMAPCResult(gate0, env, 10);
    const expectedKelly = +(10 * (gate0.macroHealthScore / 100)).toFixed(2);
    expect(result.adjustedKellyPct).toBe(expectedKelly);
    expect(result.alert).toBe('GREEN');
    expect(result.buyingHalted).toBe(false);
  });

  it('DEFENSE 환경: adjustedKellyPct = 0 (전면 매수 중단)', () => {
    const env = createMacroEnv({
      bokRateDirection: 'HIKING',
      us10yYield: 5.0,
      krUsSpread: -1.5,
      m2GrowthYoY: 1.0,
      nominalGdpGrowth: 3.0,
      bankLendingGrowth: -2,
      oeciCliKorea: 97,
      exportGrowth3mAvg: -10,
      vkospi: 40,
      vix: 32,
      samsungIri: 0.5,
    });
    const gate0 = evaluateGate0(env);
    const result = evaluateMAPCResult(gate0, env, 10);
    expect(result.adjustedKellyPct).toBe(0);
    expect(result.buyingHalted).toBe(true);
    expect(result.alert).toBe('RED');
  });

  it('factors 배열에 4개 축 포함', () => {
    const env = createMacroEnv();
    const gate0 = evaluateGate0(env);
    const result = evaluateMAPCResult(gate0, env, 10);
    expect(result.factors).toHaveLength(4);
    const ids = result.factors.map((f) => f.id);
    expect(ids).toContain('interest');
    expect(ids).toContain('liquidity');
    expect(ids).toContain('economy');
    expect(ids).toContain('risk');
  });

  it('reductionAmt = baseKellyPct - adjustedKellyPct', () => {
    const env = createMacroEnv({
      bokRateDirection: 'HIKING',
      m2GrowthYoY: 4.0,
      nominalGdpGrowth: 3.0,
      vkospi: 22,
      vix: 18,
    });
    const gate0 = evaluateGate0(env);
    const result = evaluateMAPCResult(gate0, env, 20);
    expect(result.reductionAmt).toBeCloseTo(result.baseKellyPct - result.adjustedKellyPct, 2);
  });

  it('baseKellyPct=0 → adjustedKellyPct=0 (분모 0 방지)', () => {
    const env = createMacroEnv();
    const gate0 = evaluateGate0(env);
    const result = evaluateMAPCResult(gate0, env, 0);
    expect(result.adjustedKellyPct).toBe(0);
    expect(result.reductionPct).toBe(0);
  });

  it('MEDIUM 환경(MHS 50~69): alert=YELLOW', () => {
    const env = createMacroEnv({
      bokRateDirection: 'HIKING',
      us10yYield: 4.3,
      krUsSpread: -0.5,
      m2GrowthYoY: 4.0,
      nominalGdpGrowth: 3.0,
      bankLendingGrowth: 3.0,
      oeciCliKorea: 100.5,
      exportGrowth3mAvg: 3.0,
      vkospi: 22,
      vix: 18,
      samsungIri: 0.8,
      usdKrw: 1320,
    });
    const gate0 = evaluateGate0(env);
    const result = evaluateMAPCResult(gate0, env, 10);
    expect(result.alert).toBe('YELLOW');
  });

  it('snapshot 필드가 env 값과 일치', () => {
    const env = createMacroEnv({ bokRateDirection: 'CUTTING', usdKrw: 1380, vix: 25, vkospi: 28 });
    const gate0 = evaluateGate0(env);
    const result = evaluateMAPCResult(gate0, env, 5);
    expect(result.snapshot.usdKrw).toBe(1380);
    expect(result.snapshot.vix).toBe(25);
    expect(result.snapshot.vkospi).toBe(28);
    expect(result.snapshot.bokRate).toBe('CUTTING');
  });
});

describe('evaluateNikkeiLeadAlpha — 닛케이 5분봉 선행 알파', () => {
  it('닛케이 방산 상승을 KOSPI 방산 이론 GAP으로 환산한다', () => {
    const result = evaluateNikkeiLeadAlpha({
      collectedAt: '2026-04-12T23:30:00.000Z',
      nikkeiSectorStrengths: [{ sector: 'defense', changePct: 3.0 }],
    });

    expect(result.collectionTimeKst).toBe('08:30');
    expect(result.alertTimeKst).toBe('09:00');
    expect(result.predictiveConfidencePct).toBeGreaterThanOrEqual(90);
    expect(result.gapResults).toHaveLength(1);
    expect(result.gapResults[0].kospiSector).toBe('K-방산');
    expect(result.gapResults[0].theoreticalGapPct).toBe(2.46);
    expect(result.alertLevel).toBe('HIGH');
    expect(result.summary).toContain('KOSPI K-방산');
  });

  it('매칭되지 않는 닛케이 섹터는 unmatchedNikkeiSectors에 기록한다', () => {
    const result = evaluateNikkeiLeadAlpha({
      nikkeiSectorStrengths: [{ sector: 'RETAIL', changePct: 1.2 }],
    });

    expect(result.gapResults).toHaveLength(0);
    expect(result.unmatchedNikkeiSectors).toEqual(['RETAIL']);
    expect(result.alertLevel).toBe('LOW');
  });

  it('여러 섹터 입력 시 절대 GAP 기준으로 정렬된다', () => {
    const result = evaluateNikkeiLeadAlpha({
      nikkeiSectorStrengths: [
        { sector: 'bank', changePct: -1.0 },
        { sector: 'semiconductor', changePct: 1.5 },
      ],
    });

    expect(result.gapResults).toHaveLength(2);
    expect(result.gapResults[0].nikkeiSector).toBe('SEMICONDUCTOR');
    expect(Math.abs(result.gapResults[0].theoreticalGapPct)).toBeGreaterThanOrEqual(
      Math.abs(result.gapResults[1].theoreticalGapPct)
    );
  });
});
