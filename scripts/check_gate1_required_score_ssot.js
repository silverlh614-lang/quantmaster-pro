/**
 * check_gate1_required_score_ssot.js  —  ADR-0546 Gate1 Required-Score SSOT guard.
 *
 * 규칙: Gate1 required score 의 단일 출처는 server/trading/gateConfig.ts 의
 *       `resolveGate1RequiredScore(regime)` / `LEGACY_GATE1_REQUIRED_SCORE` 다.
 *       포렌식/관측/dry-run 계층이 `requiredScore ?? 70` / `requiredScore || 70` /
 *       `requiredScore: 70` 같은 하드코딩 70 으로 SSOT 를 우회하면 안 된다.
 *
 *       gateConfig.ts(SSOT 정의 본체)와 *.test.ts 는 대상에서 제외한다.
 *       명시 예외는 `// GATE1-REQUIRED-EXEMPT` 주석을 같은 라인에 단다.
 *
 *       위반 발견 시 EXIT 1 + 파일:라인 출력. 위반 0 이면 EXIT 0.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const SCAN_ROOTS = ['server', 'src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '_workspace']);

/** SSOT 정의 본체 — 70 리터럴이 정당하게 존재하는 유일한 파일. */
const EXEMPT_FILES = new Set(['server/trading/gateConfig.ts']);

const EXEMPT_MARKER = 'GATE1-REQUIRED-EXEMPT';

// requiredScore[...] (?? | || | :) 70  — SSOT 우회 하드코딩.
const FORBIDDEN = /requiredScore[A-Za-z0-9_]*\s*(\?\?|\|\||:)\s*70\b/i;

function isCommentLine(trimmed) {
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function walk(absDir, relDir, out) {
  for (const name of readdirSync(absDir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(absDir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, rel, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push({ abs, rel });
    }
  }
}

function checkFile(absPath, relPath) {
  if (EXEMPT_FILES.has(relPath) || !existsSync(absPath)) return [];
  const lines = readFileSync(absPath, 'utf-8').split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (isCommentLine(trimmed)) continue;
    if (line.includes(EXEMPT_MARKER)) continue;
    if (FORBIDDEN.test(line)) {
      violations.push({ relPath, lineNo: i + 1, line: trimmed });
    }
  }
  return violations;
}

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    const absRoot = join(ROOT, root);
    if (existsSync(absRoot)) walk(absRoot, root, files);
  }

  const violations = [];
  for (const { abs, rel } of files) {
    violations.push(...checkFile(abs, rel));
  }

  if (violations.length > 0) {
    console.error('[Gate1RequiredScoreSSOT] ❌ Gate1 required score 가 하드코딩 70 으로 SSOT 를 우회합니다 (ADR-0546)');
    console.error('  단일 출처: server/trading/gateConfig.ts resolveGate1RequiredScore(regime) / LEGACY_GATE1_REQUIRED_SCORE');
    console.error('  하드코딩 70 대신 위 SSOT 를 호출하세요. (정당 예외는 // GATE1-REQUIRED-EXEMPT)\n');
    for (const v of violations) {
      console.error(`  ${v.relPath}:${v.lineNo}`);
      console.error(`    ${v.line}`);
    }
    console.error(`\n  총 ${violations.length}건 위반`);
    process.exit(1);
  }

  console.log(`[Gate1RequiredScoreSSOT] OK — ${files.length}개 production 파일 검사, 하드코딩 70 우회 없음`);
}

main();
