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
