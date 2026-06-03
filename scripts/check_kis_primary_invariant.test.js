/**
 * @responsibility check_kis_primary_invariant 회귀 테스트 (ADR-0561)
 *
 * 검증:
 *   (a) 현 코드베이스 EXIT 0 (grandfather 통과 증명 — 신규 Yahoo-first 0건)
 *   (b) 가짜 신규 Yahoo-first fixture → 위반 탐지
 *   (c) 화이트리스트(router fallback / SSOT 위임 / provider adapter) → 통과(false positive 0)
 *   (d) GRANDFATHER_ALLOWLIST 등재처 → 통과(grandfather)
 *   (e) 주석·import·정의/위임·문자열 안 토큰·함수 reference 인자 → false positive 0
 *   (f) GRANDFATHER_ALLOWLIST 레지스트리 ↔ 가드 사양 ~10곳 일치 단언
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
  WHITELIST,
  GRANDFATHER_ALLOWLIST,
  isDefinitionLine,
  isCallLine,
} from './check_kis_primary_invariant.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');

/** 임시 파일에 src 를 써서 checkFile 로 검사. */
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

describe('check_kis_primary_invariant guard', () => {
  it('(a) current repo passes (grandfather EXIT 0)', () => {
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

  it('(b) a fake new Yahoo-first call IS detected as a violation', () => {
    const src = '  const quote = await fetchYahooQuoteByCode(stock.code, fetchYahooQuote);';
    const hits = checkSrc(src, 'server/rogue/newGate.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('fetchYahooQuoteByCode');
  });

  it('(b2) a fake new bare fetchYahooQuote primary call IS detected', () => {
    const src = '  const q = await fetchYahooQuote(symbol);';
    const hits = checkSrc(src, 'server/rogue/newGate.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('fetchYahooQuote');
  });

  it('(b3) the guard exits 1 when a non-allowlisted file has a violation (E2E)', () => {
    const rogueRel = 'server/__kis_primary_fixture_rogue__.ts';
    const rogueAbs = join(ROOT, rogueRel);
    writeFileSync(
      rogueAbs,
      '// rogue\nexport async function f(code, sym) {\n  return await fetchYahooQuoteByCode(code, sym);\n}\n',
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
    expect(out).toContain('ADR-0561');
  });

  it('(c) whitelisted files are exempt (router fallback / SSOT delegation / adapter)', () => {
    // 화이트리스트 파일은 checkFile 단에서 hit 가 나도 main() 면제 — 여기서는 WHITELIST 멤버십을 단언.
    expect(WHITELIST.has('server/screener/adapters/technicalQuoteRouter.ts')).toBe(true);
    expect(WHITELIST.has('server/screener/adapters/yahooSymbolResolver.ts')).toBe(true);
    expect(WHITELIST.has('server/screener/adapters/yahooQuoteAdapter.ts')).toBe(true);
  });

  it('(d) every GRANDFATHER_ALLOWLIST file genuinely contains the grepped Yahoo-first call', () => {
    // 등재처가 실제 위반을 포함해야(누락/오등재 방지). 라인 메타는 burn-down 추적용.
    for (const [relPath] of GRANDFATHER_ALLOWLIST) {
      const abs = join(ROOT, relPath);
      const hits = checkFile(abs, relPath);
      expect(hits.length, `${relPath} should contain a Yahoo-first call`).toBeGreaterThan(0);
    }
  });

  it('(e1) comment lines are NOT violations', () => {
    expect(checkSrc('  // const q = fetchYahooQuoteByCode(c, f)')).toHaveLength(0);
    expect(checkSrc('   * see fetchYahooQuote(symbol) above')).toHaveLength(0);
    expect(checkSrc('  /* fetchYahooQuoteByCode(c, f) */')).toHaveLength(0);
  });

  it('(e2) import / re-export lines are NOT violations', () => {
    expect(checkSrc("import { fetchYahooQuoteByCode } from './r.js';")).toHaveLength(0);
    expect(checkSrc("import { fetchYahooQuote, type Y } from './a.js';")).toHaveLength(0);
    expect(checkSrc("export { fetchYahooQuote } from './a.js';")).toHaveLength(0);
  });

  it('(e3) definition / delegation lines are NOT violations', () => {
    expect(
      checkSrc('export const fetchYahooQuoteByCode = fetchYahooQuoteWithMarketFallback;'),
    ).toHaveLength(0);
    expect(
      checkSrc('export async function fetchYahooQuote(symbol) { return null; }'),
    ).toHaveLength(0);
    expect(isDefinitionLine('export const fetchYahooQuoteByCode = x;', 'fetchYahooQuoteByCode')).toBe(true);
  });

  it('(e4) string-literal occurrences (error msg / log) are NOT violations', () => {
    expect(checkSrc('  throw new Error("use fetchYahooQuote(x) instead");')).toHaveLength(0);
    expect(checkSrc('  log(`called fetchYahooQuote(${s})`);')).toHaveLength(0);
  });

  it('(e5) function reference passed as arg (not a call) does not double-count', () => {
    // fetchYahooQuoteByCode(code, fetchYahooQuote) — 두 번째는 reference 인자(뒤에 "(" 없음) → 1건만.
    const hits = checkSrc('  const q = await fetchYahooQuoteByCode(code, fetchYahooQuote);');
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('fetchYahooQuoteByCode');
  });

  it('(e6) isCallLine word-boundary: fooFetchYahooQuote() is NOT a match', () => {
    expect(isCallLine('  fooFetchYahooQuote(x);', 'fetchYahooQuote')).toBe(false);
    expect(isCallLine('  fetchYahooQuote(x);', 'fetchYahooQuote')).toBe(true);
  });

  it('(f) registry shape: ~10 grandfather files, patterns + whitelist non-empty', () => {
    expect(YAHOO_PRIMARY_PATTERNS).toContain('fetchYahooQuoteByCode');
    expect(YAHOO_PRIMARY_PATTERNS).toContain('fetchYahooQuote');
    expect(WHITELIST.size).toBeGreaterThanOrEqual(3);
    // ADR-0561 가드 사양 §3 — 현존 ~10 파일(12 라인) 등재.
    expect(GRANDFATHER_ALLOWLIST.size).toBeGreaterThanOrEqual(10);
    for (const [, meta] of GRANDFATHER_ALLOWLIST) {
      expect(meta.reason).toBe('MIGRATION_PENDING_ADR0561');
      expect(Array.isArray(meta.lines)).toBe(true);
      expect(meta.lines.length).toBeGreaterThan(0);
    }
  });
});
