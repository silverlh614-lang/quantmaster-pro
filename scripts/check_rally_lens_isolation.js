/**
 * check_rally_lens_isolation.js  —  ADR-0549 Market Rally Lens isolation guard.
 *
 * 규칙: server/trading/recommendation/** 의 모든 모듈은 read-model only 다.
 *       자동매매·실주문·shadow-buy·paper-executable 생성 경로를 import 할 수 없다.
 *
 *       금지 import (불변식 MARKET_RALLY_DOES_NOT_CREATE_ORDER):
 *         - buyPipeline / entryEngine / tranche*
 *         - autoTradeEngine
 *         - kisClient (주문 경로)
 *         - exitEngine
 *         - paperEntry* / provisionalShadowLane
 *         - counterfactual* (shadow-buy 생성 경로)
 *
 *       위반 발견 시 [FAIL] + 파일:라인 출력, EXIT 1. 위반 0 이면 [OK] + EXIT 0.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const SCAN_DIR = join(ROOT, 'server', 'trading', 'recommendation');
const REL_SCAN_DIR = 'server/trading/recommendation';

/**
 * 금지 import 패턴 — import 경로 부분 문자열(소문자 비교) 매칭.
 * read 전용 레이어가 주문/실행/shadow-buy/paper 생성 경로에 의존하면 격리 위반.
 */
const FORBIDDEN_PATTERNS = [
  { token: 'buypipeline', label: 'buyPipeline (주문 파이프라인)' },
  { token: 'entryengine', label: 'entryEngine (진입 엔진)' },
  { token: 'tranche', label: 'tranche* (분할 매수)' },
  { token: 'autotradeengine', label: 'autoTradeEngine (실주문 집행)' },
  { token: 'kisclient', label: 'kisClient (KIS 주문 경로)' },
  { token: 'exitengine', label: 'exitEngine (청산 엔진)' },
  { token: 'paperentry', label: 'paperEntry* (페이퍼 체결)' },
  { token: 'provisionalshadow', label: 'provisionalShadowLane (shadow-buy 생성)' },
  { token: 'counterfactual', label: 'counterfactual* (shadow-buy 생성 경로)' },
];

// import ... from '...'  /  export ... from '...'  /  import('...')
const IMPORT_RE = /(?:import|export)\b[^;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(absDir, relDir, out) {
  if (!existsSync(absDir)) return;
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, rel, out);
    } else if (name.endsWith('.ts')) {
      out.push({ abs, rel });
    }
  }
}

function checkFile(absPath, relPath) {
  const src = readFileSync(absPath, 'utf-8');
  const lines = src.split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(line)) !== null) {
      const spec = (m[1] || m[2] || '').toLowerCase();
      if (!spec) continue;
      for (const { token, label } of FORBIDDEN_PATTERNS) {
        if (spec.includes(token)) {
          violations.push({ relPath, lineNo: i + 1, spec: m[1] || m[2], label });
        }
      }
    }
  }
  return violations;
}

function main() {
  const files = [];
  walk(SCAN_DIR, REL_SCAN_DIR, files);

  if (files.length === 0) {
    console.log(`[RallyLensIsolation] OK — ${REL_SCAN_DIR} 에 검사 대상 파일 없음 (skip)`);
    return;
  }

  const violations = [];
  for (const { abs, rel } of files) {
    violations.push(...checkFile(abs, rel));
  }

  if (violations.length > 0) {
    console.error('[RallyLensIsolation] [FAIL] recommendation/** 가 주문·실행 경로를 import 합니다 (ADR-0549)');
    console.error('  recommendation/** 는 read-model only — 주문/shadow-buy/paper 생성 경로 import 금지.\n');
    for (const v of violations) {
      console.error(`  ${v.relPath}:${v.lineNo}  →  '${v.spec}'  [금지: ${v.label}]`);
    }
    console.error(`\n  총 ${violations.length}건 위반`);
    process.exit(1);
  }

  console.log(`[RallyLensIsolation] [OK] — ${files.length}개 파일 검사, 금지 import 0건`);
}

main();
