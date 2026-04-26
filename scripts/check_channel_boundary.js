/**
 * check_channel_boundary.js  —  텔레그램 채널 ID env 직접 접근 차단 (ADR-0032 §3)
 *
 * 규칙: TELEGRAM_*_CHANNEL_ID / TELEGRAM_PICK_CHANNEL_ID 의 process.env 직접
 *       접근은 alertRouter.ts (SSOT) 와 alertCategories.ts (env parser) 에만
 *       허용된다. 다른 모듈에서 발견되면 FAIL.
 *
 *       예외: telegramClient.ts 의 sendPickChannelAlert 는 PR-X3 에서 alertRouter
 *       경유로 마이그레이션 예정 — 현재는 LEGACY 화이트리스트.
 *
 * 탐지 시그니처 (process.env 우측 식별자):
 *   - TELEGRAM_TRADE_CHANNEL_ID
 *   - TELEGRAM_ANALYSIS_CHANNEL_ID
 *   - TELEGRAM_INFO_CHANNEL_ID
 *   - TELEGRAM_SYSTEM_CHANNEL_ID
 *   - TELEGRAM_PICK_CHANNEL_ID  (legacy alias for ANALYSIS)
 *
 * TELEGRAM_CHAT_ID (개인 1:1 채팅) 는 본 boundary 대상 아님 (개인 회선 분리는 PR-X2 scope).
 *
 * 주석/문서/테스트 픽스처 안의 변수 이름 등장은 허용. 코드(`process.env.X`) 만 검사.
 *
 * 사용:
 *   node scripts/check_channel_boundary.js
 *   node scripts/check_channel_boundary.js --changed
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const ROOTS = ['src', 'server', 'scripts'];
const EXTS = new Set(['.ts', '.tsx', '.js']);
const IGNORED_SUFFIX = ['.d.ts', '.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];

// SSOT — 채널 ID 해석은 이 파일들에서만 가능
const ALLOWED_FILES = [
  'server/alerts/alertRouter.ts',
  'server/alerts/alertCategories.ts',
  // LEGACY: PR-X3 에서 alertRouter 경유로 마이그레이션 예정. 현재는 화이트리스트.
  'server/alerts/telegramClient.ts',
  // 본 검증 스크립트 자체 — 탐지 시그니처 정의 목적
  'scripts/check_channel_boundary.js',
];

const SIGNATURES = [
  'TELEGRAM_TRADE_CHANNEL_ID',
  'TELEGRAM_ANALYSIS_CHANNEL_ID',
  'TELEGRAM_INFO_CHANNEL_ID',
  'TELEGRAM_SYSTEM_CHANNEL_ID',
  'TELEGRAM_PICK_CHANNEL_ID',
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
    return out
      .split('\n')
      .filter((n) => n && EXTS.has(extname(n)) && !IGNORED_SUFFIX.some((suf) => n.endsWith(suf)));
  } catch {
    return [];
  }
}

function stripComments(src) {
  // 블록 주석 제거
  let stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // 라인 주석 제거 — URL 형식(http://) 보호
  stripped = stripped.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return stripped;
}

function findViolations(src) {
  const code = stripComments(src);
  const found = [];
  for (const sig of SIGNATURES) {
    // process.env.SIGNATURE 또는 process.env['SIGNATURE'] 형태만 검사 (변수명 단순 등장은 통과)
    const re1 = new RegExp(`process\\.env\\.${sig}\\b`);
    const re2 = new RegExp(`process\\.env\\[['\"]${sig}['\"]\\]`);
    if (re1.test(code) || re2.test(code)) found.push(sig);
  }
  return found;
}

function main() {
  const args = process.argv.slice(2);
  const onlyChanged = args.includes('--changed');

  const files = onlyChanged ? changedFiles() : ROOTS.flatMap((r) => walk(r));
  if (files.length === 0) {
    console.log('[ChannelBoundary] 검사할 파일 없음');
    return;
  }

  const violations = [];
  for (const f of files) {
    const norm = f.replace(/\\/g, '/');
    if (ALLOWED_FILES.some((allowed) => norm.endsWith(allowed))) continue;
    const src = readFileSync(f, 'utf-8');
    const found = findViolations(src);
    if (found.length > 0) violations.push({ f: norm, signatures: found });
  }

  if (violations.length > 0) {
    console.error(
      `[ChannelBoundary][FAIL] 채널 ID env 직접 접근이 SSOT 밖에서 발견됨 (${violations.length}건)`,
    );
    console.error(
      `  → 신규 코드는 alertRouter.dispatchAlert(category, ...) 또는 ChannelSemantic.* 를 사용하세요.`,
    );
    console.error(`  → SSOT 화이트리스트: ${ALLOWED_FILES.join(', ')}`);
    for (const { f, signatures } of violations) {
      console.error(`  - ${f}  [${signatures.join(', ')}]`);
    }
    process.exit(1);
  }

  console.log(`[ChannelBoundary] OK — ${files.length}개 파일 검사, SSOT 외 직접 접근 없음`);
}

main();
