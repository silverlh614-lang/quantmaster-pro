import { scriptWarn } from '../server/observability/scriptWarn.js';
/**
 * check_responsibility.js  —  SRP Assertion Doc Header
 *
 * 모든 .ts/.tsx 파일 상단에 `@responsibility 한 문장 설명` 주석을 의무화한다.
 * 규칙:
 *   - 파일 상위 20줄 이내 주석에 `@responsibility <문장>` 이 존재해야 한다.
 *   - 누락 시 경고(warn) 또는 실패(strict 모드).
 *   - 문장에 " and ", " or ", " 또는 ", " 및 ", " 그리고 " 가 있으면 SRP 위반(fail).
 *   - 25 단어(공백 분리)를 넘으면 경고.
 *
 * 원칙: "클래스의 역할을 if/and/or 없이 25단어 이내로 설명할 수 있는가?"
 *
 * 사용:
 *   node scripts/check_responsibility.js                # 경고 모드 (종료 코드 0)
 *   node scripts/check_responsibility.js --strict       # 누락 파일도 실패로 처리
 *   node scripts/check_responsibility.js --changed      # 스테이징된 파일만 검사
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const ROOTS = ['src', 'server'];
const EXTS = new Set(['.ts', '.tsx']);
const IGNORED_SUFFIX = ['.d.ts', '.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];
const CONJUNCTIONS = [' and ', ' or ', ' 또는 ', ' 및 ', ' 그리고 '];
const MAX_WORDS = 25;
const HEAD_LINES = 20;

/**
 * BASELINE_SRP_VIOLATIONS — 전체 트리 스캔 도입 시점의 *기존* 접속사 위반 카탈로그.
 * ACMA(check_complexity.js)의 BASELINE_TECHNICAL_DEBT 패턴 정합: 등재된 legacy 위반은
 * 비차단(리포트만), 목록 밖의 *신규* 위반만 hard-fail 한다.
 *
 * 2026-05-25 (Patch-CI-SRP-BASELINE-AND-GITLEAKS-FP-001 후속): 초기 54건을 모두 단일
 * 책임 문장으로 교정 완료 → 카탈로그 비움. 이제 모든 접속사 위반은 즉시 hard-fail.
 *
 * 신규 진입 절대 금지 — 이 목록은 줄어들기만 해야 한다. 비어 있는 상태가 정상이다.
 */
const BASELINE_SRP_VIOLATIONS = new Set([]);

function isBaselineViolation(file) {
  const norm = file.split('\\').join('/');
  return BASELINE_SRP_VIOLATIONS.has(norm) || [...BASELINE_SRP_VIOLATIONS].some((b) => norm.endsWith('/' + b));
}

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

function extractResponsibility(src) {
  const head = src.split('\n').slice(0, HEAD_LINES).join('\n');
  const m = head.match(/@responsibility\s+([^\n*]+)/);
  if (!m) return null;
  return m[1].trim().replace(/\*\/\s*$/, '').trim();
}

function validateSentence(s) {
  const problems = [];
  const lower = ' ' + s.toLowerCase() + ' ';
  for (const c of CONJUNCTIONS) {
    if (lower.includes(c)) problems.push(`접속사 "${c.trim()}" 사용 — 단일 책임 위반 의심`);
  }
  const wordCount = s.split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_WORDS) problems.push(`${wordCount} 단어 > ${MAX_WORDS} — 설명이 너무 깁니다`);
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const onlyChanged = args.includes('--changed');

  const files = onlyChanged ? changedFiles() : ROOTS.flatMap((r) => walk(r));
  if (files.length === 0) {
    console.log('[SRP] 검사할 파일 없음');
    return;
  }

  const missing = [];
  const violations = [];
  const warnings = [];

  for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    const tag = extractResponsibility(src);
    if (!tag) {
      missing.push(f);
      continue;
    }
    const problems = validateSentence(tag);
    if (problems.length > 0) {
      if (problems.some((p) => p.includes('위반'))) violations.push({ f, tag, problems });
      else warnings.push({ f, tag, problems });
    }
  }

  if (missing.length > 0) {
    const label = strict ? '[SRP][FAIL]' : '[SRP][WARN]';
    console.error(`${label} @responsibility 누락 ${missing.length}건`);
    for (const f of missing.slice(0, 30)) console.error(`  - ${f}`);
    if (missing.length > 30) console.error(`  ... 외 ${missing.length - 30}건`);
  }

  if (warnings.length > 0) {
    scriptWarn(`\n[SRP][WARN] 길이 초과 등 경고 ${warnings.length}건`);
    for (const { f, tag, problems } of warnings.slice(0, 20)) {
      scriptWarn(`  ${f}\n    "${tag}"\n    · ${problems.join('\n    · ')}`);
    }
  }

  const baselineViolations = violations.filter(({ f }) => isBaselineViolation(f));
  const newViolations = violations.filter(({ f }) => !isBaselineViolation(f));

  if (baselineViolations.length > 0) {
    scriptWarn(`\n[SRP][BASELINE] 기존 접속사 위반 ${baselineViolations.length}건 (비차단 — 카탈로그 등재 legacy 부채)`);
  }

  if (newViolations.length > 0) {
    console.error(`\n[SRP][FAIL] 신규 SRP 위반 ${newViolations.length}건 (BASELINE_SRP_VIOLATIONS 미등재)`);
    for (const { f, tag, problems } of newViolations) {
      console.error(`  ${f}\n    "${tag}"\n    · ${problems.join('\n    · ')}`);
    }
  }

  const hardFail = newViolations.length > 0 || (strict && missing.length > 0);
  if (hardFail) process.exit(1);
  console.log(
    `\n[SRP] OK — ${files.length}개 파일 검사, 신규 위반 0건 (baseline ${baselineViolations.length}건 제외)`,
  );
}

main();
