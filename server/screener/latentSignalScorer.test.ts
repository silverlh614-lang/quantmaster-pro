/**
 * @responsibility latentSignalScorer 회귀 테스트 (ADR-0030 PR-N 페어 D)
 */
import { describe, it, expect } from 'vitest';
import {
  computeVcpScore,
  computeLatentCatalystScore,
  combinedSignalGrade,
  VCP_RS_THRESHOLD,
  LATENT_CATALYST_THRESHOLD,
  WEAK_SIGNAL_THRESHOLD,
} from './latentSignalScorer.js';

// ─── VCP Score ───────────────────────────────────────────────────────────────

describe('computeVcpScore — 4 sub-criteria 분기', () => {
  const baseInput = {
    atr5w: 100, atr3w: 80, atr1w: 50,        // 단조감소 OK
    vol5w: 1000, vol3w: 800, vol1w: 500,     // 단조감소 OK
    relativeStrength: 85,                     // ≥ 80 OK
    priceMa200Ratio: 1.05,                    // > 1.0 OK
  };

  it('4조건 모두 충족 → A 등급 (100점)', () => {
    const r = computeVcpScore(baseInput);
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
    expect(r.atrContracting).toBe(true);
    expect(r.volumeDrying).toBe(true);
    expect(r.strongRs).toBe(true);
    expect(r.aboveMa200).toBe(true);
  });

  it('3조건 충족 (RS 미달) → B 등급 (75점)', () => {
    const r = computeVcpScore({ ...baseInput, relativeStrength: 79 });
    expect(r.score).toBe(75);
    expect(r.grade).toBe('B');
    expect(r.strongRs).toBe(false);
  });

  it('2조건 충족 → C 등급 (50점)', () => {
    const r = computeVcpScore({
      ...baseInput,
      relativeStrength: 50,    // 미달
      priceMa200Ratio: 0.95,   // MA200 아래
    });
    expect(r.score).toBe(50);
    expect(r.grade).toBe('C');
  });

  it('0조건 → NONE (0점)', () => {
    const r = computeVcpScore({
      atr5w: 100, atr3w: 110, atr1w: 120, // 단조증가 (실패)
      vol5w: 100, vol3w: 200, vol1w: 300, // 단조증가 (실패)
      relativeStrength: 50,
      priceMa200Ratio: 0.9,
    });
    expect(r.score).toBe(0);
    expect(r.grade).toBe('NONE');
  });

  it('ATR 단조감소 boundary — 동일값은 false', () => {
    const r = computeVcpScore({ ...baseInput, atr5w: 100, atr3w: 100, atr1w: 50 });
    expect(r.atrContracting).toBe(false); // 100 > 100 false
  });

  it('RS 정확히 80 → strongRs true (≥ 80)', () => {
    const r = computeVcpScore({ ...baseInput, relativeStrength: VCP_RS_THRESHOLD });
    expect(r.strongRs).toBe(true);
  });

  it('priceMa200Ratio 정확히 1.0 → aboveMa200 false (> 1.0 strict)', () => {
    const r = computeVcpScore({ ...baseInput, priceMa200Ratio: 1.0 });
    expect(r.aboveMa200).toBe(false);
  });

  it('NaN/0/음수 ATR → 안전 fallback (false)', () => {
    const r = computeVcpScore({
      ...baseInput, atr5w: NaN, atr3w: 0, atr1w: -1,
    });
    expect(r.atrContracting).toBe(false);
  });
});

// ─── Latent Catalyst Score ───────────────────────────────────────────────────

describe('computeLatentCatalystScore', () => {
  it('강한 4축 신호 → LATENT_CATALYST (≥ +1.5)', () => {
    // foreign 2.0 + institutional 2.0 + volume 8/10*2=1.6 - volatility -1.0 (정상화)
    // = (2 + 2 + 1.6 - (-1.0)) / 4 = 6.6/4 = 1.65
    const r = computeLatentCatalystScore({
      foreignNetBuy5dZ: 2.0,
      institutionalNetBuy5dZ: 2.0,
      volumeProgression: 8,
      volatility5dZ: -1.0, // 음수 → 변동성 정상화
    });
    expect(r.score).toBeCloseTo(1.65, 2);
    expect(r.tag).toBe('LATENT_CATALYST');
  });

  it('중간 신호 → WEAK_SIGNAL', () => {
    // (1 + 1 + 0.4 - 0) / 4 = 0.6
    const r = computeLatentCatalystScore({
      foreignNetBuy5dZ: 1.0,
      institutionalNetBuy5dZ: 1.0,
      volumeProgression: 2,
      volatility5dZ: 0,
    });
    expect(r.score).toBeCloseTo(0.6, 2);
    expect(r.tag).toBe('WEAK_SIGNAL');
  });

  it('약한 신호 → NONE', () => {
    const r = computeLatentCatalystScore({
      foreignNetBuy5dZ: 0,
      institutionalNetBuy5dZ: 0,
      volumeProgression: 0,
      volatility5dZ: 0,
    });
    expect(r.score).toBe(0);
    expect(r.tag).toBe('NONE');
  });

  it('boundary +1.5 정확 → LATENT_CATALYST', () => {
    // raw = 1.5 정확 → ≥ 1.5
    const r = computeLatentCatalystScore({
      foreignNetBuy5dZ: 3.0,
      institutionalNetBuy5dZ: 3.0,
      volumeProgression: 0,
      volatility5dZ: 0,
    });
    // (3 + 3 + 0 - 0) / 4 = 1.5
    expect(r.score).toBe(LATENT_CATALYST_THRESHOLD);
    expect(r.tag).toBe('LATENT_CATALYST');
  });

  it('boundary +0.5 정확 → WEAK_SIGNAL', () => {
    const r = computeLatentCatalystScore({
      foreignNetBuy5dZ: 1.0,
      institutionalNetBuy5dZ: 1.0,
      volumeProgression: 0,
      volatility5dZ: 0,
    });
    expect(r.score).toBe(WEAK_SIGNAL_THRESHOLD);
    expect(r.tag).toBe('WEAK_SIGNAL');
  });

  it('변동성 부호 역전 — volatility5dZ 가 음수면 +기여', () => {
    const noVolatility = computeLatentCatalystScore({
      foreignNetBuy5dZ: 1.0,
      institutionalNetBuy5dZ: 1.0,
      volumeProgression: 0,
      volatility5dZ: 0,
    });
    const calmedVolatility = computeLatentCatalystScore({
      foreignNetBuy5dZ: 1.0,
      institutionalNetBuy5dZ: 1.0,
      volumeProgression: 0,
      volatility5dZ: -2.0,
    });
    expect(calmedVolatility.score).toBeGreaterThan(noVolatility.score);
    expect(calmedVolatility.components.volatilityContribution).toBe(2.0);
  });

  it('NaN/Infinity 입력 → 0 fallback', () => {
    const r = computeLatentCatalystScore({
      foreignNetBuy5dZ: NaN,
      institutionalNetBuy5dZ: Infinity,
      volumeProgression: NaN,
      volatility5dZ: -Infinity,
    });
    expect(r.score).toBe(0);
    expect(r.tag).toBe('NONE');
    expect(Object.values(r.components).every(v => Number.isFinite(v))).toBe(true);
  });

  it('sub-component 분해 정확성', () => {
    const r = computeLatentCatalystScore({
      foreignNetBuy5dZ: 1.0,
      institutionalNetBuy5dZ: 2.0,
      volumeProgression: 5, // 5/10*2 = 1.0
      volatility5dZ: -0.5,  // -(-0.5) = 0.5
    });
    expect(r.components.foreignContribution).toBe(1.0);
    expect(r.components.institutionalContribution).toBe(2.0);
    expect(r.components.volumeContribution).toBe(1.0);
    expect(r.components.volatilityContribution).toBe(0.5);
  });
});

// ─── combinedSignalGrade ─────────────────────────────────────────────────────

describe('combinedSignalGrade — 4 등급 분기', () => {
  it('VCP A + Latent CATALYST → STRONG_PRE_BREAKOUT', () => {
    const r = combinedSignalGrade(
      { score: 100, atrContracting: true, volumeDrying: true, strongRs: true, aboveMa200: true, grade: 'A' },
      { score: 1.8, tag: 'LATENT_CATALYST', components: { foreignContribution: 0, institutionalContribution: 0, volumeContribution: 0, volatilityContribution: 0 } },
    );
    expect(r.combined).toBe('STRONG_PRE_BREAKOUT');
  });

  it('VCP A 단독 → PRE_BREAKOUT', () => {
    const r = combinedSignalGrade(
      { score: 100, atrContracting: true, volumeDrying: true, strongRs: true, aboveMa200: true, grade: 'A' },
      { score: 0.3, tag: 'NONE', components: { foreignContribution: 0, institutionalContribution: 0, volumeContribution: 0, volatilityContribution: 0 } },
    );
    expect(r.combined).toBe('PRE_BREAKOUT');
  });

  it('Latent CATALYST 단독 → PRE_BREAKOUT', () => {
    const r = combinedSignalGrade(
      { score: 50, atrContracting: false, volumeDrying: true, strongRs: false, aboveMa200: true, grade: 'C' },
      { score: 1.6, tag: 'LATENT_CATALYST', components: { foreignContribution: 0, institutionalContribution: 0, volumeContribution: 0, volatilityContribution: 0 } },
    );
    expect(r.combined).toBe('PRE_BREAKOUT');
  });

  it('VCP B/C 또는 WEAK_SIGNAL → WATCH', () => {
    const r1 = combinedSignalGrade(
      { score: 75, atrContracting: true, volumeDrying: true, strongRs: true, aboveMa200: false, grade: 'B' },
      { score: 0.3, tag: 'NONE', components: { foreignContribution: 0, institutionalContribution: 0, volumeContribution: 0, volatilityContribution: 0 } },
    );
    expect(r1.combined).toBe('WATCH');

    const r2 = combinedSignalGrade(
      { score: 0, atrContracting: false, volumeDrying: false, strongRs: false, aboveMa200: false, grade: 'NONE' },
      { score: 0.7, tag: 'WEAK_SIGNAL', components: { foreignContribution: 0, institutionalContribution: 0, volumeContribution: 0, volatilityContribution: 0 } },
    );
    expect(r2.combined).toBe('WATCH');
  });

  it('VCP NONE + Latent NONE → NONE', () => {
    const r = combinedSignalGrade(
      { score: 0, atrContracting: false, volumeDrying: false, strongRs: false, aboveMa200: false, grade: 'NONE' },
      { score: 0.1, tag: 'NONE', components: { foreignContribution: 0, institutionalContribution: 0, volumeContribution: 0, volatilityContribution: 0 } },
    );
    expect(r.combined).toBe('NONE');
  });
});
