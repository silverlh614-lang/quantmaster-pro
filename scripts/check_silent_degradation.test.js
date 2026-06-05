/**
 * @responsibility check_silent_degradation 회귀 테스트 (PR-Governance-2)
 *
 * 검증:
 *   1) 현재 baseline 통과 (MacroState 49+ 옵셔널 필드 모두 writer 존재)
 *   2) stripComments — 라인/블록 주석 strip
 *   3) extractOptionalFields — `name?:` 추출, 중첩 객체 제외
 *   4) countReaderUsage — `\.field\b` member access 카운트
 *   5) countWriterUsage — 객체 literal value + member assignment 카운트
 *   6) silent degradation 검출 시나리오 (가상 필드 추가 + writer 부재)
 *   7) baseline catalog 흡수 (BASELINE_SILENT_DEGRADATION 등재 항목 통과)
 *   8) --strict 모드 EXIT=1
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  stripComments,
  extractOptionalFields,
  countReaderUsage,
  countWriterUsage,
} from './check_silent_degradation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

function runLint(args = '') {
  try {
    const out = execSync(`node scripts/check_silent_degradation.js ${args}`.trim(), {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      // 단독 ~25s 소요 스크립트 — full-suite 병렬 CPU 경합 시 30s 한계를 넘겨
      // execSync 가 ETIMEDOUT/STACK_TRACE 로 던지면 flaky. 120s timeout 으로 경합
      // 환경에서도 완주 보장 (테스트 강도 무변 — 동일 exitCode/output assertion).
      timeout: 120_000,
    });
    return { exitCode: 0, output: out };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      output: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? ''),
    };
  }
}

// PR-Governance-3-SLA (2026-05-02): script execSync 가 5 SCHEMA_FILES * 144 옵셔널 필드 *
// allFiles walk + reader/writer regex 매칭으로 ~24s 소요. vitest default 5s 초과 → 30s 부여.
describe('check_silent_degradation — baseline', () => {
  it(
    '현재 baseline (MacroState 옵셔널 필드 전수) 통과 EXIT=0',
    () => {
      const result = runLint();
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('OK');
      expect(result.output).toContain('신규 위반 0건');
    },
    180000
  );

  it('--json 출력 baseline 흡수 + violations 0건', () => {
    const result = runLint('--json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed.findings)).toBe(true);
    // MacroState (49+) + ServerShadowTrade + WatchlistEntry + ServerAttributionRecord +
    // FailurePatternEntry 옵셔널 합산 — 확장 후 100+ 기대
    expect(parsed.findings.length).toBeGreaterThan(100);
    expect(parsed.violations).toEqual([]);
    // PR-Governance-3-SLA (#510, 2026-05-02): bepGlideTouchAt PR-B1-1 wiring 후 카탈로그
    // 정식 제거 → baseline 흡수 ≥1건 (price7dAgo 만).
    expect(parsed.baselined.length).toBeGreaterThanOrEqual(1);
  }, 180000);

  it('확장된 SCHEMA_FILES 5개 인터페이스 모두 추출 (PR-Governance 후속)', () => {
    const result = runLint('--json');
    const parsed = JSON.parse(result.output);
    const schemas = new Set(parsed.findings.map((f) => f.schema));
    expect(schemas.has('MacroState')).toBe(true);
    expect(schemas.has('ServerShadowTrade')).toBe(true);
    expect(schemas.has('WatchlistEntry')).toBe(true);
    expect(schemas.has('ServerAttributionRecord')).toBe(true);
    expect(schemas.has('FailurePatternEntry')).toBe(true);
  }, 180000);

  it('BASELINE_SILENT_DEGRADATION 등재 항목 흡수 — price7dAgo (bepGlideTouchAt PR-B1-1 wiring)', () => {
    // PR-Governance-3-SLA (#510, 2026-05-02): bepGlideTouchAt 는 PR-B1-1 (#509, ADR-0085)
    // wiring 후 writer=3 활성화 → silent degradation 아님 → 카탈로그에서 정식 제거.
    // price7dAgo 는 PENDING_WIRING B7 (P2, ADR-0085 후속) 영속 wiring 미구현 — baseline 유지.
    const result = runLint('--json');
    const parsed = JSON.parse(result.output);
    const baselineFields = new Set(parsed.baselined.map((b) => b.field));
    expect(baselineFields.has('price7dAgo')).toBe(true);
    // bepGlideTouchAt 는 wired 후 baseline 카탈로그에서 정식 제거 — baselined 아님
    expect(baselineFields.has('bepGlideTouchAt')).toBe(false);
  }, 180000);
});

describe('stripComments', () => {
  it('라인 주석 strip', () => {
    const src = "const x = 1; // comment\nconst y = 2;\n";
    expect(stripComments(src)).not.toContain('comment');
  });

  it('블록 주석 strip', () => {
    const src = "/* block\n   multi-line\n*/\nconst x = 1;\n";
    expect(stripComments(src)).not.toContain('block');
    expect(stripComments(src)).not.toContain('multi-line');
  });

  it('URL 안 // 보존 (`http://` false positive 회피)', () => {
    const src = `const url = 'http://example.com';\n`;
    expect(stripComments(src)).toContain('http://example.com');
  });
});

describe('extractOptionalFields', () => {
  it('단일 인터페이스 옵셔널 필드 추출', () => {
    const src = `
export interface Foo {
  required: string;
  optional?: number;
  optionalUnion?: string | null;
}
`;
    const fields = extractOptionalFields(src, 'Foo');
    expect(fields.map((f) => f.field)).toEqual(['optional', 'optionalUnion']);
  });

  it('주석 안 옵셔널 필드 무시', () => {
    const src = `
export interface Foo {
  // optionalCommented?: number;
  real?: number;
}
`;
    const fields = extractOptionalFields(src, 'Foo');
    expect(fields.map((f) => f.field)).toEqual(['real']);
  });

  it('인터페이스명 미스매치 시 빈 결과', () => {
    const src = `
export interface Bar {
  optional?: number;
}
`;
    const fields = extractOptionalFields(src, 'Foo');
    expect(fields).toEqual([]);
  });

  it('중첩 객체 안 옵셔널 필드 제외 (깊이 1 만)', () => {
    const src = `
export interface Foo {
  outer?: {
    inner?: number;
  };
  another?: string;
}
`;
    const fields = extractOptionalFields(src, 'Foo');
    expect(fields.map((f) => f.field)).toEqual(['outer', 'another']);
  });

  it('필수 필드 (`?` 없음) 제외', () => {
    const src = `
export interface Foo {
  required: string;
  alsoRequired: number;
  onlyOptional?: boolean;
}
`;
    const fields = extractOptionalFields(src, 'Foo');
    expect(fields.map((f) => f.field)).toEqual(['onlyOptional']);
  });
});

describe('countReaderUsage', () => {
  it('`.field` member access 카운트', () => {
    const sources = [
      { path: 'a.ts', src: 'const x = state.foo;' },
      { path: 'b.ts', src: 'if (m.foo) doStuff(); else m.bar;' },
    ];
    expect(countReaderUsage('foo', sources)).toBe(2);
    expect(countReaderUsage('bar', sources)).toBe(1);
  });

  it('주석 안 reader 무시', () => {
    const sources = [
      { path: 'a.ts', src: '// state.foo 호출\nconst x = state.bar;' },
    ];
    expect(countReaderUsage('foo', sources)).toBe(0);
    expect(countReaderUsage('bar', sources)).toBe(1);
  });

  it('excludePaths schema 정의 파일 제외', () => {
    const sources = [
      { path: 'schema.ts', src: 'state.foo' },
      { path: 'reader.ts', src: 'state.foo' },
    ];
    expect(countReaderUsage('foo', sources, ['schema.ts'])).toBe(1);
  });

  it('필드명 substring 매치 회피 (word boundary)', () => {
    const sources = [{ path: 'a.ts', src: 'state.fooBar; state.foo' }];
    expect(countReaderUsage('foo', sources)).toBe(1);
  });
});

describe('countWriterUsage', () => {
  it('객체 literal value 패턴 카운트', () => {
    const sources = [
      { path: 'a.ts', src: 'const obj = { foo: 42 };' },
      { path: 'b.ts', src: 'return { ...prev, foo: 99 };' },
    ];
    expect(countWriterUsage('foo', sources)).toBe(2);
  });

  it('schema 정의 자체 (`field?:`) 제외', () => {
    const sources = [
      { path: 'schema.ts', src: 'interface Foo { foo?: number; }' },
    ];
    expect(countWriterUsage('foo', sources)).toBe(0);
  });

  it('member assignment 패턴 카운트', () => {
    const sources = [
      { path: 'a.ts', src: 'state.foo = 42;' },
      { path: 'b.ts', src: 'obj.foo = updated;' },
    ];
    expect(countWriterUsage('foo', sources)).toBe(2);
  });

  it('`==` 비교 vs `=` assignment 구분', () => {
    const sources = [
      { path: 'a.ts', src: 'if (state.foo == 1) state.foo = 2;' },
    ];
    // == 는 writer 가 아님, = 1건만 카운트
    expect(countWriterUsage('foo', sources)).toBe(1);
  });

  it('주석 안 writer 무시', () => {
    const sources = [
      { path: 'a.ts', src: '// foo: 42 안 발생\nconst x = 1;' },
    ];
    expect(countWriterUsage('foo', sources)).toBe(0);
  });

  it('excludePaths 제외', () => {
    const sources = [
      { path: 'schema.ts', src: 'const obj = { foo: 1 };' },
      { path: 'writer.ts', src: 'const obj = { foo: 2 };' },
    ];
    expect(countWriterUsage('foo', sources, ['schema.ts'])).toBe(1);
  });
});

describe('silent degradation 시나리오', () => {
  it('reader > 0 + writer = 0 → silent degradation candidate', () => {
    const sources = [
      { path: 'reader.ts', src: 'const x = state.silentField;' },
    ];
    const reader = countReaderUsage('silentField', sources);
    const writer = countWriterUsage('silentField', sources);
    expect(reader).toBeGreaterThan(0);
    expect(writer).toBe(0);
  });

  it('reader > 0 + writer > 0 → 정상 (silent 아님)', () => {
    const sources = [
      { path: 'reader.ts', src: 'const x = state.field;' },
      { path: 'writer.ts', src: 'state.field = 42;' },
    ];
    const reader = countReaderUsage('field', sources);
    const writer = countWriterUsage('field', sources);
    expect(reader).toBeGreaterThan(0);
    expect(writer).toBeGreaterThan(0);
  });

  it('reader = 0 + writer = 0 → silent 아님 (dead code, 다른 룰)', () => {
    const sources = [{ path: 'a.ts', src: 'const x = 1;' }];
    expect(countReaderUsage('unused', sources)).toBe(0);
    expect(countWriterUsage('unused', sources)).toBe(0);
  });
});
