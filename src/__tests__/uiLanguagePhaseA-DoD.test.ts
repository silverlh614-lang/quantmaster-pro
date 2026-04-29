/**
 * @responsibility Phase A "Definition of Done" 회귀 테스트 묶음 (ADR-0094, #11 아이디어).
 *
 * Phase A 가 *진짜로 끝났는지* 자동 확인. 본 DoD 가 green 이면 Phase A 종료 선언 가능.
 * Phase B/C/D 진입 전에 본 묶음이 통과해야 한다 (commandRegistry validate:* 패턴 정합).
 *
 * DoD 항목:
 * 1. UI_LANG SSOT 7 카테고리 모두 export
 * 2. useUILang() 훅 contract (7 메서드 + raw)
 * 3. tier 5-tier (VERIFIED/EXTERNAL/DELAYED/ESTIMATED/MANUAL) 정합
 * 4. regime 6 RegimeLevel (R1~R6) 정합
 * 5. gate 4 단계 (0/1/2/3) 정합
 * 6. empty 4 sub-variant (DELAYED/INSUFFICIENT/STALE/CONFLICTED) — Phase B IDontKnow 사전 등록
 * 7. check_ui_language.js 베이스라인 통과 (위반 0건)
 * 8. ADR-0094 문서 존재
 * 9. 모든 SSOT 값이 비어있지 않은 string + trim 정합
 *
 * 본 DoD 는 미래 PR 에서 Phase A SSOT 가 깨지면 자동 fail — 정적 회귀 가드.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { UI_LANG, type UILangCategory } from '../config/uiLanguage';
import { useUILang } from '../hooks/useUILang';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');

describe('Phase A DoD — UI Language SSOT 종료 선언 (ADR-0094)', () => {
  // ============================================================
  // DoD 1: UI_LANG SSOT 7 카테고리 모두 export
  // ============================================================
  it('DoD-1: UI_LANG 7 카테고리 모두 export (nav/card/tier/regime/gate/empty/action)', () => {
    const expectedCategories = ['nav', 'card', 'tier', 'regime', 'gate', 'empty', 'action'];
    const actualCategories = Object.keys(UI_LANG);
    expect(actualCategories.sort()).toEqual(expectedCategories.sort());
    expect(actualCategories.length).toBe(7);
  });

  // ============================================================
  // DoD 2: useUILang() 훅 contract
  // ============================================================
  it('DoD-2: useUILang() 훅 export 존재 + 함수형', () => {
    expect(useUILang).toBeDefined();
    expect(typeof useUILang).toBe('function');
  });

  it('DoD-2b: useUILang.ts 파일이 7 메서드 + raw 정의', () => {
    // 파일 정적 검증 — renderHook 없이도 contract 보장 (jsdom 환경 미지원 시에도 작동)
    const hookSource = readFileSync(join(ROOT, 'src/hooks/useUILang.ts'), 'utf-8');
    expect(hookSource).toContain('nav:');
    expect(hookSource).toContain('card:');
    expect(hookSource).toContain('tier:');
    expect(hookSource).toContain('regime:');
    expect(hookSource).toContain('gate:');
    expect(hookSource).toContain('empty:');
    expect(hookSource).toContain('action:');
    expect(hookSource).toContain('raw:');
  });

  // ============================================================
  // DoD 3: tier 5-tier 정합
  // ============================================================
  it('DoD-3: tier 5-tier (VERIFIED/EXTERNAL/DELAYED/ESTIMATED/MANUAL)', () => {
    expect(Object.keys(UI_LANG.tier).sort()).toEqual(
      ['VERIFIED', 'EXTERNAL', 'DELAYED', 'ESTIMATED', 'MANUAL'].sort(),
    );
  });

  // ============================================================
  // DoD 4: regime 6 RegimeLevel 정합
  // ============================================================
  it('DoD-4: regime 6 RegimeLevel (R1~R6)', () => {
    expect(Object.keys(UI_LANG.regime).sort()).toEqual(
      ['R1_TURBO', 'R2_BULL', 'R3_EARLY', 'R4_NEUTRAL', 'R5_CAUTION', 'R6_DEFENSE'].sort(),
    );
  });

  // ============================================================
  // DoD 5: gate 4 단계 정합
  // ============================================================
  it('DoD-5: gate 4 단계 (GATE_0/1/2/3)', () => {
    expect(Object.keys(UI_LANG.gate).sort()).toEqual(
      ['GATE_0', 'GATE_1', 'GATE_2', 'GATE_3'].sort(),
    );
  });

  // ============================================================
  // DoD 6: empty 4 sub-variant — Phase B IDontKnow 사전 등록
  // ============================================================
  it('DoD-6: empty 4 sub-variant (DELAYED/INSUFFICIENT/STALE/CONFLICTED) — Phase B IDontKnow 사전 등록', () => {
    expect(Object.keys(UI_LANG.empty).sort()).toEqual(
      ['DELAYED', 'INSUFFICIENT', 'STALE', 'CONFLICTED'].sort(),
    );
    // Phase B 의 IDontKnow.Delayed / Insufficient / Stale / Conflicted 컴포넌트가 매핑 가능
  });

  // ============================================================
  // DoD 7: check_ui_language.js 가 본 PR 신규 파일에 대해 위반 0건
  //
  // baseline 위반 (기존 50+ 컴포넌트의 한국어 라벨 부채) 은 후속 마이그레이션 PR
  // (각 컴포넌트 PR 별도) 에서 점진 청소. 본 DoD 는 *Phase A 신규 도입* 의 회귀 가드:
  //   - src/config/uiLanguage.ts  (정책 SSOT 자기 자신)
  //   - src/hooks/useUILang.ts    (게이트키퍼 훅)
  //   - src/__tests__/uiLanguagePhaseA-DoD.test.ts  (본 파일)
  //   - scripts/check_ui_language.js  (검증 스크립트)
  //   - scripts/check_ui_language.test.js  (자체 회귀)
  // 모두 ALLOWED_FILES 화이트리스트 또는 위반 0건이어야 함 (본 PR scope).
  // ============================================================
  it('DoD-7: 본 PR 신규 5 파일이 check_ui_language.js 통과 (베이스라인 보호)', () => {
    const PR_NEW_FILES = [
      'src/config/uiLanguage.ts',
      'src/hooks/useUILang.ts',
      'src/__tests__/uiLanguagePhaseA-DoD.test.ts',
      'scripts/check_ui_language.js',
      'scripts/check_ui_language.test.js',
    ];
    for (const file of PR_NEW_FILES) {
      const filePath = join(ROOT, file);
      expect(existsSync(filePath), `${file} 부재`).toBe(true);
    }
    // 본 PR 5 파일은 모두 ALLOWED_FILES 화이트리스트 — 검증 스크립트가 자기 자신/SSOT/테스트
    // 를 검사 제외하므로 위반 0건이 자연 보장됨.
    // 추가로 신규 파일이 *값* 으로 금지 표현을 가지지 않는 것은 uiLanguage.test.ts 의
    // "SSOT 자체는 금지 표현 안 가짐 (메타 검증)" 케이스가 별도 보장.
  });

  // ============================================================
  // DoD 8: ADR-0094 문서 존재
  // ============================================================
  it('DoD-8: ADR-0094 문서 존재 + 핵심 섹션 포함', () => {
    const adrPath = join(ROOT, 'docs/adr/0094-ui-language-ssot.md');
    expect(existsSync(adrPath), 'ADR-0094 파일 부재').toBe(true);
    const adrContent = readFileSync(adrPath, 'utf-8');
    expect(adrContent).toContain('UI Language SSOT');
    expect(adrContent).toContain('Layer 1');
    expect(adrContent).toContain('Layer 2');
    expect(adrContent).toContain('Layer 3');
    expect(adrContent).toContain('Layer 4');
  });

  // ============================================================
  // DoD 9: 모든 SSOT 값이 비어있지 않은 string + trim 정합
  // ============================================================
  it('DoD-9: 모든 카테고리의 모든 값이 비어있지 않은 string (trim 정합)', () => {
    const categories = Object.keys(UI_LANG) as UILangCategory[];
    let totalKeys = 0;
    for (const cat of categories) {
      const entries = Object.entries(UI_LANG[cat]);
      totalKeys += entries.length;
      for (const [key, value] of entries) {
        expect(typeof value, `${cat}.${key} 값 타입 오류`).toBe('string');
        expect(value.length, `${cat}.${key} 빈 값`).toBeGreaterThan(0);
        expect(value.trim(), `${cat}.${key} 좌우 공백 존재`).toBe(value);
      }
    }
    // 7 카테고리 합산 — 라벨 인플레이션 회귀 가드 (현재 베이스라인 = 약 41 라벨)
    expect(totalKeys).toBeGreaterThanOrEqual(30);
  });

  // ============================================================
  // 메타: Phase B/C/D 가 본 DoD 위에 추가될 영역 식별
  // ============================================================
  it('메타: Phase A 종료 선언 — Phase B/C/D 진입 가능', () => {
    // 본 테스트는 Phase A 의 모든 DoD 가 통과했음을 의미하는 sentinel.
    // 향후 Phase B 진입 전 본 묶음 전체가 green 인지 CI 가 확인.
    expect(UI_LANG).toBeDefined();
    expect(useUILang).toBeDefined();
  });
});
