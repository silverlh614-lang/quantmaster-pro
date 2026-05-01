/**
 * check_silent_degradation.js — Silent Degradation 정적 검출 SSOT
 *
 * @responsibility 영속 schema 옵셔널 필드 reader 있음 + writer 0건 패턴 정적 검출
 *
 * 사용자 4-항목 거버넌스 추천 #2 — *"validate:all 에 silent degradation 검출 1종 추가.
 * ADR-0136 writer 부재 같은 패턴은 정적 분석으로 잡힙니다 (필드 정의 + reader 있음 +
 * writer 없음 → WARN)"* 직접 반영.
 *
 * 검출 알고리즘:
 *   1. SCHEMA_FILES 화이트리스트 안의 영속 인터페이스 옵셔널 필드 추출
 *      (`fieldName?: Type` 패턴, 코멘트 strip 후).
 *   2. 각 필드명에 대해 server/* 와 src/* 전수 grep:
 *      - reader: `\.fieldName\b` member access
 *      - writer: `\bfieldName\s*:\s*[^?]` 객체 literal value 또는
 *                `\bfieldName\s*=` assignment (schema 정의 자체 제외)
 *   3. reader > 0 + writer = 0 → silent degradation candidate
 *   4. BASELINE_SILENT_DEGRADATION 카탈로그 등재 항목은 *의도된 placeholder* 로 흡수
 *      (예: ADR 명시 미구현 wiring 대기). 카탈로그 외 신규 위반 → WARN
 *      (`--strict` 시 FAIL).
 *
 * False positive 회피:
 *   - 주석 사전 strip (line + block)
 *   - schema 정의 자체 (`fieldName?:`) 는 writer 매치에서 제외
 *   - 일반 변수명 충돌 회피: SCHEMA_FILES 옵셔널 필드만 검사 (`id`/`name` 같은 일반명 제외)
 *
 * 사용:
 *   node scripts/check_silent_degradation.js                # WARN 모드 (기본)
 *   node scripts/check_silent_degradation.js --strict       # baseline 외 위반 시 FAIL
 *   node scripts/check_silent_degradation.js --json         # 진단용 JSON 출력
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';

const ROOTS = ['src', 'server'];
const EXTS = new Set(['.ts', '.tsx']);
const IGNORED_SUFFIX = ['.d.ts', '.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

// 검사 대상 영속 schema 파일 화이트리스트.
// 시작은 macroStateRepo.ts (ADR-0136 silent degradation 진원지, 49 옵셔널 필드).
// 추후 PR 에서 점진 확장 가능 (shadowTradeRepo / watchlistRepo 등).
const SCHEMA_FILES = [
  'server/persistence/macroStateRepo.ts',
];

// 검사 대상 인터페이스 이름 (해당 파일 안의 export interface 매칭).
const SCHEMA_INTERFACES = new Set([
  'MacroState',
]);

/**
 * BASELINE_SILENT_DEGRADATION — 의도된 silent placeholder 카탈로그.
 *
 * 다음 케이스만 등재 허용:
 *   1. ADR 명시 미구현 wiring 대기 (PENDING_WIRING 백로그 항목)
 *   2. 외부 의존성 ENV gate 안 writer (예: ADR-0142 FSS_MAPPING_ENABLED)
 *   3. 다른 모듈에서 cache populate 하는 옵셔널 메타 필드 (legacy 호환)
 *
 * 신규 등재 시 사유 + ADR + 후속 PR 명시 의무.
 */
const BASELINE_SILENT_DEGRADATION = [
  // 현재 등재 0건 — 향후 PR 에서 발견 시 등재.
  // 형식: { schema: 'MacroState', field: 'fieldName', reason: 'ADR-XXXX wiring 대기 (PENDING_WIRING A3)' }
];

const BASELINE_KEYS = new Set(
  BASELINE_SILENT_DEGRADATION.map((b) => `${b.schema}:${b.field}`)
);

/* ───────── 파일 walk ───────── */

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(p)) && !IGNORED_SUFFIX.some((suf) => p.endsWith(suf))) out.push(p);
  }
  return out;
}

/* ───────── 주석 strip ───────── */

export function stripComments(src) {
  // 블록 주석 /* ... */ 제거
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // 라인 주석 // ... 끝까지 제거
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

/* ───────── 옵셔널 필드 추출 ───────── */

/**
 * extractOptionalFields(src, interfaceName) — schema 파일에서
 * `export interface <interfaceName>` 블록 안의 옵셔널 필드 (`name?:`) 추출.
 *
 * @returns Array<{ field: string, line: number }>
 */
export function extractOptionalFields(src, interfaceName) {
  const stripped = stripComments(src);
  const lines = stripped.split('\n');

  const result = [];
  let inInterface = false;
  let braceDepth = 0;
  const interfaceStartRe = new RegExp(`^\\s*export\\s+interface\\s+${interfaceName}\\b`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inInterface) {
      if (interfaceStartRe.test(line)) {
        inInterface = true;
        braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        if (braceDepth <= 0) inInterface = false;
      }
      continue;
    }

    // 라인 처리 *전* 깊이로 매치 판정 — `outer?: {` 같은 라인이
    // 이전 라인 끝 깊이=1 일 때 옵셔널 필드로 카운트되도록.
    const depthBeforeLine = braceDepth;

    // 중괄호 깊이 추적 (이 줄 끝 깊이로 갱신)
    braceDepth += (line.match(/\{/g) || []).length;
    braceDepth -= (line.match(/\}/g) || []).length;

    if (braceDepth <= 0) {
      inInterface = false;
      continue;
    }

    // 깊이 1 (인터페이스 직속) 안의 옵셔널 필드만 추출
    // 중첩 객체 ({...}) 안 필드는 제외 (depthBeforeLine 으로 라인 시작 시점 깊이)
    if (depthBeforeLine !== 1) continue;

    // `fieldName?: Type` — 시작 공백 + 식별자 + 물음표 + 콜론
    const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\?:\s*/);
    if (m) {
      result.push({ field: m[1], line: i + 1 });
    }
  }

  return result;
}

/* ───────── reader / writer 카운트 ───────── */

/**
 * countReaderUsage(field, sources, excludePath) — `\.field\b` member access 카운트.
 * `excludePath` 는 schema 정의 파일 자체 (writer 가 schema 안에 fields 일 수 있어 reader 매치도 무시).
 *
 * 주의: 주석 strip 후 검사로 false positive 차단.
 */
export function countReaderUsage(field, sources, excludePaths = []) {
  const excludeSet = new Set(excludePaths);
  const re = new RegExp(`\\.${field}\\b`, 'g');
  let count = 0;
  for (const f of sources) {
    if (excludeSet.has(f.path)) continue;
    const stripped = stripComments(f.src);
    const m = stripped.match(re);
    if (m) count += m.length;
  }
  return count;
}

/**
 * countWriterUsage(field, sources, excludePaths) — writer 패턴 카운트.
 *
 * Writer 패턴:
 *   1. 객체 literal: `\bfield:\s*[^?]` (단 schema 정의 `field?:` 는 제외 — `?:` 매치 차단)
 *   2. assignment: `\.field\s*=` — member assignment
 *   3. shorthand: `{\s*field\s*[,}]` — `{ field }` 또는 `{ field, ... }`
 *
 * `excludePaths` 는 schema 정의 파일 (정의 자체가 writer 와 혼동될 위험).
 *
 * 주석 strip 후 검사.
 */
export function countWriterUsage(field, sources, excludePaths = []) {
  const excludeSet = new Set(excludePaths);
  // 객체 literal value: `field: <value>` 단 `field?:` 제외 (정의 패턴)
  const objLiteralRe = new RegExp(`(?<!\\?)\\b${field}\\s*:\\s*[^\\?\\n}]`, 'g');
  // member assignment: `.field = ...`
  const assignRe = new RegExp(`\\.${field}\\s*=(?!=)`, 'g');
  // shorthand: `{ field }` 또는 `{ field, ... }` — 단 빈 문자열에서만 검사하면 잘 안 됨
  // shorthand 는 너무 false positive 위험 → 제외, 위 2 패턴만 사용

  let count = 0;
  for (const f of sources) {
    if (excludeSet.has(f.path)) continue;
    const stripped = stripComments(f.src);
    const m1 = stripped.match(objLiteralRe);
    const m2 = stripped.match(assignRe);
    if (m1) count += m1.length;
    if (m2) count += m2.length;
  }
  return count;
}

/* ───────── 메인 ───────── */

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const json = args.includes('--json');

  // 전체 source 파일 로드
  const allFiles = ROOTS.flatMap((r) => walk(r));
  const sources = allFiles.map((p) => ({
    path: p,
    src: readFileSync(p, 'utf-8'),
  }));

  const schemaPaths = SCHEMA_FILES.map((p) => p.replace(/\\/g, '/'));
  const excludePaths = sources
    .filter((s) => schemaPaths.some((sp) => s.path.replace(/\\/g, '/') === sp))
    .map((s) => s.path);

  const findings = [];

  for (const schemaPath of SCHEMA_FILES) {
    if (!existsSync(schemaPath)) {
      console.warn(`[SilentDegradation] WARN — schema 파일 부재: ${schemaPath}`);
      continue;
    }

    const src = readFileSync(schemaPath, 'utf-8');
    for (const interfaceName of SCHEMA_INTERFACES) {
      // 해당 schema 파일에 해당 인터페이스가 있을 때만 처리
      if (!new RegExp(`export\\s+interface\\s+${interfaceName}\\b`).test(src)) continue;

      const fields = extractOptionalFields(src, interfaceName);

      for (const { field, line } of fields) {
        const readerCount = countReaderUsage(field, sources, excludePaths);
        const writerCount = countWriterUsage(field, sources, excludePaths);
        const baselineKey = `${interfaceName}:${field}`;
        const baselined = BASELINE_KEYS.has(baselineKey);

        findings.push({
          schema: interfaceName,
          field,
          schemaPath: relative(process.cwd(), schemaPath),
          line,
          readerCount,
          writerCount,
          baselined,
          isSilentDegradation: readerCount > 0 && writerCount === 0,
        });
      }
    }
  }

  const violations = findings.filter((f) => f.isSilentDegradation && !f.baselined);
  const baselined = findings.filter((f) => f.isSilentDegradation && f.baselined);

  if (json) {
    console.log(JSON.stringify({ findings, violations, baselined }, null, 2));
    process.exit(violations.length === 0 || !strict ? 0 : 1);
  }

  if (findings.length === 0) {
    console.log('[SilentDegradation] 검사 대상 schema 부재 — skip');
    return;
  }

  if (violations.length === 0) {
    const header = `[SilentDegradation] OK — ${findings.length}개 옵셔널 필드 검사`;
    const baseline = baselined.length > 0
      ? ` (baseline ${baselined.length}건 흡수)`
      : '';
    console.log(`${header}${baseline}, 신규 위반 0건`);
    return;
  }

  console.log('[SilentDegradation] WARN — silent degradation 신규 위반 발견:');
  for (const v of violations) {
    console.log(
      `  - ${v.schema}.${v.field} ` +
        `(${v.schemaPath}:${v.line}) reader=${v.readerCount} writer=${v.writerCount}`
    );
  }
  console.log('');
  console.log(
    '해결: writer 추가 (영속 갱신 cron / API 핸들러), 또는 의도된 placeholder 면 ' +
      'BASELINE_SILENT_DEGRADATION 등재 + ADR 인용 + PENDING_WIRING 항목 등재.'
  );

  if (strict) {
    process.exit(1);
  }
}

// CLI 진입
const isMain = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('check_silent_degradation.js');
if (isMain) {
  main();
}
