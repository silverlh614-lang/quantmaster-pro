// @responsibility ADR-0570 배선 효과 회귀 — sectorReturn20d 배선 시 Gate2 sectorCycle MISSING→OK + 불변식.
import { describe, it, expect } from 'vitest';
import { evaluateSectorEnergy } from '../../src/services/quant/sectorEnergyEngine.js';
import { normalizeSectorThemeCycleForGate2 } from './sectorThemeLeaderCycleNormalizer.js';
import type { SectorEnergyInput } from '../../src/types/sectorEnergy.js';

const BASE_INPUTS: SectorEnergyInput[] = [
  { name: '반도체', return4w: 3, volumeChangePct: 10, foreignConcentration: 60 },
  { name: '자동차', return4w: 1, volumeChangePct: 5, foreignConcentration: 40 },
  { name: '금융', return4w: -1, volumeChangePct: 2, foreignConcentration: 30 },
];

describe('ADR-0570 배선 효과: sectorReturn20d → Gate2 sectorCycle', () => {
  it('미배선(byte-equal): scores[].sectorReturn20d 부재 → normalizer 가 return4w 로 보강 (기존 동작)', () => {
    const result = evaluateSectorEnergy(BASE_INPUTS, 6);
    const semi = result.scores.find((s) => s.name === '반도체');
    // 미배선이면 sectorReturn20d 필드 자체가 없음 (byte-equal).
    expect(semi?.sectorReturn20d).toBeUndefined();
  });

  it('배선(sectorReturn20d 주입): scores[].sectorReturn20d 살아남 → normalizer sectorReturn20d 획득 → OK_WITH_DATA', () => {
    const wired: SectorEnergyInput[] = BASE_INPUTS.map((inp) =>
      inp.name === '반도체' ? { ...inp, sectorReturn20d: 7.5, sectorReturn5d: 2.1 } : inp,
    );
    const result = evaluateSectorEnergy(wired, 6);
    const semi = result.scores.find((s) => s.name === '반도체');
    expect(semi?.sectorReturn20d).toBe(7.5);

    const cycle = normalizeSectorThemeCycleForGate2({
      symbol: '005930',
      quote: { sector: '반도체', return20d: 9.0 },
      sectorEnergyResult: result,
    });
    expect(cycle.sectorReturn20d).toBe(7.5);
    // sector + stockReturn20d + sectorReturn20d 모두 present → OK_WITH_DATA (MISSING 해소).
    expect(cycle.providerStatus).toBe('OK_WITH_DATA');
  });

  it('불변식 #6: 배선 후에도 marketSignal=false (provider 결손/섹터 약세가 bearish 로 변환 0)', () => {
    const wired: SectorEnergyInput[] = BASE_INPUTS.map((inp) =>
      inp.name === '반도체' ? { ...inp, sectorReturn20d: -8.0 } : inp,
    );
    const result = evaluateSectorEnergy(wired, 6);
    const cycle = normalizeSectorThemeCycleForGate2({
      symbol: '005930',
      quote: { sector: '반도체', return20d: -5 },
      sectorEnergyResult: result,
    });
    expect(cycle.marketSignal).toBe(false);
  });

  it('UNKNOWN 종목(sector 매칭 부재): sectorReturn20d 배선돼도 그 종목은 여전히 MISSING (분류 SSOT 별건)', () => {
    const wired: SectorEnergyInput[] = BASE_INPUTS.map((inp) =>
      inp.name === '반도체' ? { ...inp, sectorReturn20d: 7.5 } : inp,
    );
    const result = evaluateSectorEnergy(wired, 6);
    const cycle = normalizeSectorThemeCycleForGate2({
      symbol: '999999',
      quote: { return20d: 1 }, // sector 미상
      sectorEnergyResult: result,
    });
    expect(cycle.sector).toBeNull();
    // sector 부재 → FIELD_MISSING (sectorReturn20d 배선과 무관, 분류 SSOT 별건).
    expect(cycle.providerStatus).toBe('FIELD_MISSING');
  });
});
