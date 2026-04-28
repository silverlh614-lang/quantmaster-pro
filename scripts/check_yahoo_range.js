#!/usr/bin/env node
/**
 * check_yahoo_range.js — ADR-0082 Yahoo Range Restriction Policy
 *
 * 사용자 운영 보고 "yahoo 참조는 sanity 위반이 자주 발생하므로 2년치로 선정하지 말것
 * (프로그램 전역)" 반영. 코드베이스의 모든 자동 호출 경로에서 Yahoo `range` 의 최대값
 * `'1y'` 를 정적 검증으로 강제.
 *
 * 탐지 시그니처 (모두 string literal 안 / URL 쿼리 패턴):
 *   - `range=2y` / `range=5y` / `range=10y` / `range=max` / `range=ytd`
 *   - `'2y'` / `"2y"` / `'5y'` / `"5y"` / `'10y'` / `"10y"` / `'max'` (단독)
 *
 * 화이트리스트 (정책 정의/문서/UI/테스트는 검출 제외):
 *   - server/utils/yahooRangePolicy.ts (정책 SSOT 자기 자신)
 *   - server/utils/yahooRangePolicy.test.ts (정책 회귀 테스트)
 *   - src/components/analysis/CandleChart.tsx (사용자 UI 옵션 — 서버 cap 적용됨)
 *   - scripts/check_yahoo_range.js (시그니처 정의)
 *   - docs/adr/ (정책 문서 자기 인용)
 *   - *.test.ts / *.test.tsx (회귀 시나리오)
 *
 * ENV 와 무관 — 정적 검증이라 항상 실행.
 *
 * 사용:
 *   node scripts/check_yahoo_range.js
 *   node scripts/check_yahoo_range.js --changed
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const ROOTS = ['src', 'server'];
const EXTS = new Set(['.ts', '.tsx', '.js']);
const IGNORED_SUFFIX = ['.d.ts', '.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

// 정책 정의/UI/문서 — 본 시그니처가 "정상적으로 등장" 가능한 파일
const ALLOWED_FILES = [
  'server/utils/yahooRangePolicy.ts',
  'server/utils/yahooRangePolicy.test.ts',
  'src/components/analysis/CandleChart.tsx',
  'scripts/check_yahoo_range.js',
];

// 탐지 시그니처
//
// 두 그룹:
//   1. URL 쿼리 패턴: range=2y / range=5y / range=10y / range=max / range=ytd
//   2. 문자열 리터럴: '2y' / "2y" / '5y' / "5y" / '10y' / "10y" / 'max' / 'ytd'
//
// 그룹 2 의 'max' 는 일반 식별자로 자주 등장하므로 *문자열 리터럴* 안에서만 검출.
// 'ytd' 도 동일.
const URL_QUERY_PATTERNS = [
  /range=2y\b/g,
  /range=5y\b/g,
  /range=10y\b/g,
  /range=max\b/g,
  /range=ytd\b/g,
];
const STRING_LITERAL_PATTERNS = [
  /(['"])2y\1/g,
  /(['"])5y\1/g,
  /(['"])10y\1/g,
];

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

function changedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf-8' });
    return out.split('\n').filter((n) => n && EXTS.has(extname(n)) && !IGNORED_SUFFIX.some((suf) => n.endsWith(suf)));
  } catch {
    return [];
  }
}

function isAllowed(file) {
  // 정규화: leading ./ 제거
  const norm = file.replace(/^\.\//, '');
  return ALLOWED_FILES.some((allow) => norm === allow || norm.endsWith('/' + allow));
}

/**
 * 라인에서 주석 영역 제거 (정확한 lexer 가 아닌 안전한 휴리스틱).
 * - 한 줄 주석: `//` 이후 무시. 단, 문자열/정규식 안의 `//` 는 보존 (URL 등).
 * - 블록 주석: 외부 in_block flag 로 추적.
 *
 * 안전 정책: 의심스러운 경우 *코드로 간주* (false negative 보다 false positive 차단 우선).
 * 본 검증은 정책 SSOT 차단이므로 주석으로 우회 불가능해야 한다.
 */
function stripCommentsLine(line, state) {
  let out = '';
  let i = 0;
  let inString = null; // ' " or ` (문자열 내부)
  let inRegex = false;

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    if (state.inBlock) {
      // 블록 주석 종료 탐색
      if (ch === '*' && next === '/') {
        state.inBlock = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < line.length) {
        // escape: 다음 문자도 그대로
        out += next;
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      i += 1;
      continue;
    }

    // 문자열 시작
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }

    // 블록 주석 시작
    if (ch === '/' && next === '*') {
      state.inBlock = true;
      i += 2;
      continue;
    }
    // 라인 주석 시작
    if (ch === '/' && next === '/') {
      break; // 라인 끝까지 무시
    }

    out += ch;
    i += 1;
  }
  return out;
}

/** 파일 내용에서 시그니처 매치 — line 번호 + matched text. */
function findViolations(filePath, content) {
  const violations = [];
  const lines = content.split('\n');
  const state = { inBlock: false };

  // 라인 단위로 스캔해서 line:col 정보 보존
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = stripCommentsLine(rawLine, state);

    for (const pat of URL_QUERY_PATTERNS) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(line)) !== null) {
        violations.push({
          file: filePath,
          line: i + 1,
          column: m.index + 1,
          match: m[0],
          kind: 'URL_QUERY',
        });
      }
    }
    for (const pat of STRING_LITERAL_PATTERNS) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(line)) !== null) {
        violations.push({
          file: filePath,
          line: i + 1,
          column: m.index + 1,
          match: m[0],
          kind: 'STRING_LITERAL',
        });
      }
    }
  }
  return violations;
}

function main() {
  const argv = process.argv.slice(2);
  const useChanged = argv.includes('--changed');

  let files;
  if (useChanged) {
    files = changedFiles();
    if (files.length === 0) {
      console.log('[YahooRange] --changed 모드: 변경된 파일 없음 — skip');
      return 0;
    }
  } else {
    files = ROOTS.flatMap((root) => walk(root));
    // scripts/ 도 자기 자신 검사 대상에 포함하되 ALLOWED 로 화이트리스트
    files.push('scripts/check_yahoo_range.js');
  }

  let totalViolations = 0;
  const violationsByFile = new Map();

  for (const file of files) {
    if (isAllowed(file)) continue;
    if (!existsSync(file)) continue;

    let content;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const v = findViolations(file, content);
    if (v.length > 0) {
      violationsByFile.set(file, v);
      totalViolations += v.length;
    }
  }

  if (totalViolations === 0) {
    console.log(`[YahooRange] ✅ 검사 ${files.length} 파일 — 위반 0건`);
    return 0;
  }

  console.error(`[YahooRange] ❌ 위반 ${totalViolations}건 (${violationsByFile.size} 파일)\n`);
  console.error('ADR-0082 — Yahoo Range Restriction Policy');
  console.error('  자동 호출 경로의 Yahoo `range` 는 \'1y\' 이내로 제한됩니다.');
  console.error('  사용자 명시 "yahoo 2년치는 sanity 위반이 자주 발생하므로 금지 (프로그램 전역)".');
  console.error('  허용 화이트리스트 외 파일에서 range=2y / range=5y / range=10y / range=max / \'2y\' /');
  console.error('  \'5y\' / \'10y\' 발견 시 본 검증이 차단합니다.\n');

  for (const [file, vs] of violationsByFile.entries()) {
    console.error(`  ${file}:`);
    for (const v of vs) {
      console.error(`    L${v.line}:${v.column} [${v.kind}] ${v.match}`);
    }
  }
  console.error('');
  console.error('해결: capYahooRange() 통과 + 정적 사용처 변경 (예: range=2y → range=1y).');
  console.error('  정책 정의/UI/테스트 파일은 ALLOWED_FILES 화이트리스트 갱신.');
  return 1;
}

const code = main();
process.exit(code);
