#!/usr/bin/env node
/**
 * @responsibility ADR-0114 Data Trust Layer 정적 검증 — AI 가격 hallucination 차단
 *
 * 검사 패턴:
 *   1. AI 응답에서 numeric price 직접 사용:
 *      gemini.*\.(currentPrice|priceKrw|stopLoss|targetPrice) 패턴
 *      → AI 응답을 *수치 결정* 입력으로 사용 시 차단 (ADR-0064 PR-α 격상)
 *
 *   2. LIVE 매매 경로 INDICATOR 가격을 reconciliation 입력으로 사용:
 *      placeKisOrder/placeKisSellOrder 인근에서 yahoo/naver 변수 사용 시 차단
 *
 * 본 PR (ADR-0114): baseline 0건 위반 — 신규 회귀만 차단.
 *
 * 화이트리스트:
 *   - 정책 SSOT 자기 자신 (server/data/dataTrustLayer.ts)
 *   - 검증 스크립트 (scripts/check_data_trust.js, scripts/check_data_trust.test.js)
 *   - 회귀 테스트 (server/data/dataTrustLayer.test.ts)
 *   - ADR 문서 (docs/adr/0114-*)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── 화이트리스트 ──────────────────────────────────────────────────────────
const ALLOWED_FILES = [
  'server/data/dataTrustLayer.ts',
  'server/data/dataTrustLayer.test.ts',
  'scripts/check_data_trust.js',
  'scripts/check_data_trust.test.js',
];

const ALLOWED_PREFIXES = [
  'docs/adr/',
  'node_modules/',
  'build/',
  'dist/',
  '.git/',
  '_workspace/',
];

// ─── 검사 패턴 ─────────────────────────────────────────────────────────────

/**
 * 패턴 1: AI 응답 numeric price 직접 사용.
 * gemini/aiResponse/aiResult 변수에서 price 류 필드를 *직접* 가격 결정에 사용.
 *
 * 예시 차단:
 *   const targetPrice = geminiResult.targetPrice;
 *   await placeKisOrder(code, name, gemini.priceKrw, ...);
 *
 * 예시 허용 (NARRATIVE 경로):
 *   const narrative = `목표가는 ${ai.targetPriceText}`;  // text 변수
 */
const AI_PRICE_PATTERNS = [
  // gemini.targetPrice / gemini.stopLoss / gemini.currentPrice / gemini.priceKrw
  /\b(gemini|aiResponse|aiResult|geminiResult)\w*\.(currentPrice|priceKrw|stopLoss|targetPrice|entryPrice)\b/g,
];

/**
 * 패턴 2: LIVE 매매 경로의 INDICATOR 가격 직접 사용.
 * placeKisOrder/placeKisSellOrder 인자에 yahoo/naver 가격 변수 직접 전달.
 *
 * 본 단순 검사는 false positive 가능 — 변수 이름만 보고 판단.
 * 운영자 검토 후 화이트리스트 또는 변수명 변경 권장.
 */
const LIVE_INDICATOR_PATTERNS = [
  // placeKisOrder(..., yahooPrice, ...) / placeKisSellOrder(..., naverPrice, ...)
  /\bplaceKis(Order|SellOrder)\s*\([^)]*\b(yahoo|naver)\w*Price\b[^)]*\)/g,
];

// ─── 파일 walker ───────────────────────────────────────────────────────────

function shouldSkip(relPath) {
  if (ALLOWED_FILES.includes(relPath)) return true;
  return ALLOWED_PREFIXES.some((p) => relPath.startsWith(p));
}

function walk(dir, relativeTo) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(relativeTo, full);
    if (shouldSkip(rel)) continue;
    if (entry.isDirectory()) {
      out.push(...walk(full, relativeTo));
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

// ─── 주석/문자열 strip (false positive 차단) ─────────────────────────────

function stripCommentsAndStrings(src) {
  // 블록 주석 제거
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // 라인 주석 제거
  out = out.replace(/\/\/[^\n]*/g, '');
  // 문자열 리터럴 제거 (single/double/template) — 단순 처리
  out = out.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  return out;
}

// ─── 검사 실행 ─────────────────────────────────────────────────────────────

export function checkDataTrust(rootDir = ROOT) {
  const violations = [];

  // src + server 만 walk
  const targets = ['src', 'server'];
  for (const t of targets) {
    const dir = path.join(rootDir, t);
    if (!fs.existsSync(dir)) continue;

    for (const file of walk(dir, rootDir)) {
      const rel = path.relative(rootDir, file);
      if (shouldSkip(rel)) continue;
      const src = fs.readFileSync(file, 'utf-8');
      const stripped = stripCommentsAndStrings(src);

      for (const p of AI_PRICE_PATTERNS) {
        p.lastIndex = 0;
        let m;
        while ((m = p.exec(stripped)) !== null) {
          violations.push({
            file: rel,
            kind: 'AI_PRICE_DIRECT_USE',
            match: m[0],
          });
        }
      }
      for (const p of LIVE_INDICATOR_PATTERNS) {
        p.lastIndex = 0;
        let m;
        while ((m = p.exec(stripped)) !== null) {
          violations.push({
            file: rel,
            kind: 'LIVE_INDICATOR_PRICE',
            match: m[0],
          });
        }
      }
    }
  }

  return violations;
}

function main() {
  const violations = checkDataTrust(ROOT);
  if (violations.length === 0) {
    console.log('[check_data_trust] ✅ ADR-0114 정책 위반 0건');
    process.exit(0);
  }
  console.error(`[check_data_trust] ❌ ADR-0114 정책 위반 ${violations.length}건:`);
  for (const v of violations) {
    console.error(`  - ${v.file} [${v.kind}]: ${v.match}`);
  }
  console.error('\n해결 방법:');
  console.error('  - AI 응답 numeric price → 사용 안 하거나 화이트리스트 추가');
  console.error('  - LIVE 가격 → KIS_REAL_QUOTE / KIS_DAILY (TRUTH tier) 만 사용');
  console.error('  - ENV DATA_TRUST_ENFORCEMENT_DISABLED=true 는 런타임 우회만 — lint 는 영구 차단');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
