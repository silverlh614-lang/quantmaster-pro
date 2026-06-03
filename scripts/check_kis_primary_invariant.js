#!/usr/bin/env node
/**
 * @responsibility KIS(L1) Primary 절대불변식 정적 가드 — KIS-capable 레이어의 신규 Yahoo(L3)-first
 *   quote 직접호출을 커밋타임 차단(ADR-0561, grandfather burn-down, 런타임 0줄).
 *
 * 사양 SSOT: docs/adr/0561-kis-primary-absolute-invariant.md §"위반 탐지 가드 사양".
 * 검증 모델: check_ssot_drift_registry.js / check_ssot_single_funnel.js (텍스트 정규식, AST 미사용,
 *   allowlist/grandfather, checkFile/export 재사용).
 *
 * 탐지(텍스트 정규식, false positive 최소화):
 *   - server/ + src/ (.test.ts · .d.ts 제외) 에서 라인 단위로 `fetchYahooQuoteByCode(` ·
 *     `fetchYahooQuote(` Gate/매매 primary 직접호출을 탐지.
 *   - 주석(`//`,`*`,`/*`) · `import`/`export ... from` (값/타입 import) 라인 제외.
 *   - 정의/위임 라인(`export ... function|const fetchYahoo... =`)은 정의-surface 이므로 제외
 *     (yahooSymbolResolver 의 SSOT 위임 alias·yahooQuoteAdapter 의 fetchYahooQuote 본체 오탐 방지).
 *
 * 화이트리스트(합법, ADR-0561 D3):
 *   - technicalQuoteRouter.ts (KIS-first 라우터의 fallback 위치 Yahoo 호출 = 합법),
 *   - yahooSymbolResolver.ts (fetchYahooQuoteByCode SSOT 위임 본체),
 *   - yahooQuoteAdapter.ts (fetchYahooQuote 정의 본체 + per/trailingPE 전용 경로).
 *
 * GRANDFATHER_ALLOWLIST(사유 `MIGRATION_PENDING_ADR0561`): 현존 ~10곳 Yahoo-first 진입점(파일:라인)을
 *   등재 → 통과. 마이그레이션 PR마다 해당 줄 제거(burn-down) → 가드 자동 강화. allowlist 외 신규
 *   Yahoo-first primary 직접호출 = EXIT 1.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const SCAN_ROOTS = ['server', 'src'];

/**
 * YAHOO_PRIMARY_PATTERNS — Yahoo(L3) quote primary 직접호출 심볼.
 * 라인에서 `<symbol>(` 형태(호출)로 등장하면 후보. 정의·위임·주석·import 는 별도 제외.
 */
const YAHOO_PRIMARY_PATTERNS = [
  'fetchYahooQuoteByCode',
  'fetchYahooQuote',
];

/**
 * WHITELIST — 합법 owner/fallback 파일(ROOT 상대, POSIX). ADR-0561 D3·가드 사양 §2.
 *   - technicalQuoteRouter.ts: KIS-first 라우터의 fallback 위치 Yahoo 호출(KIS primary 실패 후 차용).
 *   - yahooSymbolResolver.ts: fetchYahooQuoteByCode SSOT 위임 본체(정의처).
 *   - yahooQuoteAdapter.ts: fetchYahooQuote 정의 본체 + per/trailingPE 전용 경로.
 * 화이트리스트 파일 전체는 Yahoo-first 검사 면제(합법 경로 소유).
 */
const WHITELIST = new Set([
  'server/screener/adapters/technicalQuoteRouter.ts',
  'server/screener/adapters/yahooSymbolResolver.ts',
  'server/screener/adapters/yahooQuoteAdapter.ts',
]);

/**
 * GRANDFATHER_ALLOWLIST — 현존 위반 ~10곳(파일:라인 → 사유). ADR-0561 가드 사양 §3.
 * 사유 일괄 `MIGRATION_PENDING_ADR0561`. 마이그레이션 PR마다 해당 항목 제거(burn-down).
 * 라인 번호는 burn-down 추적용 진단 정보이며, 매칭은 파일 단위 grandfather 로 한다
 * (파일 내부 줄이동으로 가드가 false-fail 하지 않도록 — drift_registry 의 파일단위 grandfather 패턴).
 * key=relPath, value={ lines:number[], reason }.
 */
const GRANDFATHER_ALLOWLIST = new Map([
  ['server/screener/stockScreener.ts', { lines: [577], reason: 'MIGRATION_PENDING_ADR0561' }],
  // ── burn-down 완료(ADR-0561 ③ KIS-primary 마이그레이션) — fetchTechnicalQuoteByCode 경유로 치환됨 ──
  // shadowDataGate.ts: ADR-0547 R1 fetchTechnicalQuoteByCode 경유 치환 완료(직전 PR 7ccc8b2).
  // buyPipeline.ts:111 · dryRunScanner.ts:224 · trancheExecutor.ts:286 ·
  // preBreakoutAccumulation.ts:36 · kisIntradayCorrection.ts:50 · intradayScanner.ts:273/380 ·
  // stockPickReporter.ts:108/179 · reportGenerator.ts:622 → flag OFF byte-equiv funnel 위임 치환 완료.
  // 잔존 grandfather 1건(stockScreener.ts:577)은 별도 PR 처리.
]);

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** import / export ... from '...' 라인인가? (값/타입 import 모두 제외 — fetch 가 아님). */
function isImportLine(line) {
  return /^\s*import\b/.test(line) || /^\s*export\b[^;]*\bfrom\s*['"`]/.test(line);
}

/**
 * <symbol> 의 *정의/위임* 라인인가? (호출이 아니라 선언/alias 면 검사 제외).
 *   - export (default) (async) function|const|let|var <symbol>
 *   - const <symbol> = ...   (위임 alias)
 *   - export { <symbol> } ...  (재export)
 */
function isDefinitionLine(line, symbol) {
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (
    new RegExp(
      `^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var)\\s+${s}\\b`,
    ).test(line)
  ) {
    return true;
  }
  // 위임 alias: const fetchYahooQuoteByCode = fetchYahooQuoteWithMarketFallback;
  if (new RegExp(`^\\s*(?:export\\s+)?const\\s+${s}\\s*=`).test(line)) return true;
  // 재export: export { fetchYahooQuote } from '...'
  if (new RegExp(`^\\s*export\\s*\\{[^}]*\\b${s}\\b[^}]*\\}`).test(line)) return true;
  return false;
}

/**
 * 라인에서 <symbol>( 호출 토큰의 인덱스를 반환(없으면 -1). word-boundary 로 유사명 오탐 방지.
 * fetchYahooQuoteByCode 가 fetchYahooQuote 의 부분문자열을 포함하므로 word-boundary 필수.
 */
function callTokenIndex(line, symbol) {
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // (?<![\w$]) 로 앞 경계, 뒤는 식별자 직후 '(' 만 매칭(단순 호출 grep).
  const m = new RegExp(`(?<![\\w$])${s}\\s*\\(`).exec(line);
  return m ? m.index : -1;
}

/**
 * 라인에 <symbol>( 호출이 있고, 그 호출이 문자열 리터럴 *밖* 인가?
 * 토큰 인덱스 이전 구간의 따옴표 짝 수가 홀수면 문자열 안(에러 메시지·JSDoc 예시) → 위반 아님.
 */
function isCallLine(line, symbol) {
  const idx = callTokenIndex(line, symbol);
  if (idx < 0) return false;
  const prefix = line.slice(0, idx);
  const singles = (prefix.match(/'/g) || []).length;
  const doubles = (prefix.match(/"/g) || []).length;
  const backticks = (prefix.match(/`/g) || []).length;
  if (singles % 2 === 1 || doubles % 2 === 1 || backticks % 2 === 1) return false; // 문자열 안
  return true;
}

/**
 * 단일 파일에서 Yahoo-first primary 직접호출 라인을 수집(테스트 재사용 export).
 * 화이트리스트 파일은 호출자가 면제하므로 여기서는 raw hit 만 반환.
 * @returns {{symbol:string, lineNo:number}[]}
 */
function checkFile(absPath, relPath) {
  const src = readFileSync(absPath, 'utf-8');
  const lines = src.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (isImportLine(line)) continue;
    for (const symbol of YAHOO_PRIMARY_PATTERNS) {
      if (!line.includes(symbol)) continue;
      if (isDefinitionLine(line, symbol)) continue; // 정의/위임 surface
      // 더 긴 심볼(fetchYahooQuoteByCode)이 이미 잡혔으면 짧은 fetchYahooQuote 중복 카운트 방지.
      if (symbol === 'fetchYahooQuote' && isCallLine(line, 'fetchYahooQuoteByCode')) {
        // 한 라인에서 fetchYahooQuoteByCode(code, fetchYahooQuote) 형태: 인자로 넘기는 fetchYahooQuote 는
        // 호출이 아니라 함수 reference (뒤에 '(' 없음) → isCallLine 으로 이미 자연 제외되지만, 안전 가드.
      }
      if (isCallLine(line, symbol)) {
        // fetchYahooQuoteByCode 매치 시, 같은 라인의 fetchYahooQuote 는 인자 reference 이므로 중복 금지.
        if (
          symbol === 'fetchYahooQuote' &&
          hits.some((h) => h.lineNo === i + 1 && h.symbol === 'fetchYahooQuoteByCode')
        ) {
          continue;
        }
        hits.push({ symbol, lineNo: i + 1 });
      }
    }
  }
  return hits;
}

function walk(absDir, relDir, out) {
  if (!existsSync(absDir)) return;
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      walk(abs, rel, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push({ abs, rel });
    }
  }
}

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    walk(join(ROOT, root), root, files);
  }

  const violations = [];
  let grandfatheredCount = 0;
  for (const { abs, rel } of files) {
    const norm = rel.split('\\').join('/');
    if (WHITELIST.has(norm)) continue; // 합법 owner/fallback 파일 전체 면제
    const hits = checkFile(abs, norm);
    if (hits.length === 0) continue;
    if (GRANDFATHER_ALLOWLIST.has(norm)) {
      grandfatheredCount += hits.length;
      continue; // 파일단위 grandfather (burn-down 추적은 라인 메타로)
    }
    for (const h of hits) {
      violations.push({ relPath: norm, lineNo: h.lineNo, symbol: h.symbol });
    }
  }

  if (violations.length > 0) {
    console.error('[KisPrimaryInvariant] [FAIL] 신규 Yahoo(L3)-first 직접호출 (ADR-0561)');
    for (const v of violations) {
      console.error(
        `  ADR-0561 위반: ${v.relPath}:${v.lineNo} 이 Yahoo(L3)-first (${v.symbol}). ` +
          `KIS(L1) 우선 필수. fetchTechnicalQuote 라우터 경유 또는 allowlist 등재(마이그레이션 PR).`,
      );
    }
    console.error(`  총 ${violations.length}건 신규 위반 (GRANDFATHER_ALLOWLIST 미등재).`);
    process.exit(1);
  }

  console.log(
    `[KisPrimaryInvariant] [OK] — ${files.length}개 파일 검사, 신규 Yahoo-first 위반 0건 ` +
      `(grandfather ${grandfatheredCount}건: MIGRATION_PENDING_ADR0561 burn-down 대상, ` +
      `whitelist ${WHITELIST.size}개 owner/fallback 면제).`,
  );
}

export {
  checkFile,
  YAHOO_PRIMARY_PATTERNS,
  WHITELIST,
  GRANDFATHER_ALLOWLIST,
  isDefinitionLine,
  isCallLine,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
