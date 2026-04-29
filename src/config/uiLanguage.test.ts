/**
 * @responsibility UI_LANG SSOT 단위 회귀 (ADR-0094)
 *
 * 검증 항목:
 * 1) UI_LANG 7 카테고리 모두 export
 * 2) 각 카테고리 키가 비어있지 않은 string
 * 3) tier 5-tier (VERIFIED/EXTERNAL/DELAYED/ESTIMATED/MANUAL) 정합
 * 4) regime 6 RegimeLevel (R1~R6) 정합
 * 5) gate 4 단계 (0/1/2/3) 정합
 * 6) empty 4 sub-variant (DELAYED/INSUFFICIENT/STALE/CONFLICTED) 정합
 * 7) UILangKeys 타입 export
 * 8) 본 SSOT 자기 자신은 금지 표현 안 가짐 (메타) — 검증 스크립트 의도와 정합
 */
import { describe, it, expect } from 'vitest';
import { UI_LANG, type UILangKeys, type UILangCategory } from './uiLanguage';

describe('UI_LANG SSOT', () => {
  it('7 카테고리 모두 export (nav/card/tier/regime/gate/empty/action)', () => {
    expect(UI_LANG.nav).toBeDefined();
    expect(UI_LANG.card).toBeDefined();
    expect(UI_LANG.tier).toBeDefined();
    expect(UI_LANG.regime).toBeDefined();
    expect(UI_LANG.gate).toBeDefined();
    expect(UI_LANG.empty).toBeDefined();
    expect(UI_LANG.action).toBeDefined();
  });

  it('모든 카테고리의 모든 값이 비어있지 않은 string', () => {
    const categories = Object.keys(UI_LANG) as UILangCategory[];
    for (const cat of categories) {
      const entries = Object.entries(UI_LANG[cat]);
      expect(entries.length).toBeGreaterThan(0);
      for (const [key, value] of entries) {
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
        expect(value.trim()).toBe(value); // 좌우 공백 금지
        // 키 자체도 비어있지 않은 string
        expect(typeof key).toBe('string');
        expect(key.length).toBeGreaterThan(0);
      }
    }
  });

  it('tier 5-tier 정합 (VERIFIED/EXTERNAL/DELAYED/ESTIMATED/MANUAL)', () => {
    expect(UI_LANG.tier.VERIFIED).toBe('실측');
    expect(UI_LANG.tier.EXTERNAL).toBe('API 수신');
    expect(UI_LANG.tier.DELAYED).toBe('지연 데이터');
    expect(UI_LANG.tier.ESTIMATED).toBe('AI 추정');
    expect(UI_LANG.tier.MANUAL).toBe('수동 입력');
    expect(Object.keys(UI_LANG.tier).length).toBe(5);
  });

  it('regime 6 RegimeLevel (R1~R6) 정합', () => {
    const expected = ['R1_TURBO', 'R2_BULL', 'R3_EARLY', 'R4_NEUTRAL', 'R5_CAUTION', 'R6_DEFENSE'];
    const actual = Object.keys(UI_LANG.regime);
    expect(actual.sort()).toEqual(expected.sort());
    expect(actual.length).toBe(6);
  });

  it('gate 4 단계 (0/1/2/3) 정합', () => {
    const expected = ['GATE_0', 'GATE_1', 'GATE_2', 'GATE_3'];
    const actual = Object.keys(UI_LANG.gate);
    expect(actual.sort()).toEqual(expected.sort());
    expect(actual.length).toBe(4);
  });

  it('empty 4 sub-variant (DELAYED/INSUFFICIENT/STALE/CONFLICTED)', () => {
    const expected = ['DELAYED', 'INSUFFICIENT', 'STALE', 'CONFLICTED'];
    const actual = Object.keys(UI_LANG.empty);
    expect(actual.sort()).toEqual(expected.sort());
    expect(actual.length).toBe(4);
  });

  it('UILangKeys 타입 — UI_LANG 의 typeof 정합', () => {
    // 타입 레벨 검증 — runtime 에서는 UI_LANG 인스턴스의 카테고리 키만 확인
    const sample: keyof UILangKeys = 'nav';
    expect(UI_LANG[sample]).toBeDefined();
  });

  it('SSOT 자체는 금지 표현 안 가짐 (메타 검증)', () => {
    // 화이트리스트 외 코드에서 차단되는 표현이 SSOT 안에는 *값* 으로 등장하지 않아야 함.
    // (uiLanguage.ts 는 ALLOWED_FILES 라 검증 스크립트가 통과시키지만, 정책 정의 본체는
    // 깨끗하게 유지하는 것이 메타 정합.)
    const FORBIDDEN = ['완벽한', '강력한', '확실한', '대박', '엄청난', 'AI 가 분석', 'AI 추천', '반드시', '베스트'];
    const allValues: string[] = [];
    const cats = Object.keys(UI_LANG) as UILangCategory[];
    for (const cat of cats) {
      for (const v of Object.values(UI_LANG[cat])) {
        allValues.push(v);
      }
    }
    for (const term of FORBIDDEN) {
      const found = allValues.filter((v) => v.includes(term));
      expect(found, `"${term}" 가 SSOT 값에 등장: ${found.join(' / ')}`).toEqual([]);
    }
  });
});
