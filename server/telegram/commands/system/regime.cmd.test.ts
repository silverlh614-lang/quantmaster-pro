/**
 * @responsibility regime.cmd formatUsdKrwLine SSOT 회귀 (ADR-0071)
 *
 * 사용자 보고 (2026-04-27): /regime 메시지 USD/KRW=1,380 표시되지만 실제 시장 1,474.
 * 본 PR 이후 출처(Yahoo/ECOS)와 격차 % 가 즉시 노출되어 운영자가 신뢰 문제 1초 인지.
 */
import { describe, expect, it } from 'vitest';

import { formatUsdKrwLine } from './regime.cmd';

describe('formatUsdKrwLine — USD/KRW 출처 + 격차 표시 (ADR-0071)', () => {
  it('AGREED + Yahoo (정상): "1,380 (Yahoo)"', () => {
    const line = formatUsdKrwLine({
      usdKrw: 1380,
      usdKrwSource: 'PRIMARY',
      usdKrwDivergenceTier: 'AGREED',
      usdKrwDivergencePct: 0.5,
    });
    expect(line).toBe('1,380 (Yahoo)');
  });

  it('AGREED + ECOS: "1,474 (ECOS)"', () => {
    const line = formatUsdKrwLine({
      usdKrw: 1474,
      usdKrwSource: 'SECONDARY',
      usdKrwDivergenceTier: 'AGREED',
      usdKrwDivergencePct: 0.1,
    });
    expect(line).toBe('1,474 (ECOS)');
  });

  it('CRITICAL 사용자 시나리오: ECOS 우선 + 격차 표시', () => {
    const line = formatUsdKrwLine({
      usdKrw: 1474,  // selected (ECOS, 정확)
      usdKrwSource: 'SECONDARY',
      usdKrwDivergenceTier: 'CRITICAL',
      usdKrwDivergencePct: 6.38,
    });
    expect(line).toContain('1,474');
    expect(line).toContain('ECOS');
    expect(line).toContain('❌');
    expect(line).toContain('6.38');
  });

  it('WARN: ⚠️ 마커 + 격차 % 표시', () => {
    const line = formatUsdKrwLine({
      usdKrw: 1450,
      usdKrwSource: 'SECONDARY',
      usdKrwDivergenceTier: 'WARN',
      usdKrwDivergencePct: 3.5,
    });
    expect(line).toContain('1,450');
    expect(line).toContain('⚠️');
    expect(line).toContain('3.50');
  });

  it('PRIMARY_ONLY: ECOS 미수집 표시', () => {
    const line = formatUsdKrwLine({
      usdKrw: 1380,
      usdKrwSource: 'PRIMARY',
      usdKrwDivergenceTier: 'PRIMARY_ONLY',
      usdKrwDivergencePct: null,
    });
    expect(line).toBe('1,380 (Yahoo·ECOS 미수집)');
  });

  it('SECONDARY_ONLY: Yahoo 미수집 표시', () => {
    const line = formatUsdKrwLine({
      usdKrw: 1474,
      usdKrwSource: 'SECONDARY',
      usdKrwDivergenceTier: 'SECONDARY_ONLY',
      usdKrwDivergencePct: null,
    });
    expect(line).toBe('1,474 (ECOS·Yahoo 미수집)');
  });

  it('데이터 부재: "N/A"', () => {
    expect(formatUsdKrwLine({})).toBe('N/A');
    expect(formatUsdKrwLine({ usdKrw: NaN as any })).toBe('N/A');
  });

  it('tier 부재 (마이그레이션 전 레거시 macroState): 단순 출처 표기', () => {
    // ADR-0071 이전 macroState 에는 usdKrwDivergenceTier 필드 없음 — 회귀 안전 fallback
    const line = formatUsdKrwLine({ usdKrw: 1380 });
    expect(line).toBe('1,380 (Yahoo)');  // tier 부재 시 default = Yahoo 표기
  });

  it('NO_DATA tier: 격차 계산 불가 표시', () => {
    const line = formatUsdKrwLine({
      usdKrw: 1380,
      usdKrwSource: 'PRIMARY',
      usdKrwDivergenceTier: 'NO_DATA',
      usdKrwDivergencePct: null,
    });
    expect(line).toContain('격차 계산 불가');
  });

  it('divergencePct null 이지만 tier=CRITICAL (이론상 분기): N/A 표기', () => {
    const line = formatUsdKrwLine({
      usdKrw: 1474,
      usdKrwSource: 'SECONDARY',
      usdKrwDivergenceTier: 'CRITICAL',
      usdKrwDivergencePct: null,
    });
    expect(line).toContain('격차 N/A');
  });
});

// ── ADR-0074: 매매 레짐 라인 (RegimeLevel R1~R6) ──────────────────────────
import { formatLiveRegimeLine } from './regime.cmd';
import type { RegimeLevel } from '../../../../src/types/core';

describe('formatLiveRegimeLine — 매매 레짐 SSOT 노출 (ADR-0074)', () => {
  it('R6_DEFENSE: reduced exposure + adjustment-only role + 최대 3포지션', () => {
    const line = formatLiveRegimeLine('R6_DEFENSE');
    expect(line).toContain('⚪');
    expect(line).toContain('R6_DEFENSE');
    expect(line).toContain('role=position policy + score adjustment only');
    expect(line).toContain('총노출 20%');
    expect(line).toContain('최대 3포지션');
    expect(line).not.toContain('Kelly');
    expect(line).not.toContain('매수 전면 차단');
  });

  it('R5_CAUTION: 🟡 + 총노출 20% + 최대 3포지션', () => {
    const line = formatLiveRegimeLine('R5_CAUTION');
    expect(line).toContain('🟡');
    expect(line).toContain('R5_CAUTION');
    expect(line).toContain('총노출 20%');
    expect(line).toContain('최대 3포지션');
  });

  it('R4_NEUTRAL: 🟠 + 총노출 40% + 최대 4포지션', () => {
    const line = formatLiveRegimeLine('R4_NEUTRAL');
    expect(line).toContain('🟠');
    expect(line).toContain('R4_NEUTRAL');
    expect(line).toContain('총노출 40%');
    expect(line).toContain('최대 4포지션');
  });

  it('R3_EARLY: 🌱 + 총노출 50% + 최대 5포지션', () => {
    const line = formatLiveRegimeLine('R3_EARLY');
    expect(line).toContain('🌱');
    expect(line).toContain('R3_EARLY');
    expect(line).toContain('총노출 50%');
    expect(line).toContain('최대 5포지션');
  });

  it('R2_BULL: 🟢 + 총노출 60% + 최대 6포지션', () => {
    const line = formatLiveRegimeLine('R2_BULL');
    expect(line).toContain('🟢');
    expect(line).toContain('R2_BULL');
    expect(line).toContain('총노출 60%');
    expect(line).toContain('최대 6포지션');
  });

  it('R1_TURBO: 🔥 + 총노출 80% + 최대 8포지션', () => {
    const line = formatLiveRegimeLine('R1_TURBO');
    expect(line).toContain('🔥');
    expect(line).toContain('R1_TURBO');
    expect(line).toContain('총노출 80%');
    expect(line).toContain('최대 8포지션');
  });

  it('형식 일관성: 모든 레짐이 "<emoji> 매매: <RegimeLevel>" 패턴 유지', () => {
    const regimes: RegimeLevel[] = ['R1_TURBO', 'R2_BULL', 'R3_EARLY', 'R4_NEUTRAL', 'R5_CAUTION', 'R6_DEFENSE'];
    for (const r of regimes) {
      const line = formatLiveRegimeLine(r);
      expect(line).toMatch(/매매: R[1-6]_/);
    }
  });
});

// ── ADR-0075 PR-4 wiring: 강세 섹터 라인 ──────────────────────────────────
import { formatSectorEnergyLine } from './regime.cmd';

describe('formatSectorEnergyLine — 강세/소외 섹터 노출 (ADR-0075 PR-4 wiring)', () => {
  it('sectorEnergyResult 부재 → "N/A (미수집)"', () => {
    expect(formatSectorEnergyLine({})).toBe('🎯 섹터 에너지: N/A (미수집)');
  });

  it('LEADING 0건 + LAGGING 0건 → "데이터 부족"', () => {
    const line = formatSectorEnergyLine({
      sectorEnergyResult: { leadingSectors: [], laggingSectors: [] },
    });
    expect(line).toBe('🎯 섹터 에너지: 데이터 부족');
  });

  it('LEADING 만 → "강세 섹터명들"', () => {
    const line = formatSectorEnergyLine({
      sectorEnergyResult: {
        leadingSectors: [{ name: '반도체' }, { name: '이차전지' }],
        laggingSectors: [],
      },
    });
    expect(line).toBe('🎯 강세 반도체, 이차전지');
  });

  it('LAGGING 만 → "소외 섹터명들"', () => {
    const line = formatSectorEnergyLine({
      sectorEnergyResult: {
        leadingSectors: [],
        laggingSectors: [{ name: '건설/부동산' }, { name: '유통/소비재' }],
      },
    });
    expect(line).toBe('🎯 소외 건설/부동산, 유통/소비재');
  });

  it('LEADING + LAGGING 둘 다 → 슬래시 구분', () => {
    const line = formatSectorEnergyLine({
      sectorEnergyResult: {
        leadingSectors: [{ name: '반도체' }, { name: '이차전지' }, { name: '바이오/헬스케어' }],
        laggingSectors: [{ name: '건설/부동산' }, { name: '유통/소비재' }],
      },
    });
    expect(line).toBe('🎯 강세 반도체, 이차전지, 바이오/헬스케어 / 소외 건설/부동산, 유통/소비재');
  });
});
