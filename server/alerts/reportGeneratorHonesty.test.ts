// @responsibility 리포트 정직성 마킹 회귀 — provider 글리치/저신뢰 매크로를 사실처럼 표시 금지.
import { describe, it, expect, vi } from 'vitest';

// reportGenerator 는 import 시 다수 영속/네트워크 모듈을 끌어오므로 순수 헬퍼 테스트용으로 mock.
vi.mock('./telegramClient.js', () => ({ sendTelegramAlert: vi.fn() }));
vi.mock('../clients/geminiClient.js', () => ({ callGemini: vi.fn() }));

import {
  formatQuoteAnomalyTag,
  formatMacroConfidenceTag,
  resolveKospiDisplay,
  resolveUsdKrwDisplay,
} from './reportGenerator.js';

describe('formatQuoteAnomalyTag — provider 글리치 의심 변동률 마킹', () => {
  it('2026-06-09 KOSPI +8.18% (Yahoo ^KS11 글리치) → 이례적 변동 마킹', () => {
    expect(formatQuoteAnomalyTag(8.18, 'INDEX')).toContain('이례적 변동');
  });

  it('USD/KRW -2.50% 은 크지만 현실적 → 미마킹 (FX 경계 3%)', () => {
    expect(formatQuoteAnomalyTag(-2.5, 'FX')).toBe('');
  });

  it('정상 지수 변동(+1.2%)은 byte-equivalent(빈 문자열)', () => {
    expect(formatQuoteAnomalyTag(1.2, 'INDEX')).toBe('');
  });

  it('FX 경계 — |3%| 이상이면 마킹', () => {
    expect(formatQuoteAnomalyTag(3.0, 'FX')).toContain('이례적');
    expect(formatQuoteAnomalyTag(2.99, 'FX')).toBe('');
  });

  it('지수 경계 — |8%| 이상이면 마킹', () => {
    expect(formatQuoteAnomalyTag(-8.0, 'INDEX')).toContain('이례적');
    expect(formatQuoteAnomalyTag(7.99, 'INDEX')).toBe('');
  });

  it('null/NaN → 빈 문자열 (N/A 분기에서 별도 처리)', () => {
    expect(formatQuoteAnomalyTag(null, 'INDEX')).toBe('');
    expect(formatQuoteAnomalyTag(undefined, 'FX')).toBe('');
    expect(formatQuoteAnomalyTag(NaN, 'INDEX')).toBe('');
  });
});

describe('formatMacroConfidenceTag — 저신뢰 매크로 스냅샷 마킹 (ADR-0583)', () => {
  it('mhsConfidence=PARTIAL (= scan_blockers MISSING_OR_PARTIAL) → 저신뢰 마킹', () => {
    expect(formatMacroConfidenceTag({ mhsConfidence: 'PARTIAL' })).toContain('저신뢰(PARTIAL)');
  });

  it('mhsConfidence=FALLBACK → 저신뢰 마킹', () => {
    expect(formatMacroConfidenceTag({ mhsConfidence: 'FALLBACK' })).toContain('저신뢰(FALLBACK)');
  });

  it('mhsDegraded=true (confidence 미상) → DEGRADED 마킹', () => {
    expect(formatMacroConfidenceTag({ mhsDegraded: true })).toContain('저신뢰(DEGRADED)');
  });

  it('mhsConfidence=FULL → byte-equivalent(빈 문자열)', () => {
    expect(formatMacroConfidenceTag({ mhsConfidence: 'FULL', mhsDegraded: false })).toBe('');
  });

  it('macro=null → 빈 문자열', () => {
    expect(formatMacroConfidenceTag(null)).toBe('');
  });
});

describe('resolveKospiDisplay — KIS(L1) primary, Yahoo(L3) 최후 fallback (ADR-0561)', () => {
  it('KIS 유효 → KIS 종가/변동률 사용 (Yahoo 무시)', () => {
    const out = resolveKospiDisplay({ current: 2710.5, changePct: 0.83 }, { price: 8096.93, changePct: 8.18 });
    expect(out).toEqual({ price: 2710.5, changePct: 0.83 });
  });

  it('KIS null(flag OFF/실패) → Yahoo fallback', () => {
    expect(resolveKospiDisplay(null, { price: 2700, changePct: 1.1 })).toEqual({ price: 2700, changePct: 1.1 });
  });

  it('KIS current<=0/NaN → Yahoo fallback', () => {
    expect(resolveKospiDisplay({ current: 0, changePct: 0 }, { price: 2700, changePct: 1.1 })).toEqual({ price: 2700, changePct: 1.1 });
  });

  it('둘 다 무효 → null', () => {
    expect(resolveKospiDisplay(null, null)).toBeNull();
    expect(resolveKospiDisplay(null, { price: 0, changePct: 0 })).toBeNull();
  });
});

describe('resolveUsdKrwDisplay — cross-validated macroState primary, Yahoo fallback (ADR-0071)', () => {
  it('macroState rate 유효 → macroState 사용', () => {
    expect(resolveUsdKrwDisplay(1365.2, -0.4, { rate: 1516, changePct: -2.5 })).toEqual({ rate: 1365.2, changePct: -0.4 });
  });

  it('macroDayChange 미상 → changePct 0', () => {
    expect(resolveUsdKrwDisplay(1365.2, undefined, null)).toEqual({ rate: 1365.2, changePct: 0 });
  });

  it('macroRate 부재 → Yahoo fallback', () => {
    expect(resolveUsdKrwDisplay(undefined, undefined, { rate: 1365, changePct: 0.2 })).toEqual({ rate: 1365, changePct: 0.2 });
  });

  it('둘 다 무효 → null', () => {
    expect(resolveUsdKrwDisplay(undefined, undefined, null)).toBeNull();
    expect(resolveUsdKrwDisplay(0, 0, null)).toBeNull();
  });
});
