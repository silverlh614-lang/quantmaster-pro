import { describe, expect, it } from 'vitest';
import { evaluateSectorOverheat } from './quant/sectorEngine';
import type { SectorOverheatInput } from '../types/quant';

describe('Sector overheat detection', () => {
  it('does not mark sector as overheated when only 3 of 4 conditions are met', () => {
    const inputs: SectorOverheatInput[] = [
      {
        name: '반도체',
        sectorRsRank: 0.5,
        newsPhase: 'CROWDED',
        weeklyRsi: 82,
        foreignActiveBuyingWeeks: 5,
      },
    ];

    const result = evaluateSectorOverheat(inputs);

    expect(result.overheatedCount).toBe(0);
    expect(result.overheatedMatches).toHaveLength(0);
    expect(result.allSectors[0].isFullyOverheated).toBe(false);
    expect(result.allSectors[0].triggeredCount).toBe(3);
  });

  it('auto-matches inverse ETF when all 4 overheat conditions are met', () => {
    const inputs: SectorOverheatInput[] = [
      {
        name: '이차전지',
        sectorRsRank: 0.8,
        newsPhase: 'OVERHYPED',
        weeklyRsi: 84,
        foreignActiveBuyingWeeks: 6,
      },
    ];

    const result = evaluateSectorOverheat(inputs);

    expect(result.overheatedCount).toBe(1);
    expect(result.overheatedMatches).toHaveLength(1);
    expect(result.overheatedMatches[0].sectorName).toBe('이차전지');
    expect(result.overheatedMatches[0].inverseEtf).toContain('TIGER 2차전지TOP10 인버스');
    expect(result.overheatedMatches[0].inverseEtfCode).toBe('400810');
    expect(result.overheatedMatches[0].isFullyOverheated).toBe(true);
  });

  it('keeps fallback inverse ETF text for unmapped sectors when fully overheated', () => {
    const inputs: SectorOverheatInput[] = [
      {
        name: '바이오',
        sectorRsRank: 0.4,
        newsPhase: 'OVERHYPED',
        weeklyRsi: 90,
        foreignActiveBuyingWeeks: 8,
      },
    ];

    const result = evaluateSectorOverheat(inputs);

    expect(result.overheatedCount).toBe(1);
    expect(result.overheatedMatches[0].inverseEtf).toBe('바이오 인버스 ETF (수동 확인 필요)');
    expect(result.overheatedMatches[0].inverseEtfCode).toBe('-');
  });
});
