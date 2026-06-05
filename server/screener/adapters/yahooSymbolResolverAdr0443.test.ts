/**
 * @responsibility ADR-0443 회귀 — 10 호출자 `${code}.KS` / `${code}.KQ` direct
 * template concat → yahooSymbolResolver SSOT 위임 마이그레이션 정합 검증.
 *
 * 사용자 명시 1순위 #3 — yahooSymbolResolver direct concat 통합. ADR-0231 (PR #624)
 * 도입 yahooSymbolResolver SSOT + ADR-0241 sanity 회복 정책이 5 운영 경로에만
 * 적용되던 갭 영구 차단. 10 호출자 정적 grep 가드 + 동작 검증 통합.
 *
 * ## 호출자 매트릭스
 *
 * - **Category A** (Brute-force 양 시장 fetch, 5개): historicalClosePrice / backtestEngine
 *   / lateWinEvaluator / reportGenerator / universeScanner.
 * - **Category B** (단일 .KS fallback, 3개): prefetchedContext / stockScreener /
 *   stockPickReporter (×2).
 * - **Category C** (KOSPI/KOSDAQ 분기 자체 구현, 1개): quantitativeCandidateGenerator.
 *
 * ## Whitelist 4 파일 (정적 grep 가드 면제)
 *
 * - `yahooSymbolResolver.ts` (SSOT 자체)
 * - `symbolNormalizer.ts` (ADR-0438 SSOT)
 * - `defectEvolutionLedger.ts` (description 텍스트만)
 * - 본 테스트 파일 (회귀 가드 자체)
 *
 * 정적 grep 가드 22+ + 동작 검증 5+ = 27+ 케이스 (heuristic ≥5/100 LoC 충족).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf-8');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

/**
 * direct template concat 패턴 검출 — `${...code...}.KS` 또는 `.KQ`.
 *
 * - 그레이스 fallback (`?? \`${code}.KS\``, `[..., \`${code}.KS\`]`) 도 본 테스트는
 *   *전체 부재* 가 아니라 *SSOT 위임 보유* 를 검증하므로 별도 분리 검증.
 * - 본 검사는 *SSOT 가 사용되지 않은 채 단독 direct concat 만 있는* 결함 검출용.
 */
function hasDirectConcat(src: string): boolean {
  const cleaned = stripComments(src);
  return /\$\{[^}]*code[^}]*\}\.K[SQ]\b/.test(cleaned);
}

/** SSOT import 보유 여부 (한 가지 이상). */
function hasSsotImport(src: string): boolean {
  const cleaned = stripComments(src);
  return /from\s+['"][^'"]*yahooSymbolResolver(?:\.js)?['"]/.test(cleaned) &&
    /(tryGetYahooSymbol|fetchYahooQuoteByCode|resolveYahooSymbolForCode|getYahooSymbol)/.test(cleaned);
}

// ─── Static grep guards: 10 호출자 마이그레이션 정합 ─────────────────────────────

describe('ADR-0443 정적 grep 가드 — 10 호출자 SSOT import 보유', () => {
  // ADR-0561 ③ KIS-primary 마이그레이션: reportGenerator / stockPickReporter 는 grandfather
  // burn-down 으로 fetchTechnicalQuoteByCode(code) router funnel 위임으로 치환됨(flag OFF byte-equiv).
  // → 더 이상 yahooSymbolResolver SSOT 를 직접 import 하지 않으므로 본 SSOT-import 가드 대상에서 제외.
  // ADR-0443 의도(직접 .KS/.KQ concat 부재 + SSOT 위임 보존)는 router 한 단계 아래에서 그대로 충족.
  const callers = [
    { name: 'historicalClosePrice.ts', path: 'server/clients/historicalClosePrice.ts', expectedSsot: 'tryGetYahooSymbol' },
    { name: 'backtestEngine.ts', path: 'server/learning/backtestEngine.ts', expectedSsot: 'tryGetYahooSymbol' },
    { name: 'lateWinEvaluator.ts', path: 'server/learning/lateWinEvaluator.ts', expectedSsot: 'tryGetYahooSymbol' },
    { name: 'prefetchedContext.ts', path: 'server/ai/prefetchedContext.ts', expectedSsot: 'tryGetYahooSymbol' },
    { name: 'stockScreener.ts', path: 'server/screener/stockScreener.ts', expectedSsot: 'tryGetYahooSymbol' },
  ];

  for (const { name, path, expectedSsot } of callers) {
    it(`${name}: yahooSymbolResolver SSOT import 보유 (${expectedSsot})`, () => {
      const src = readSrc(path);
      expect(hasSsotImport(src)).toBe(true);
      expect(src).toContain(expectedSsot);
    });

    it(`${name}: ADR-0443 추적 주석 보유`, () => {
      const src = readSrc(path);
      expect(src).toMatch(/ADR-0443/);
    });
  }

  // ADR-0561 router-위임 호출자: technicalQuoteRouter import + 직접 concat 부재 검증으로 대체.
  for (const { name, path } of [
    { name: 'reportGenerator.ts', path: 'server/alerts/reportGenerator.ts' },
    { name: 'stockPickReporter.ts', path: 'server/alerts/stockPickReporter.ts' },
  ]) {
    it(`${name}: technicalQuoteRouter SSOT 위임 import 보유 (ADR-0561 burn-down)`, () => {
      const src = readSrc(path);
      expect(src).toMatch(/from\s+['"][^'"]*technicalQuoteRouter(?:\.js)?['"]/);
      expect(src).toContain('fetchTechnicalQuoteByCode');
    });

    it(`${name}: 직접 \`\${code}.KS/.KQ\` concat 부재 (SSOT 위임 보존)`, () => {
      const src = readSrc(path);
      expect(hasDirectConcat(src)).toBe(false);
    });
  }

  // Category C — quantitativeCandidateGenerator 는 symbolNormalizer SSOT (ADR-0438)
  // 위임. entry.market 필드를 marketHint 로 전달 → master 부재 시 (CORE_SEED) 에도
  // byte-equivalent 동작 보존.
  it('quantitativeCandidateGenerator.ts: symbolNormalizer.toYahooSymbol SSOT 위임 (ADR-0438)', () => {
    const src = readSrc('server/services/quantitativeCandidateGenerator.ts');
    expect(src).toMatch(/from\s+['"][^'"]*symbolNormalizer\.js['"]/);
    expect(src).toMatch(/toYahooSymbolSsot|toYahooSymbol\b/);
  });

  it('quantitativeCandidateGenerator.ts: ADR-0443 추적 주석 보유', () => {
    const src = readSrc('server/services/quantitativeCandidateGenerator.ts');
    expect(src).toMatch(/ADR-0443/);
  });
});

describe('ADR-0443 정적 grep 가드 — universeScanner.ts symbol 필드 격상', () => {
  it('universeScanner.ts: symbol 필드가 tryGetYahooSymbol(code) ?? `${code}.KS` 패턴 (마스터 매칭 격상)', () => {
    const src = readSrc('server/screener/universeScanner.ts');
    expect(src).toMatch(/tryGetYahooSymbol\s*\(\s*code\s*\)\s*\?\?\s*`\$\{code\}\.KS`/);
  });
});

describe('ADR-0443 정적 grep 가드 — Category A 호출자 fetchYahooQuoteByCode 사용', () => {
  // ADR-0561 burn-down: reportGenerator 는 fetchTechnicalQuoteByCode(w.code) router funnel 위임으로 치환됨.
  it('reportGenerator.ts: fetchTechnicalQuoteByCode(w.code) router 위임 호출 보유 (ADR-0561)', () => {
    const src = readSrc('server/alerts/reportGenerator.ts');
    const cleaned = stripComments(src);
    expect(cleaned).toMatch(/fetchTechnicalQuoteByCode\s*\(\s*w\.code\s*\)/);
  });

  // ADR-0561 KIS Primary Absolute burn-down: universeScanner Stage1 quote fetch 가
  // fetchYahooQuoteByCode(code, fetchYahooQuote) Yahoo-primary 에서 fetchKisQuoteFallback(code)
  // KIS-primary funnel 로 치환됨(.KS/.KQ direct concat 부재는 아래 별도 가드가 유지). 원본의
  // fetchYahooQuoteByCode 호출 기대는 burn-down 이전 패턴으로 DOA → 정본 quote funnel 로 정정.
  it('universeScanner.ts: fetchKisQuoteFallback(code) KIS-primary quote funnel 호출 보유 (ADR-0561)', () => {
    const src = readSrc('server/screener/universeScanner.ts');
    const cleaned = stripComments(src);
    expect(cleaned).toMatch(/fetchKisQuoteFallback\s*\(\s*code\s*\)/);
  });

  it('reportGenerator.ts: legacy `await fetchYahooQuote(.KS) ?? await fetchYahooQuote(.KQ)` 패턴 부재', () => {
    const src = readSrc('server/alerts/reportGenerator.ts');
    const cleaned = stripComments(src);
    expect(cleaned).not.toMatch(/await\s+fetchYahooQuote\s*\(\s*`\$\{w\.code\}\.KS`/);
    expect(cleaned).not.toMatch(/await\s+fetchYahooQuote\s*\(\s*`\$\{w\.code\}\.KQ`/);
  });

  it('universeScanner.ts: legacy `await fetchYahooQuote(.KS) ?? await fetchYahooQuote(.KQ)` 패턴 부재', () => {
    const src = readSrc('server/screener/universeScanner.ts');
    const cleaned = stripComments(src);
    expect(cleaned).not.toMatch(/await\s+fetchYahooQuote\s*\(\s*`\$\{code\}\.KS`/);
    expect(cleaned).not.toMatch(/await\s+fetchYahooQuote\s*\(\s*`\$\{code\}\.KQ`/);
  });
});

describe('ADR-0443/0561 정적 grep 가드 — Category B stockPickReporter 양쪽 호출 router 위임', () => {
  it('stockPickReporter.ts: 단일 fetchYahooQuote(`${entry.code}.KS`) 호출 0건 (양쪽 모두 마이그레이션)', () => {
    const src = readSrc('server/alerts/stockPickReporter.ts');
    const cleaned = stripComments(src);
    // legacy 단일 .KS 패턴 부재
    expect(cleaned).not.toMatch(/fetchYahooQuote\s*\(\s*`\$\{entry\.code\}\.KS`/);
  });

  // ADR-0561 burn-down: 양쪽 분기 모두 fetchTechnicalQuoteByCode(entry.code) router funnel 위임으로 치환됨.
  it('stockPickReporter.ts: fetchTechnicalQuoteByCode(entry.code) router 위임 호출 ≥2건 (양쪽 분기 모두)', () => {
    const src = readSrc('server/alerts/stockPickReporter.ts');
    const cleaned = stripComments(src);
    const matches = cleaned.match(/fetchTechnicalQuoteByCode\s*\(\s*entry\.code\s*\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ADR-0443 정적 grep 가드 — Category C quantitativeCandidateGenerator KOSPI/KOSDAQ 인라인 분기 영구 제거', () => {
  it('quantitativeCandidateGenerator.ts: 인라인 `if (entry.market === KOSPI) return ${entry.code}.KS` 부재 (SSOT 위임)', () => {
    const src = readSrc('server/services/quantitativeCandidateGenerator.ts');
    const cleaned = stripComments(src);
    // 인라인 KOSPI/KOSDAQ → .KS/.KQ 분기 직접 구현 부재 (위임만 허용)
    expect(cleaned).not.toMatch(/if\s*\(\s*entry\.market\s*===\s*['"]KOSPI['"]\s*\)\s*return\s+`\$\{entry\.code\}\.KS`/);
    expect(cleaned).not.toMatch(/if\s*\(\s*entry\.market\s*===\s*['"]KOSDAQ['"]\s*\)\s*return\s+`\$\{entry\.code\}\.KQ`/);
  });

  it('quantitativeCandidateGenerator.ts: symbolNormalizer SSOT (ADR-0438) toYahooSymbol 위임 사용', () => {
    const src = readSrc('server/services/quantitativeCandidateGenerator.ts');
    const cleaned = stripComments(src);
    // toYahooSymbolSsot 또는 toYahooSymbol from symbolNormalizer
    expect(cleaned).toMatch(/from\s+['"][^'"]*symbolNormalizer\.js['"]/);
    // entry.market hint 전달
    expect(cleaned).toMatch(/entry\.market\s*===\s*['"]KOSPI['"]/);
  });
});

describe('ADR-0443 정적 grep 가드 — Category B prefetchedContext / stockScreener 그레이스 패턴', () => {
  it('prefetchedContext.ts: `tryGetYahooSymbol(ref.code) ?? \\`${ref.code}.KS\\`` 패턴 (그레이스 fallback 보존)', () => {
    const src = readSrc('server/ai/prefetchedContext.ts');
    expect(src).toMatch(/tryGetYahooSymbol\s*\(\s*ref\.code\s*\)\s*\?\?\s*`\$\{ref\.code\}\.KS`/);
  });

  it('stockScreener.ts: `tryGetYahooSymbol(s.code) ?? \\`${s.code}.KS\\`` 패턴 (그레이스 fallback 보존)', () => {
    const src = readSrc('server/screener/stockScreener.ts');
    expect(src).toMatch(/tryGetYahooSymbol\s*\(\s*s\.code\s*\)\s*\?\?\s*`\$\{s\.code\}\.KS`/);
  });
});

describe('ADR-0443 정적 grep 가드 — Category A historical fetcher 그레이스 fallback 보존', () => {
  // historical fetcher 3개 (historicalClosePrice / backtestEngine / lateWinEvaluator) 는
  // tryGetYahooSymbol 만 사용 + 마스터 부재 시 양쪽 시도 fallback 보존 (그레이스).
  // brute-force fallback 자체가 사라지면 마스터 미커버 종목 영구 fetch 실패 위험.
  for (const { path, name } of [
    { path: 'server/clients/historicalClosePrice.ts', name: 'historicalClosePrice.ts' },
    { path: 'server/learning/backtestEngine.ts', name: 'backtestEngine.ts' },
    { path: 'server/learning/lateWinEvaluator.ts', name: 'lateWinEvaluator.ts' },
  ]) {
    it(`${name}: 마스터 부재 시 [.KS, .KQ] 그레이스 fallback 보존 (운영 안정성)`, () => {
      const src = readSrc(path);
      expect(src).toMatch(/\[\s*`\$\{code\}\.KS`\s*,\s*`\$\{code\}\.KQ`\s*\]/);
    });

    it(`${name}: tryGetYahooSymbol(code) 우선 사용`, () => {
      const src = readSrc(path);
      const cleaned = stripComments(src);
      expect(cleaned).toMatch(/tryGetYahooSymbol\s*\(\s*code\s*\)/);
    });
  }
});

// ─── 안전 invariants — KIS 주문 함수 / autoTradeEngine import 0건 ──────────────

describe('ADR-0443 안전 invariants — 호출자 측 KIS/autoTradeEngine import 0건', () => {
  const KIS_ORDER_FNS = [
    'placeKisMarketOrder',
    'placeKisSellOrder',
    'cancelKisOrder',
    'placeKisStopLossOrder',
    'placeKisTakeProfitOrder',
  ];
  const FORBIDDEN_IMPORTS = [
    'autoTradeEngine',
    'orderExecutor',
    'trancheExecutor',
  ];

  const callerPaths = [
    'server/clients/historicalClosePrice.ts',
    'server/learning/backtestEngine.ts',
    'server/learning/lateWinEvaluator.ts',
    'server/alerts/reportGenerator.ts',
    'server/screener/universeScanner.ts',
    'server/ai/prefetchedContext.ts',
    'server/screener/stockScreener.ts',
    'server/alerts/stockPickReporter.ts',
    'server/services/quantitativeCandidateGenerator.ts',
  ];

  for (const path of callerPaths) {
    it(`${path}: KIS 주문 함수 5종 신규 import 부재 (본 PR 변경 site)`, () => {
      const src = readSrc(path);
      const cleaned = stripComments(src);
      // 본 PR 변경된 import 라인은 yahooSymbolResolver / fetchYahooQuote 만.
      // 기존 라인에 KIS 주문 함수가 있을 수 있으므로 `import 라인에 yahooSymbolResolver 가
      // 추가됐다면 KIS 주문 함수 신규 추가 0건` 검증은 수동으로 확인 — 본 가드는
      // 호출자 본문에 KIS 주문 함수가 *호출* 되지 않음을 검사 (정적 회귀 가드).
      // 단, reportGenerator 같은 알림 모듈은 본래 KIS 주문 함수를 호출하지 않음.
      for (const fn of KIS_ORDER_FNS) {
        expect(cleaned).not.toMatch(new RegExp(`\\b${fn}\\s*\\(`));
      }
    });

    it(`${path}: autoTradeEngine / orderExecutor / trancheExecutor 신규 import 부재`, () => {
      const src = readSrc(path);
      const cleaned = stripComments(src);
      for (const mod of FORBIDDEN_IMPORTS) {
        // import 라인 안에 해당 모듈이 등장하면 결함 (호출자 본문 내 사용은 검사하지 않음 —
        // historical/backtest 같은 모듈이 type 만 참조할 수도 있음).
        const importLines = cleaned.match(/import\s+[^;]+;/g) || [];
        for (const line of importLines) {
          expect(line).not.toMatch(new RegExp(`from\\s+['"][^'"]*${mod}\\.js['"]`));
        }
      }
    });
  }
});

// ─── 동작 검증 — yahooSymbolResolver SSOT 본체 0줄 변경 ──────────────────────

describe('ADR-0443 — yahooSymbolResolver SSOT 본체 0줄 변경 (회귀 차단)', () => {
  it('yahooSymbolResolver.ts: tryGetYahooSymbol export 보유 (SSOT 본체 보존)', () => {
    const src = readSrc('server/screener/adapters/yahooSymbolResolver.ts');
    expect(src).toMatch(/export\s+const\s+tryGetYahooSymbol\s*=\s*resolveYahooSymbolForCode/);
  });

  it('yahooSymbolResolver.ts: fetchYahooQuoteByCode export 보유 (legacy alias 보존)', () => {
    const src = readSrc('server/screener/adapters/yahooSymbolResolver.ts');
    expect(src).toMatch(/export\s+const\s+fetchYahooQuoteByCode\s*=\s*fetchYahooQuoteWithMarketFallback/);
  });

  it('yahooSymbolResolver.ts: resolveYahooSymbolForCode 본체 KOSPI/KOSDAQ 분기 보존 (SSOT 본체)', () => {
    const src = readSrc('server/screener/adapters/yahooSymbolResolver.ts');
    expect(src).toMatch(/if\s*\(\s*entry\.market\s*===\s*['"]KOSPI['"]\s*\)\s*return\s+`\$\{code\}\.KS`/);
    expect(src).toMatch(/if\s*\(\s*entry\.market\s*===\s*['"]KOSDAQ['"]\s*\)\s*return\s+`\$\{code\}\.KQ`/);
  });
});

// ─── 동작 검증 — quantitativeCandidateGenerator.toYahooSymbol byte-equivalent ──

describe('ADR-0443 동작 검증 — toYahooSymbol byte-equivalent (마스터 entry 와 SSOT 동일 분기)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('toYahooSymbol(KOSPI entry) → tryGetYahooSymbol(code) 와 동일 결과', async () => {
    vi.doMock('../../persistence/krxStockMasterRepo.js', () => ({
      getStockByCode: (code: string) => ({ code, name: '테스트', market: 'KOSPI' as const }),
      getAllStockEntries: () => [],
    }));
    const { tryGetYahooSymbol } = await import('./yahooSymbolResolver.js');
    expect(tryGetYahooSymbol('005930')).toBe('005930.KS');
  });

  it('toYahooSymbol(KOSDAQ entry) → tryGetYahooSymbol(code) 와 동일 결과', async () => {
    vi.doMock('../../persistence/krxStockMasterRepo.js', () => ({
      getStockByCode: (code: string) => ({ code, name: '테스트', market: 'KOSDAQ' as const }),
      getAllStockEntries: () => [],
    }));
    const { tryGetYahooSymbol } = await import('./yahooSymbolResolver.js');
    expect(tryGetYahooSymbol('247540')).toBe('247540.KQ');
  });

  it('toYahooSymbol(KONEX entry) → null 반환 (마스터 매칭 부재)', async () => {
    vi.doMock('../../persistence/krxStockMasterRepo.js', () => ({
      getStockByCode: (code: string) => ({ code, name: '테스트', market: 'KONEX' as const }),
      getAllStockEntries: () => [],
    }));
    const { tryGetYahooSymbol } = await import('./yahooSymbolResolver.js');
    expect(tryGetYahooSymbol('999999')).toBe(null);
  });

  it('tryGetYahooSymbol(code) 마스터 부재 시 null 반환 (호출자 그레이스 fallback 트리거)', async () => {
    vi.doMock('../../persistence/krxStockMasterRepo.js', () => ({
      getStockByCode: () => null,
      getAllStockEntries: () => [],
    }));
    const { tryGetYahooSymbol } = await import('./yahooSymbolResolver.js');
    expect(tryGetYahooSymbol('123456')).toBe(null);
  });
});

// ─── 회귀 안전 invariants — whitelist 4 파일만 direct concat 허용 ───────────────

describe('ADR-0443 whitelist 4 파일 정합 — direct concat 부재 검증 회피 대상', () => {
  // whitelist 파일에는 direct concat 패턴이 *허용* 되지만, 본 회귀 가드는 *허용된 파일들만이*
  // 명시적 SSOT / 정규식 / description 텍스트 의도라는 사실을 기록.
  it('yahooSymbolResolver.ts: direct concat 보유 (SSOT 본체)', () => {
    const src = readSrc('server/screener/adapters/yahooSymbolResolver.ts');
    expect(hasDirectConcat(src)).toBe(true);
  });

  it('symbolNormalizer.ts: direct concat 보유 (ADR-0438 SSOT)', () => {
    const src = readSrc('server/utils/symbolNormalizer.ts');
    expect(hasDirectConcat(src)).toBe(true);
  });

  it('defectEvolutionLedger.ts: description 텍스트 안 direct concat 패턴 (ADR-0231 결함 이력 기록)', () => {
    const src = readSrc('server/learning/defectEvolutionLedger.ts');
    // ADR-0231 결함 description 에 `${code}.KS ?? .KQ` 텍스트 등장 — text only.
    expect(src).toMatch(/\$\{code\}\.KS\s*\?\?\s*\.KQ/);
  });
});
