/**
 * @responsibility check_kis_primary_invariant 회귀 테스트 (ADR-0561/0562 가드 확장)
 *
 * 검증:
 *   (a) 현 코드베이스 EXIT 0 (WHITELIST + GRANDFATHER 가 현존 Yahoo-first 전부 커버 — blind-spot 포함)
 *   (b) 각 DETECTOR(D-QUOTE/D-URL/D-SUFFIX/D-CLOSES-DOMESTIC/D-CLOSES-VAR/D-YAHOO-CLIENT) 가짜 신규 위반 탐지
 *   (c) WHITELIST(router/SSOT/adapter/B/D) 멤버십
 *   (d) GRANDFATHER_ALLOWLIST 등재처가 실제 Yahoo-first hit 포함(누락/오등재 방지)
 *   (e) 주석·import·정의/위임·문자열·함수 reference 인자 → false positive 0
 *   (f) fetchCloses 글로벌(^GSPC/^VIX/DX-Y) 비위반 · 국내(^KS11/KRW=X) 위반 정확 구분(FP 0 핵심)
 *   (g) 레지스트리 shape (심볼셋·WHITELIST·GRANDFATHER 사유)
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import {
  checkFile,
  YAHOO_PRIMARY_PATTERNS,
  YAHOO_CLIENT_PATTERNS,
  DOMESTIC_YAHOO_SYMBOLS,
  GLOBAL_WHITELIST_SYMBOLS,
  WHITELIST,
  GRANDFATHER_ALLOWLIST,
  isDefinitionLine,
  isCallLine,
  closesHitKind,
  suffixHit,
} from './check_kis_primary_invariant.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');

/** 임시 파일에 src 를 써서 checkFile 로 검사. relPath 의 분류(WHITELIST/GRANDFATHER/src/opt-in) 가 반영됨. */
function checkSrc(src, relPath = 'server/foo/fixture.ts') {
  const dir = mkdtempSync(join(tmpdir(), 'kis-primary-'));
  const abs = join(dir, 'fixture.ts');
  writeFileSync(abs, src, 'utf-8');
  try {
    return checkFile(abs, relPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check_kis_primary_invariant guard (ADR-0562 확장)', () => {
  it('(a) current repo passes (whitelist+grandfather cover all existing → EXIT 0)', () => {
    let exitCode = 0;
    let out = '';
    try {
      out = execSync('node scripts/check_kis_primary_invariant.js', {
        cwd: ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).toString();
    } catch (err) {
      exitCode = err.status ?? 1;
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(exitCode).toBe(0);
    expect(out).toContain('[OK]');
  });

  // ── (b) DETECTOR 별 가짜 신규 위반 탐지 ──
  it('(b-QUOTE) fake new fetchYahooQuoteByCode call IS detected', () => {
    const hits = checkSrc('  const q = await fetchYahooQuoteByCode(stock.code, f);', 'server/rogue/g.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('fetchYahooQuoteByCode');
  });

  it('(b-QUOTE2) fake bare fetchYahooQuote primary call IS detected', () => {
    const hits = checkSrc('  const q = await fetchYahooQuote(symbol);', 'server/rogue/g.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('fetchYahooQuote');
  });

  it('(b-URL) fake new direct query1/query2 finance.yahoo.com URL IS detected', () => {
    const hits = checkSrc(
      '  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${s}`;',
      'server/rogue/g.ts',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('D-URL');
  });

  it('(b-URL2) v10 quoteSummary endpoint IS detected', () => {
    const hits = checkSrc(
      '  await guardedFetch("https://query1.finance.yahoo.com/v10/finance/quoteSummary/x");',
      'server/rogue/g.ts',
    );
    expect(hits.some((h) => h.symbol === 'D-URL')).toBe(true);
  });

  it('(b-SUFFIX) fake new raw ${code}.KS concat (no opt-in) IS detected', () => {
    const hits = checkSrc('  const sym = `${code}.KS`;', 'server/rogue/g.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('D-SUFFIX');
  });

  it('(b-CLOSES-DOMESTIC) fetchCloses("^KS11") IS detected', () => {
    const hits = checkSrc('  const c = await fetchCloses("^KS11", "5d");', 'server/rogue/g.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('D-CLOSES-DOMESTIC');
  });

  it('(b-CLOSES-VAR) fetchCloses(sym) variable arg IS detected (new file)', () => {
    const hits = checkSrc('  const c = await fetchCloses(sym, "5d");', 'server/rogue/g.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('D-CLOSES-VAR');
  });

  it('(b-YAHOO-CLIENT) fake new fetchYahooConsensus call IS detected', () => {
    const hits = checkSrc('  const c = await fetchYahooConsensus(code);', 'server/rogue/g.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('fetchYahooConsensus');
  });

  it('(b-E2E) the guard exits 1 when a non-allowlisted file has a violation', () => {
    const rogueRel = 'server/__kis_primary_fixture_rogue__.ts';
    const rogueAbs = join(ROOT, rogueRel);
    writeFileSync(
      rogueAbs,
      '// rogue\nexport async function f(s) {\n  const u = `https://query2.finance.yahoo.com/v8/finance/chart/${s}`;\n  return u;\n}\n',
      'utf-8',
    );
    let exitCode = 0;
    let out = '';
    try {
      out = execSync('node scripts/check_kis_primary_invariant.js', {
        cwd: ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).toString();
    } catch (err) {
      exitCode = err.status ?? 1;
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    } finally {
      rmSync(rogueAbs, { force: true });
    }
    expect(exitCode).toBe(1);
    expect(out).toContain('ADR-0562');
  });

  // ── (c) WHITELIST 멤버십 ──
  it('(c) whitelisted owner/router/SSOT/adapter/B/D files are registered', () => {
    expect(WHITELIST.has('server/screener/adapters/technicalQuoteRouter.ts')).toBe(true);
    expect(WHITELIST.has('server/screener/adapters/yahooSymbolResolver.ts')).toBe(true);
    expect(WHITELIST.has('server/screener/adapters/yahooQuoteAdapter.ts')).toBe(true);
    expect(WHITELIST.has('server/clients/yahooConsensusClient.ts')).toBe(true); // B1
    expect(WHITELIST.has('server/alerts/dxyIntradayClient.ts')).toBe(true); // B3
    expect(WHITELIST.has('server/alerts/globalScanAgent.ts')).toBe(true); // B2/B4
    expect(WHITELIST.has('server/services/quantitativeCandidateGenerator.ts')).toBe(true); // D1
  });

  // ── (d) GRANDFATHER 등재처가 실제 hit 포함 ──
  it('(d) every GRANDFATHER_ALLOWLIST file genuinely contains a Yahoo-first hit', () => {
    for (const [relPath] of GRANDFATHER_ALLOWLIST) {
      const abs = join(ROOT, relPath);
      const hits = checkFile(abs, relPath);
      expect(hits.length, `${relPath} should contain a Yahoo-first hit`).toBeGreaterThan(0);
    }
  });

  it('(d2) ADR-0562 C category grandfather entries are present', () => {
    expect(GRANDFATHER_ALLOWLIST.has('server/learning/lateWinEvaluator.ts')).toBe(true); // C2
    expect(GRANDFATHER_ALLOWLIST.has('server/clients/historicalClosePrice.ts')).toBe(true); // C2
    expect(GRANDFATHER_ALLOWLIST.has('server/clients/koreanQuoteBridge.ts')).toBe(true); // C3
    expect(GRANDFATHER_ALLOWLIST.has('server/screener/sectorSources.ts')).toBe(true); // C5
    expect(GRANDFATHER_ALLOWLIST.has('server/alerts/reportGenerator.ts')).toBe(true); // C3/C4
    expect(GRANDFATHER_ALLOWLIST.has('server/trading/marketDataRefresh.ts')).toBe(true); // C4
  });

  it('(d3) ADR-0561 exit-path closes burn-down: priceHistory/ma60 grandfather 제거 + 라우터 whitelist', () => {
    // C2 exit 경로 두 소비처는 fetchCloseSeries 라우터로 치환되어 grandfather 에서 제거됨(burn-down).
    expect(GRANDFATHER_ALLOWLIST.has('server/trading/exitEngine/helpers/priceHistory.ts')).toBe(false);
    expect(GRANDFATHER_ALLOWLIST.has('server/trading/exitEngine/helpers/ma60.ts')).toBe(false);
    // 라우터(KIS-first, Yahoo fallback 합법)는 WHITELIST 로 분류 — R1 동형.
    expect(WHITELIST.has('server/trading/exitEngine/helpers/closeSeriesProvider.ts')).toBe(true);
  });

  // ── (e) false positive 0 ──
  it('(e1) comment lines are NOT violations', () => {
    expect(checkSrc('  // const q = fetchYahooQuoteByCode(c, f)')).toHaveLength(0);
    expect(checkSrc('   * see https://query1.finance.yahoo.com/v8 above')).toHaveLength(0);
    expect(checkSrc('  /* fetchCloses("^KS11") */')).toHaveLength(0);
  });

  it('(e2) import / re-export lines are NOT violations', () => {
    expect(checkSrc("import { fetchYahooConsensus } from './c.js';")).toHaveLength(0);
    expect(checkSrc("export { fetchYahooQuote } from './a.js';")).toHaveLength(0);
  });

  it('(e3) definition / delegation lines are NOT violations', () => {
    expect(checkSrc('export const fetchYahooQuoteByCode = fetchYahooQuoteWithMarketFallback;')).toHaveLength(0);
    expect(checkSrc('export async function fetchYahooSector(code) { return null; }')).toHaveLength(0);
    expect(checkSrc('export async function fetchCloses(symbol, range) { return null; }')).toHaveLength(0);
    expect(isDefinitionLine('export const fetchYahooQuoteByCode = x;', 'fetchYahooQuoteByCode')).toBe(true);
  });

  it('(e4) string-literal occurrences (error msg / log) are NOT violations', () => {
    expect(checkSrc('  throw new Error("use fetchYahooQuote(x) instead");')).toHaveLength(0);
    expect(checkSrc('  log(`called fetchCloses(${s})`);')).toHaveLength(0);
  });

  it('(e5) SSOT-delegation .KS concat (tryGetYahooSymbol ?? `${c}.KS`) is NOT a violation', () => {
    expect(suffixHit('  const s = tryGetYahooSymbol(code) ?? `${code}.KS`;', '', false)).toBe(false);
    expect(checkSrc('  const s = tryGetYahooSymbol(code) ?? `${code}.KS`;', 'server/x/y.ts')).toHaveLength(0);
  });

  it('(e6) ADR-marker opt-in .KS concat is NOT a violation (symbol-resolver guard 통치)', () => {
    expect(suffixHit('  return `${c}.KS`;', '  // ADR-0444: brute-force candidates.', false)).toBe(false);
    expect(suffixHit('  return `${c}.KS`;', '', true)).toBe(false); // 파일-head opt-in
  });

  it('(e7) src/ files are exempt from D-SUFFIX (client-side, no server SSOT access)', () => {
    expect(checkSrc('  const symbols = [`${baseCode}.KS`, `${baseCode}.KQ`];', 'src/services/stock/x.ts')).toHaveLength(0);
  });

  it('(e8) word-boundary: fooFetchCloses() and fetchClosesXyz are NOT matches', () => {
    expect(closesHitKind('  fooFetchCloses(sym);')).toBe(null);
    expect(isCallLine('  fooFetchYahooQuote(x);', 'fetchYahooQuote')).toBe(false);
  });

  // ── (f) fetchCloses 글로벌 vs 국내 정확 구분 (FP 0 핵심) ──
  it('(f1) fetchCloses GLOBAL symbols (^GSPC/^VIX/DX-Y.NYB) are NOT violations', () => {
    expect(closesHitKind("  await fetchCloses('^GSPC', '25d');")).toBe(null);
    expect(closesHitKind("  await fetchCloses('^VIX', '1d');")).toBe(null);
    expect(closesHitKind('  await fetchCloses("DX-Y.NYB", "10d");')).toBe(null);
    expect(closesHitKind("  await fetchCloses('EWY', '10d');")).toBe(null);
    expect(closesHitKind("  await fetchCloses('CL=F', '5d');")).toBe(null);
  });

  it('(f2) fetchCloses DOMESTIC symbols (^KS11/^KQ11/KRW=X) ARE violations', () => {
    expect(closesHitKind("  await fetchCloses('^KS11', '5d');")).toBe('DOMESTIC');
    expect(closesHitKind('  await fetchCloses("^KQ11", "5d");')).toBe('DOMESTIC');
    expect(closesHitKind("  await fetchCloses('KRW=X', '25d');")).toBe('DOMESTIC');
  });

  it('(f3) fetchCloses variable arg → VAR (resolved by file classification)', () => {
    expect(closesHitKind('  await fetchCloses(sym, "60d");')).toBe('VAR');
    expect(closesHitKind('  await fetchCloses(sym.symbol, "5d");')).toBe('VAR');
  });

  // ── (g) 레지스트리 shape ──
  it('(g) symbol sets + patterns + grandfather reason shape', () => {
    expect(YAHOO_PRIMARY_PATTERNS).toContain('fetchYahooQuoteByCode');
    expect(YAHOO_PRIMARY_PATTERNS).toContain('fetchYahooQuote');
    expect(YAHOO_CLIENT_PATTERNS).toEqual(
      expect.arrayContaining([
        'fetchYahooConsensus',
        'fetchYahooIntradayBars',
        'fetchYahooBundle',
        'fetchYahooSector',
      ]),
    );
    expect([...DOMESTIC_YAHOO_SYMBOLS].sort()).toEqual(['KRW=X', '^KQ11', '^KS11']);
    expect(GLOBAL_WHITELIST_SYMBOLS.size).toBe(16);
    expect(GLOBAL_WHITELIST_SYMBOLS.has('^GSPC')).toBe(true);
    expect(GLOBAL_WHITELIST_SYMBOLS.has('DX-Y.NYB')).toBe(true);
    expect(WHITELIST.size).toBeGreaterThanOrEqual(15);
    expect(GRANDFATHER_ALLOWLIST.size).toBeGreaterThan(0);
    for (const [, meta] of GRANDFATHER_ALLOWLIST) {
      // ADR-0563: 실행경로 burn-down 완료 → 잔존 비실행 동결로 사유 재분류.
      expect(meta.reason).toBe('FROZEN_NON_EXECUTION_ADR0563');
      expect(Array.isArray(meta.lines)).toBe(true);
      expect(meta.lines.length).toBeGreaterThan(0);
    }
  });
});
