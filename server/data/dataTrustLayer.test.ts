// @responsibility ADR-0114 Data Trust Layer 3-tier 정책 SSOT 회귀 테스트
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DATA_TRUST_LAYER,
  assertDataTrustLayer,
  evaluateDataTrustViolation,
  getDataTrustCategory,
  getDataTrustTier,
  isDataTrustEnforcementDisabled,
  listAllTrustedSources,
  listAllTrustedUses,
} from './dataTrustLayer.js';

const ORIGINAL_ENV = process.env.DATA_TRUST_ENFORCEMENT_DISABLED;

beforeEach(() => {
  delete process.env.DATA_TRUST_ENFORCEMENT_DISABLED;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.DATA_TRUST_ENFORCEMENT_DISABLED;
  else process.env.DATA_TRUST_ENFORCEMENT_DISABLED = ORIGINAL_ENV;
});

describe('DATA_TRUST_LAYER SSOT — 3 tier 매트릭스', () => {
  it('TRUTH = tier 1, role=reconciliation_anchor', () => {
    expect(DATA_TRUST_LAYER.TRUTH.tier).toBe(1);
    expect(DATA_TRUST_LAYER.TRUTH.role).toBe('reconciliation_anchor');
  });
  it('INDICATOR = tier 2, role=derivation_input', () => {
    expect(DATA_TRUST_LAYER.INDICATOR.tier).toBe(2);
    expect(DATA_TRUST_LAYER.INDICATOR.role).toBe('derivation_input');
  });
  it('INTERPRETATION = tier 3, role=narrative_only', () => {
    expect(DATA_TRUST_LAYER.INTERPRETATION.tier).toBe(3);
    expect(DATA_TRUST_LAYER.INTERPRETATION.role).toBe('narrative_only');
  });
  it('TRUTH sources 4종 (KIS_REAL_QUOTE/KIS_DAILY/KRX_OPENAPI/DART_FILING)', () => {
    expect(DATA_TRUST_LAYER.TRUTH.sources).toEqual([
      'KIS_REAL_QUOTE', 'KIS_DAILY', 'KRX_OPENAPI', 'DART_FILING',
    ]);
  });
  it('INDICATOR sources 4종 (Yahoo + Naver + Google)', () => {
    expect(DATA_TRUST_LAYER.INDICATOR.sources).toEqual([
      'YAHOO_FINANCE', 'NAVER_MOBILE', 'NAVER_FINANCE', 'GOOGLE_SEARCH',
    ]);
  });
  it('INTERPRETATION sources = GEMINI_AI 단독', () => {
    expect(DATA_TRUST_LAYER.INTERPRETATION.sources).toEqual(['GEMINI_AI']);
  });
  it('TRUTH allowedUse — 모든 9 use 허용', () => {
    expect(DATA_TRUST_LAYER.TRUTH.allowedUse).toContain('LIVE_TRADING');
    expect(DATA_TRUST_LAYER.TRUTH.allowedUse).toContain('NARRATIVE');
    expect(DATA_TRUST_LAYER.TRUTH.allowedUse.length).toBe(9);
  });
  it('INDICATOR allowedUse — LIVE_TRADING / POSITION_RECONCILE / CORPORATE_ACTION 미허용', () => {
    const allowed = DATA_TRUST_LAYER.INDICATOR.allowedUse as readonly string[];
    expect(allowed).not.toContain('LIVE_TRADING');
    expect(allowed).not.toContain('POSITION_RECONCILE');
    expect(allowed).not.toContain('CORPORATE_ACTION');
    expect(allowed).toContain('SCREENING');
  });
  it('INTERPRETATION allowedUse — NARRATIVE/REFLECTION/PRE_MORTEM 만 허용 (3종)', () => {
    expect(DATA_TRUST_LAYER.INTERPRETATION.allowedUse).toEqual([
      'NARRATIVE', 'REFLECTION', 'PRE_MORTEM',
    ]);
  });
});

describe('getDataTrustTier — source → tier 매핑', () => {
  it('KIS_REAL_QUOTE → 1', () => {
    expect(getDataTrustTier('KIS_REAL_QUOTE')).toBe(1);
  });
  it('DART_FILING → 1', () => {
    expect(getDataTrustTier('DART_FILING')).toBe(1);
  });
  it('YAHOO_FINANCE → 2', () => {
    expect(getDataTrustTier('YAHOO_FINANCE')).toBe(2);
  });
  it('NAVER_MOBILE → 2', () => {
    expect(getDataTrustTier('NAVER_MOBILE')).toBe(2);
  });
  it('GEMINI_AI → 3', () => {
    expect(getDataTrustTier('GEMINI_AI')).toBe(3);
  });
  it('미등록 source → null', () => {
    expect(getDataTrustTier('BLOOMBERG')).toBeNull();
  });
  it('빈 문자열 → null', () => {
    expect(getDataTrustTier('')).toBeNull();
  });
});

describe('getDataTrustCategory', () => {
  it('KIS_REAL_QUOTE → TRUTH', () => {
    expect(getDataTrustCategory('KIS_REAL_QUOTE')).toBe('TRUTH');
  });
  it('YAHOO_FINANCE → INDICATOR', () => {
    expect(getDataTrustCategory('YAHOO_FINANCE')).toBe('INDICATOR');
  });
  it('GEMINI_AI → INTERPRETATION', () => {
    expect(getDataTrustCategory('GEMINI_AI')).toBe('INTERPRETATION');
  });
  it('미등록 → null', () => {
    expect(getDataTrustCategory('FOO')).toBeNull();
  });
});

describe('evaluateDataTrustViolation', () => {
  it('TRUTH × LIVE_TRADING → ok', () => {
    const r = evaluateDataTrustViolation('KIS_REAL_QUOTE', 'LIVE_TRADING');
    expect(r.ok).toBe(true);
    expect(r.tier).toBe(1);
    expect(r.category).toBe('TRUTH');
  });

  it('INDICATOR × SCREENING → ok', () => {
    const r = evaluateDataTrustViolation('YAHOO_FINANCE', 'SCREENING');
    expect(r.ok).toBe(true);
    expect(r.tier).toBe(2);
  });

  it('INDICATOR × LIVE_TRADING → 위반', () => {
    const r = evaluateDataTrustViolation('YAHOO_FINANCE', 'LIVE_TRADING');
    expect(r.ok).toBe(false);
    expect(r.tier).toBe(2);
    expect(r.category).toBe('INDICATOR');
    expect(r.reason).toMatch(/LIVE_TRADING/);
  });

  it('INTERPRETATION × LIVE_TRADING → 위반 (AI hallucination 차단)', () => {
    const r = evaluateDataTrustViolation('GEMINI_AI', 'LIVE_TRADING');
    expect(r.ok).toBe(false);
    expect(r.tier).toBe(3);
    expect(r.category).toBe('INTERPRETATION');
  });

  it('INTERPRETATION × SCREENING → 위반', () => {
    const r = evaluateDataTrustViolation('GEMINI_AI', 'SCREENING');
    expect(r.ok).toBe(false);
  });

  it('INTERPRETATION × NARRATIVE → ok', () => {
    const r = evaluateDataTrustViolation('GEMINI_AI', 'NARRATIVE');
    expect(r.ok).toBe(true);
  });

  it('미등록 source → unknown_source', () => {
    const r = evaluateDataTrustViolation('BLOOMBERG', 'LIVE_TRADING');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown_source');
  });

  it('TRUTH × CORPORATE_ACTION → ok (분할/병합 처리)', () => {
    const r = evaluateDataTrustViolation('DART_FILING', 'CORPORATE_ACTION');
    expect(r.ok).toBe(true);
  });

  it('INDICATOR × CORPORATE_ACTION → 위반 (Yahoo 가 corporate action 신호로 못 씀)', () => {
    const r = evaluateDataTrustViolation('YAHOO_FINANCE', 'CORPORATE_ACTION');
    expect(r.ok).toBe(false);
  });
});

describe('assertDataTrustLayer — enforcement', () => {
  it('TRUTH × LIVE_TRADING — 통과 (throw 안 함)', () => {
    expect(() => assertDataTrustLayer('KIS_REAL_QUOTE', 'LIVE_TRADING')).not.toThrow();
  });

  it('INDICATOR × LIVE_TRADING — throw', () => {
    expect(() => assertDataTrustLayer('YAHOO_FINANCE', 'LIVE_TRADING')).toThrow(
      /DataTrustLayer.*정책 위반/,
    );
  });

  it('INTERPRETATION × LIVE_TRADING — throw (가장 critical)', () => {
    expect(() => assertDataTrustLayer('GEMINI_AI', 'LIVE_TRADING')).toThrow();
  });

  it('INDICATOR × CHART_UI — 통과', () => {
    expect(() => assertDataTrustLayer('YAHOO_FINANCE', 'CHART_UI')).not.toThrow();
  });

  it('ENV DATA_TRUST_ENFORCEMENT_DISABLED=true — throw 대신 console.warn', () => {
    process.env.DATA_TRUST_ENFORCEMENT_DISABLED = 'true';
    let warned = '';
    const original = console.warn;
    console.warn = (msg: string) => { warned = msg; };
    try {
      expect(() => assertDataTrustLayer('YAHOO_FINANCE', 'LIVE_TRADING')).not.toThrow();
      expect(warned).toMatch(/DataTrustLayer/);
    } finally {
      console.warn = original;
    }
  });

  it('isDataTrustEnforcementDisabled — ENV 미설정 false', () => {
    expect(isDataTrustEnforcementDisabled()).toBe(false);
  });

  it('isDataTrustEnforcementDisabled — true 활성', () => {
    process.env.DATA_TRUST_ENFORCEMENT_DISABLED = 'true';
    expect(isDataTrustEnforcementDisabled()).toBe(true);
  });
});

describe('listAllTrustedSources / listAllTrustedUses', () => {
  it('listAllTrustedSources — 9종 (4+4+1)', () => {
    const all = listAllTrustedSources();
    expect(all.length).toBe(9);
    expect(all).toContain('KIS_REAL_QUOTE');
    expect(all).toContain('YAHOO_FINANCE');
    expect(all).toContain('GEMINI_AI');
  });

  it('listAllTrustedUses — 9 종 unique', () => {
    const all = listAllTrustedUses();
    expect(all.length).toBe(9);
    expect(all).toContain('LIVE_TRADING');
    expect(all).toContain('NARRATIVE');
    expect(all).toContain('CORPORATE_ACTION');
  });

  it('source 매트릭스 — 모든 source 가 정확히 1개 카테고리에', () => {
    const seen = new Set<string>();
    let dupes = 0;
    for (const entry of Object.values(DATA_TRUST_LAYER)) {
      for (const s of entry.sources) {
        if (seen.has(s)) dupes++;
        seen.add(s);
      }
    }
    expect(dupes).toBe(0);
  });
});
