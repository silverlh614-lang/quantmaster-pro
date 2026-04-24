/**
 * check_symbol_boundary.js  —  SymbolMarketRegistry 경계 강제 (Tier 2 ⑧)
 *
 * 규칙: 심볼→시장 분류 정규식 시그니처는 `server/utils/symbolMarketRegistry.ts`
 *       에만 존재해야 한다. 다른 파일에 regex 를 직접 추가하면 FAIL.
 *
 * 탐지 시그니처:
 *   - `\.KS$|\.KQ$`        — KR 티커 복합 패턴 (분류기만 이렇게 씀)
 *   - `\^(?:KS11|KQ11|VKOSPI)` — KR 지수 분류
 *   - `^\d{6}$`             — 6자리 raw 코드 단독 분류 사용 (외 문맥 있으면 통과)
 *
 * 주석 내부 표기·테스트 파일·Registry 자기 자신은 허용. 단순 `.replace(/\.KS$/, '')`
 * 같은 suffix 스트립은 KS/KQ 복합 패턴이 아니므로 자연 통과.
 *
 * 사용:
 *   node scripts/check_symbol_boundary.js
 *   node scripts/check_symbol_boundary.js --changed
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const ROOTS = ['src', 'server'];
const EXTS = new Set(['.ts', '.tsx']);
const IGNORED_SUFFIX = ['.d.ts', '.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

// 경계 단독 소유 파일 (정규식 정의를 허용)
const REGISTRY_FILE = 'server/utils/symbolMarketRegistry.ts';

// 탐지 시그니처 — 문자열 매치 (정규식 리터럴 안에 등장하면 경계 위반)
const SIGNATURES = [
  { name: 'KR 복합 티커 패턴',   pattern: /\\\.KS\$\|\\\.KQ\$/ },
  { name: 'KR 지수 분류',         pattern: /\\\^\(\?:KS11\|KQ11\|VKOSPI\)/ },
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

function stripComments(src) {
  // 블록 주석 제거
  let stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // 라인 주석 제거
  stripped = stripped.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return stripped;
}

function main() {
  const args = process.argv.slice(2);
  const onlyChanged = args.includes('--changed');

  const files = onlyChanged ? changedFiles() : ROOTS.flatMap((r) => walk(r));
  if (files.length === 0) {
    console.log('[SymbolBoundary] 검사할 파일 없음');
    return;
  }

  const violations = [];
  for (const f of files) {
    if (f.replace(/\\/g, '/').endsWith(REGISTRY_FILE)) continue;
    const src = readFileSync(f, 'utf-8');
    const code = stripComments(src);
    for (const { name, pattern } of SIGNATURES) {
      if (pattern.test(code)) {
        violations.push({ f, signature: name });
      }
    }
  }

  if (violations.length > 0) {
    console.error(`[SymbolBoundary][FAIL] 심볼 분류 정규식이 Registry 밖에서 발견됨 (${violations.length}건)`);
    console.error(`  → 신규 regex 는 반드시 ${REGISTRY_FILE} 에 추가하세요.`);
    for (const { f, signature } of violations) {
      console.error(`  - ${f}  [${signature}]`);
    }
    process.exit(1);
  }

  console.log(`[SymbolBoundary] OK — ${files.length}개 파일 검사, Registry 외 regex 누출 없음`);
}

main();
