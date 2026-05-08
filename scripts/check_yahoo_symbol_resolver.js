#!/usr/bin/env node
/**
 * check_yahoo_symbol_resolver.js — ADR-0444 Static Grep Guards Hardening
 *
 * 사용자 명시 2순위 #2 — *"정적 grep 가드 강화 (inline regex / direct concat /
 * wrapper / invalid code provider 자동 차단)"* 직접 반영. ADR-0438 / ADR-0440 /
 * ADR-0443 SSOT 인프라 위에 *시간 강제력* 추가 — 신규 호출자가 SSOT 우회 시
 * 즉시 차단할 정적 검증 인프라.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 가드 A — Yahoo direct concat (`${X}.KS` / `${X}.KQ`)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 탐지 시그니처:
 *   - `\$\{[^}]+\}\.KS\b` — 템플릿 리터럴 `${code}.KS` / `${entry.code}.KS` 등
 *   - `\$\{[^}]+\}\.KQ\b` — 동일 `.KQ`
 *
 * 화이트리스트 (정규식 매치이지만 위반 아님):
 *   - server/screener/adapters/yahooSymbolResolver.ts — SSOT 자기 자신
 *   - server/utils/symbolNormalizer.ts — ADR-0438 SSOT
 *   - server/learning/defectEvolutionLedger.ts — description 텍스트 ledger
 *   - scripts/check_yahoo_symbol_resolver.js / .test.js — 본 스크립트
 *   - *.test.ts / *.test.tsx — 회귀 시나리오 (시그니처 fixture 포함)
 *   - docs/adr/**.md — ADR 문서
 *   - src/ 디렉토리 — 클라이언트 측 (서버 SSOT 접근 불가)
 *
 * Graceful fallback 인정 (ADR-0443 마이그레이션 그레이스):
 *   - 같은 라인에 SSOT 호출 (tryGetYahooSymbol|fetchYahooQuoteByCode|
 *     getYahooSymbol|resolveYahooSymbolForCode|fetchYahooQuoteWithMarketFallback)
 *     이 함께 등장 → 위반 아님 (예: `tryGetYahooSymbol(c) ?? \`${c}.KS\``)
 *   - 같은 라인 또는 직전 라인에 `// ADR-NNNN:` 주석 → 위반 아님
 *   - 파일 첫 50 줄 안에 ADR-0231/0438/0443/0444 마커 → 파일 전체 opt-in
 *
 * ──────────────────────────────────────────────────────────────────────────
 * 가드 B — KRX 6자리 정규식 + Yahoo symbol 조립 컨텍스트 차단
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 탐지 시그니처:
 *   - `\/\^\\d\{6\}\$\/` (정확히 `/^\d{6}$/` 또는 `/^\d{6}$/i` 등 플래그 포함)
 *
 * 가드 B 는 *순수 입력 validator* 는 허용 — 위반은 Yahoo symbol 조립과
 * 결합한 normalizer 패턴만 차단. 다음 모두 만족할 때 위반:
 *   1. 라인에 `/^\d{6}$/` 정규식 등장
 *   2. 같은 라인 OR 다음 1 라인에 `.KS` / `.KQ` 템플릿 리터럴 등장
 *   3. 화이트리스트 / opt-in 주석 / SSOT 호출 부재
 *
 * 화이트리스트:
 *   - server/utils/symbolNormalizer.ts — SSOT 자기 자신
 *   - 위 가드 A 와 동일 (scripts / tests / ADR docs / src/)
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * baseline: 위반 0건 (본 PR 도입 시점 코드베이스 전수 검증).
 * 신규 ENV 도입 0건 (정적 검증).
 *
 * 사용:
 *   node scripts/check_yahoo_symbol_resolver.js
 *   node scripts/check_yahoo_symbol_resolver.js --changed
 *   node scripts/check_yahoo_symbol_resolver.js --json
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

// ─── 설정 ──────────────────────────────────────────────────────────────────

// 검사 대상 디렉토리 — server/ 만 (src/ 는 클라이언트 측, 서버 SSOT 접근 불가)
const ROOTS = ['server'];
const EXTS = new Set(['.ts', '.tsx', '.js']);
const IGNORED_SUFFIX = ['.d.ts', '.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

// 화이트리스트 — 시그니처가 *정상적으로 등장 가능* 한 파일 (SSOT 자기 자신 / 정의)
const ALLOWED_FILES = [
  // SSOT 자기 자신
  'server/screener/adapters/yahooSymbolResolver.ts',
  'server/utils/symbolNormalizer.ts',
  // description 텍스트 ledger (시그니처 인용만)
  'server/learning/defectEvolutionLedger.ts',
  // 본 스크립트 + 회귀 테스트
  'scripts/check_yahoo_symbol_resolver.js',
  'scripts/check_yahoo_symbol_resolver.test.js',
];

// 화이트리스트 prefix (디렉토리 단위)
const ALLOWED_PREFIXES = [
  'docs/adr/',
  'docs/',
  'node_modules/',
  'build/',
  'dist/',
  '.git/',
  '_workspace/',
  'src/', // 클라이언트 측 — 서버 SSOT 접근 불가 (서버 프록시 경유)
];

// SSOT 호출 패턴 (graceful fallback 인정)
const SSOT_CALL_PATTERN =
  /\b(?:tryGetYahooSymbol|fetchYahooQuoteByCode|getYahooSymbol|resolveYahooSymbolForCode|fetchYahooQuoteWithMarketFallback|toYahooSymbol|normalizeKrxCode)\s*\(/;

// ADR opt-in 라인 주석 패턴
const ADR_OPT_IN_PATTERN = /\/\/.*\bADR-\d{4}\b/;

// 파일 헤더 안 ADR 마커 (관련 ADR 만 — 광범위 ADR 인용 방지)
const FILE_HEADER_ADR_PATTERN = /\bADR-(?:0231|0438|0443|0444)\b/;
const HEADER_LINE_LIMIT = 50;

// ─── 시그니처 ──────────────────────────────────────────────────────────────

// 가드 A — `${X}.KS` 또는 `${X}.KQ` 템플릿 리터럴 안 직접 조립
// 주의: 정규식이 백틱 컨텍스트 안에 있는지 검증 — string literal `'${X}.KS'`
//       는 텍스트 그대로이지만 같은 위반 카운트.
const GUARD_A_PATTERNS = [/\$\{[^}]+\}\.KS\b/g, /\$\{[^}]+\}\.KQ\b/g];

// 가드 B — `/^\d{6}$/` 정규식 + Yahoo symbol 조립 컨텍스트
// 6자리 KRX 코드 정규식 (플래그 i / m / u 등 포함)
const GUARD_B_REGEX_PATTERN = /\/\^\\d\{6\}\$\/[gimsuy]*/g;
// 가드 B 컨텍스트 — 같은 라인 또는 다음 라인에 .KS / .KQ 조립 필요
const GUARD_B_CONTEXT_PATTERNS = [
  /\$\{[^}]+\}\.KS\b/,
  /\$\{[^}]+\}\.KQ\b/,
  /['"`]\.KS['"`]/,
  /['"`]\.KQ['"`]/,
];

// ─── 유틸 ──────────────────────────────────────────────────────────────────

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
    const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      encoding: 'utf-8',
    });
    return out
      .split('\n')
      .filter((n) => n && EXTS.has(extname(n)) && !IGNORED_SUFFIX.some((suf) => n.endsWith(suf)));
  } catch {
    return [];
  }
}

function normalizePath(file) {
  return file.replace(/^\.\//, '').replace(/\\/g, '/');
}

function isAllowed(file) {
  const norm = normalizePath(file);
  if (ALLOWED_FILES.some((allow) => norm === allow || norm.endsWith('/' + allow))) return true;
  return ALLOWED_PREFIXES.some((prefix) => norm.startsWith(prefix));
}

/**
 * 라인에서 주석 영역 제거 (안전한 휴리스틱).
 * - 한 줄 주석: `//` 이후 무시 (단, 문자열 안 `//` 보존)
 * - 블록 주석: 외부 in_block flag 추적
 *
 * 안전 정책: 의심 시 *코드로 간주* (false negative 보다 false positive 차단 우선).
 */
function stripCommentsLine(line, state) {
  let out = '';
  let i = 0;
  let inString = null;

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    if (state.inBlock) {
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
        out += next;
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      state.inBlock = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '/') break;

    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 파일 헤더 (첫 HEADER_LINE_LIMIT 라인) 안에 ADR 마커가 있는지.
 * 주석 영역 안 마커도 인정 (header 는 보통 주석 블록).
 */
function hasFileHeaderAdrMarker(content) {
  const lines = content.split('\n').slice(0, HEADER_LINE_LIMIT);
  return lines.some((line) => FILE_HEADER_ADR_PATTERN.test(line));
}

/**
 * 라인 단위 ADR opt-in 주석 (같은 라인 OR 직전 라인).
 */
function hasLineAdrOptIn(rawLines, lineIdx) {
  if (ADR_OPT_IN_PATTERN.test(rawLines[lineIdx])) return true;
  if (lineIdx > 0 && ADR_OPT_IN_PATTERN.test(rawLines[lineIdx - 1])) return true;
  return false;
}

/**
 * 라인에 SSOT 호출이 함께 등장하는가 (graceful fallback).
 */
function hasSameLineSsotCall(line) {
  return SSOT_CALL_PATTERN.test(line);
}

/**
 * 가드 A 위반 검출 — `${X}.KS` / `${X}.KQ` direct concat.
 */
function findGuardAViolations(filePath, content) {
  const violations = [];
  const rawLines = content.split('\n');
  const fileHeaderApproved = hasFileHeaderAdrMarker(content);
  const state = { inBlock: false };

  for (let i = 0; i < rawLines.length; i++) {
    const codeOnly = stripCommentsLine(rawLines[i], state);

    for (const pat of GUARD_A_PATTERNS) {
      pat.lastIndex = 0;
      let m;
      while ((m = pat.exec(codeOnly)) !== null) {
        // graceful fallback 인정
        if (hasSameLineSsotCall(codeOnly)) continue;
        if (hasLineAdrOptIn(rawLines, i)) continue;
        if (fileHeaderApproved) continue;

        violations.push({
          guard: 'A',
          file: filePath,
          line: i + 1,
          column: m.index + 1,
          match: m[0],
          kind: 'YAHOO_DIRECT_CONCAT',
        });
      }
    }
  }
  return violations;
}

/**
 * 가드 B 위반 검출 — `/^\d{6}$/` + Yahoo symbol 조립 컨텍스트 결합.
 *
 * 같은 라인 또는 다음 1 라인에 `.KS` / `.KQ` 조립 패턴이 동반될 때만 위반.
 * 순수 input validator (`if (!/^\d{6}$/.test(code))` 등) 는 허용.
 */
function findGuardBViolations(filePath, content) {
  const violations = [];
  const rawLines = content.split('\n');
  const fileHeaderApproved = hasFileHeaderAdrMarker(content);
  const state = { inBlock: false };

  // 라인별 stripped 캐시 (다음 라인 컨텍스트 검증용)
  const stripped = [];
  for (let i = 0; i < rawLines.length; i++) {
    stripped.push(stripCommentsLine(rawLines[i], state));
  }

  for (let i = 0; i < stripped.length; i++) {
    const codeOnly = stripped[i];
    GUARD_B_REGEX_PATTERN.lastIndex = 0;
    let m;
    while ((m = GUARD_B_REGEX_PATTERN.exec(codeOnly)) !== null) {
      // 컨텍스트: 같은 라인 또는 다음 1 라인에 .KS / .KQ 조립 필요
      const sameLine = codeOnly;
      const nextLine = stripped[i + 1] ?? '';
      const hasAssemblyContext = GUARD_B_CONTEXT_PATTERNS.some(
        (p) => p.test(sameLine) || p.test(nextLine),
      );
      if (!hasAssemblyContext) continue;

      // graceful fallback 인정
      if (hasSameLineSsotCall(codeOnly)) continue;
      if (hasLineAdrOptIn(rawLines, i)) continue;
      if (fileHeaderApproved) continue;

      violations.push({
        guard: 'B',
        file: filePath,
        line: i + 1,
        column: m.index + 1,
        match: m[0],
        kind: 'KRX_REGEX_WITH_SYMBOL_ASSEMBLY',
      });
    }
  }
  return violations;
}

function findViolations(filePath, content) {
  return [...findGuardAViolations(filePath, content), ...findGuardBViolations(filePath, content)];
}

// ─── 메인 ──────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const useChanged = argv.includes('--changed');
  const useJson = argv.includes('--json');

  let files;
  if (useChanged) {
    files = changedFiles();
    if (files.length === 0) {
      if (useJson) {
        console.log(JSON.stringify({ ok: true, mode: 'changed', files: 0, violations: 0 }));
      } else {
        console.log('[YahooSymbolResolver] --changed 모드: 변경된 파일 없음 — skip');
      }
      return 0;
    }
  } else {
    files = ROOTS.flatMap((root) => walk(root));
    files.push('scripts/check_yahoo_symbol_resolver.js');
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

  if (useJson) {
    const out = {
      ok: totalViolations === 0,
      filesScanned: files.length,
      violations: totalViolations,
      byFile: Object.fromEntries(violationsByFile),
    };
    console.log(JSON.stringify(out, null, 2));
    return totalViolations === 0 ? 0 : 1;
  }

  if (totalViolations === 0) {
    console.log(
      `[YahooSymbolResolver] ✅ 검사 ${files.length} 파일 — 가드 A/B 위반 0건 (ADR-0444)`,
    );
    return 0;
  }

  console.error(
    `[YahooSymbolResolver] ❌ 위반 ${totalViolations}건 (${violationsByFile.size} 파일)\n`,
  );
  console.error('ADR-0444 — Static Grep Guards Hardening');
  console.error('  가드 A: `${X}.KS` / `${X}.KQ` direct template concat (yahooSymbolResolver SSOT 우회)');
  console.error('  가드 B: `/^\\d{6}$/` 정규식 + `.KS`/`.KQ` 조립 (symbolNormalizer SSOT 우회)\n');

  for (const [file, vs] of violationsByFile.entries()) {
    console.error(`  ${file}:`);
    for (const v of vs) {
      console.error(
        `    L${v.line}:${v.column} [Guard ${v.guard}] [${v.kind}] ${v.match}`,
      );
    }
  }
  console.error('');
  console.error('해결:');
  console.error("  Guard A: tryGetYahooSymbol(code) ?? `${code}.KS` (graceful fallback) 또는");
  console.error("           fetchYahooQuoteByCode(code, fetcher) (양 시장 sanity 자동) 사용.");
  console.error('  Guard B: normalizeKrxCode(code).valid 검증 + 조립은 yahooSymbolResolver 위임.');
  console.error('  마이그레이션 그레이스: 같은/직전 라인 `// ADR-0443:` 또는');
  console.error('                     `// ADR-0444:` opt-in 주석 추가 (한시적 허용).');
  return 1;
}

const code = main();
process.exit(code);
