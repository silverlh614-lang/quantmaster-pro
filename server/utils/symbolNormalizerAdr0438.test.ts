/**
 * @responsibility ADR-0438 (= 사용자 명시 ADR-0442) 회귀 테스트 — Symbol Normalizer SSOT.
 *
 * 16+ normalizeKrxCode 케이스 + 8 toYahooSymbol 케이스 + 4 ENV 케이스 +
 * 3 assertValidKrxCode 케이스 + 6 정적 grep 가드 = 37+ 케이스.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  normalizeKrxCode,
  toYahooSymbol,
  assertValidKrxCode,
  isSymbolNormalizerStrictDisabled,
  type NormalizedKrxSymbol,
} from './symbolNormalizer.js';

import * as krxStockMasterRepo from '../persistence/krxStockMasterRepo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('ADR-0438 normalizeKrxCode — 정상 분기', () => {
  it('TC1: "005930" → OK', () => {
    const result = normalizeKrxCode('005930');
    expect(result.valid).toBe(true);
    expect(result.code).toBe('005930');
    expect(result.reason).toBe('OK');
    expect(result.marketSuffix).toBeUndefined();
  });

  it('TC2: "005930.KS" → SUFFIX_STRIPPED + marketSuffix=KS', () => {
    const result = normalizeKrxCode('005930.KS');
    expect(result.valid).toBe(true);
    expect(result.code).toBe('005930');
    expect(result.reason).toBe('SUFFIX_STRIPPED');
    expect(result.marketSuffix).toBe('KS');
  });

  it('TC3: "247540.KQ" → SUFFIX_STRIPPED + marketSuffix=KQ', () => {
    const result = normalizeKrxCode('247540.KQ');
    expect(result.valid).toBe(true);
    expect(result.code).toBe('247540');
    expect(result.reason).toBe('SUFFIX_STRIPPED');
    expect(result.marketSuffix).toBe('KQ');
  });

  it('TC4: "005930.KOSPI" → SUFFIX_STRIPPED + marketSuffix=KS', () => {
    const result = normalizeKrxCode('005930.KOSPI');
    expect(result.valid).toBe(true);
    expect(result.code).toBe('005930');
    expect(result.reason).toBe('SUFFIX_STRIPPED');
    expect(result.marketSuffix).toBe('KS');
  });

  it('TC5: "247540.KOSDAQ" → SUFFIX_STRIPPED + marketSuffix=KQ', () => {
    const result = normalizeKrxCode('247540.KOSDAQ');
    expect(result.valid).toBe(true);
    expect(result.code).toBe('247540');
    expect(result.reason).toBe('SUFFIX_STRIPPED');
    expect(result.marketSuffix).toBe('KQ');
  });

  it('TC6: " 005930 " → OK (trim)', () => {
    const result = normalizeKrxCode(' 005930 ');
    expect(result.valid).toBe(true);
    expect(result.code).toBe('005930');
    expect(result.reason).toBe('OK');
  });

  it('TC7: "005930.kS" 소문자 → SUFFIX_STRIPPED (uppercase 정규화)', () => {
    const result = normalizeKrxCode('005930.kS');
    expect(result.valid).toBe(true);
    expect(result.code).toBe('005930');
    expect(result.reason).toBe('SUFFIX_STRIPPED');
    expect(result.marketSuffix).toBe('KS');
  });
});

describe('ADR-0438 normalizeKrxCode — invalid 분기', () => {
  it('TC8: "0011TO" → NON_NUMERIC', () => {
    const result = normalizeKrxCode('0011TO');
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toBe('NON_NUMERIC');
  });

  it('TC9: "ABCDEF" → NON_NUMERIC', () => {
    const result = normalizeKrxCode('ABCDEF');
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toBe('NON_NUMERIC');
  });

  it('TC10: "5930" → INVALID_LENGTH (모두 숫자, 6자리 미달)', () => {
    const result = normalizeKrxCode('5930');
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toBe('INVALID_LENGTH');
  });

  it('TC11: "0059300" → INVALID_LENGTH (모두 숫자, 6자리 초과)', () => {
    const result = normalizeKrxCode('0059300');
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toBe('INVALID_LENGTH');
  });

  it('TC12: "" → EMPTY', () => {
    const result = normalizeKrxCode('');
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toBe('EMPTY');
  });

  it('TC13: null → EMPTY', () => {
    const result = normalizeKrxCode(null);
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toBe('EMPTY');
  });

  it('TC14: undefined → EMPTY', () => {
    const result = normalizeKrxCode(undefined);
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toBe('EMPTY');
  });

  it('TC15: 1234 (number) → EMPTY (non-string)', () => {
    const result = normalizeKrxCode(1234 as unknown);
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toBe('EMPTY');
  });

  it('TC16: "  " (whitespace) → EMPTY', () => {
    const result = normalizeKrxCode('  ');
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toBe('EMPTY');
  });

  it('TC17 보너스: ".KS" 만 (suffix 단독) → EMPTY', () => {
    const result = normalizeKrxCode('.KS');
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toBe('EMPTY');
  });

  it('TC18 보너스: "00593O.KS" (O 영문) → NON_NUMERIC after suffix strip', () => {
    const result = normalizeKrxCode('00593O.KS');
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toBe('NON_NUMERIC');
  });
});

describe('ADR-0438 toYahooSymbol — master lookup + fallback', () => {
  let getStockByCodeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getStockByCodeSpy = vi.spyOn(krxStockMasterRepo, 'getStockByCode');
  });

  afterEach(() => {
    getStockByCodeSpy.mockRestore();
  });

  it('TC19: "005930" KOSPI master → OK + .KS', () => {
    getStockByCodeSpy.mockReturnValue({
      code: '005930',
      name: '삼성전자',
      market: 'KOSPI',
    });
    const result = toYahooSymbol('005930');
    expect(result.status).toBe('OK');
    expect(result.yahooSymbol).toBe('005930.KS');
    expect(result.marketSuffix).toBe('KS');
    expect(result.fallback).toBeUndefined();
  });

  it('TC20: "247540" KOSDAQ master → OK + .KQ', () => {
    getStockByCodeSpy.mockReturnValue({
      code: '247540',
      name: '에코프로비엠',
      market: 'KOSDAQ',
    });
    const result = toYahooSymbol('247540');
    expect(result.status).toBe('OK');
    expect(result.yahooSymbol).toBe('247540.KQ');
    expect(result.marketSuffix).toBe('KQ');
  });

  it('TC21: "999999" master 부재 + hint=KS → FALLBACK_SYMBOL + .KS + fallback=true', () => {
    getStockByCodeSpy.mockReturnValue(null);
    const result = toYahooSymbol('999999', 'KS');
    expect(result.status).toBe('FALLBACK_SYMBOL');
    expect(result.yahooSymbol).toBe('999999.KS');
    expect(result.marketSuffix).toBe('KS');
    expect(result.fallback).toBe(true);
  });

  it('TC22: "999999" master 부재 + 무 hint → MASTER_MISSING + null', () => {
    getStockByCodeSpy.mockReturnValue(null);
    const result = toYahooSymbol('999999');
    expect(result.status).toBe('MASTER_MISSING');
    expect(result.yahooSymbol).toBeNull();
    expect(result.fallback).toBeUndefined();
  });

  it('TC23: "0011TO" → INVALID_SYMBOL + null', () => {
    const result = toYahooSymbol('0011TO');
    expect(result.status).toBe('INVALID_SYMBOL');
    expect(result.yahooSymbol).toBeNull();
  });

  it('TC24: "" → INVALID_SYMBOL + null', () => {
    const result = toYahooSymbol('');
    expect(result.status).toBe('INVALID_SYMBOL');
    expect(result.yahooSymbol).toBeNull();
  });

  it('TC25: "005930.KS" master 매칭 → OK + .KS (suffix strip 후 lookup)', () => {
    getStockByCodeSpy.mockReturnValue({
      code: '005930',
      name: '삼성전자',
      market: 'KOSPI',
    });
    const result = toYahooSymbol('005930.KS');
    expect(result.status).toBe('OK');
    expect(result.yahooSymbol).toBe('005930.KS');
    expect(getStockByCodeSpy).toHaveBeenCalledWith('005930'); // suffix strip 후 6자리만 lookup
  });

  it('TC26: "ABCDEF" → INVALID_SYMBOL + null (master lookup 호출 0)', () => {
    const result = toYahooSymbol('ABCDEF');
    expect(result.status).toBe('INVALID_SYMBOL');
    expect(result.yahooSymbol).toBeNull();
    // invalid 시 master lookup 호출 0 — KRX 호출 quota 보호
    expect(getStockByCodeSpy).not.toHaveBeenCalled();
  });

  it('TC27 보너스: "999999.KS" master 부재 + suffix 잔존 → FALLBACK_SYMBOL + .KS', () => {
    getStockByCodeSpy.mockReturnValue(null);
    const result = toYahooSymbol('999999.KS');
    expect(result.status).toBe('FALLBACK_SYMBOL');
    expect(result.yahooSymbol).toBe('999999.KS');
    expect(result.fallback).toBe(true);
  });

  it('TC28 보너스: master throw → fallback 적용', () => {
    getStockByCodeSpy.mockImplementation(() => {
      throw new Error('master corrupted');
    });
    const result = toYahooSymbol('005930', 'KS');
    expect(result.status).toBe('FALLBACK_SYMBOL');
    expect(result.yahooSymbol).toBe('005930.KS');
  });
});

describe('ADR-0438 isSymbolNormalizerStrictDisabled — ENV gate (ADR-0157 정확 비교)', () => {
  const ORIGINAL = process.env.SYMBOL_NORMALIZER_STRICT_DISABLED;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.SYMBOL_NORMALIZER_STRICT_DISABLED;
    } else {
      process.env.SYMBOL_NORMALIZER_STRICT_DISABLED = ORIGINAL;
    }
  });

  it('default OFF (미설정) → false', () => {
    delete process.env.SYMBOL_NORMALIZER_STRICT_DISABLED;
    expect(isSymbolNormalizerStrictDisabled()).toBe(false);
  });

  it('"true" → true', () => {
    process.env.SYMBOL_NORMALIZER_STRICT_DISABLED = 'true';
    expect(isSymbolNormalizerStrictDisabled()).toBe(true);
  });

  it('"1" 거부 (정확 비교)', () => {
    process.env.SYMBOL_NORMALIZER_STRICT_DISABLED = '1';
    expect(isSymbolNormalizerStrictDisabled()).toBe(false);
  });

  it('"TRUE" 대문자 거부', () => {
    process.env.SYMBOL_NORMALIZER_STRICT_DISABLED = 'TRUE';
    expect(isSymbolNormalizerStrictDisabled()).toBe(false);
  });
});

describe('ADR-0438 assertValidKrxCode — throw 정책', () => {
  it('정상 6자리 → code 반환', () => {
    expect(assertValidKrxCode('005930')).toBe('005930');
  });

  it('invalid → DataQualityError throw', () => {
    expect(() => assertValidKrxCode('0011TO')).toThrow(/INVALID_KRX_CODE/);
  });

  it('null → throw', () => {
    expect(() => assertValidKrxCode(null)).toThrow();
  });
});

describe('ADR-0438 정적 grep 가드 — 호출자 측 SSOT 위반 차단', () => {
  function readSrc(relPath: string): string {
    return readFileSync(join(__dirname, relPath), 'utf-8');
  }

  it('symbolNormalizer.ts: KIS 주문 함수 5종 import 0건', () => {
    const src = readSrc('symbolNormalizer.ts');
    expect(src).not.toMatch(/placeKisMarketBuyOrder/);
    expect(src).not.toMatch(/placeKisSellOrder/);
    expect(src).not.toMatch(/cancelKisOrder/);
    expect(src).not.toMatch(/placeKisStopLossOrder/);
    expect(src).not.toMatch(/placeKisTakeProfitOrder/);
  });

  it('symbolNormalizer.ts: fetch / axios / node-fetch import 0건', () => {
    const src = readSrc('symbolNormalizer.ts');
    expect(src).not.toMatch(/from\s+['"]node-fetch['"]/);
    expect(src).not.toMatch(/from\s+['"]axios['"]/);
    // `fetch(` direct call (function bodies, exclude type imports)
    const stripComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(stripComments).not.toMatch(/\bfetch\s*\(/);
  });

  it('symbolNormalizer.ts: autoTradeEngine import 0건', () => {
    const src = readSrc('symbolNormalizer.ts');
    expect(src).not.toMatch(/autoTradeEngine/);
  });

  it('symbolNormalizer.ts: Gate threshold / setGateThreshold / GATE_RELAX 변경 0건', () => {
    const src = readSrc('symbolNormalizer.ts');
    expect(src).not.toMatch(/setGateThreshold/);
    expect(src).not.toMatch(/GATE_RELAX/);
    expect(src).not.toMatch(/STRONG_BUY_OVERRIDE/);
  });

  it('symbolNormalizer.ts: counterfactual 자동 paper/live 승격 0건', () => {
    const src = readSrc('symbolNormalizer.ts');
    expect(src).not.toMatch(/promoteToLive/);
    expect(src).not.toMatch(/promoteToPaper/);
    expect(src).not.toMatch(/autoPromote/);
  });

  it('symbolNormalizer.ts: KRX_CODE_RE 정규식 단일 위치 (SSOT)', () => {
    const src = readSrc('symbolNormalizer.ts');
    // 6자리 숫자 정규식이 정확히 한 번만 정의 (KRX_CODE_RE 상수)
    const matches = src.match(/\\d\{6\}/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(2); // 본문 + 주석/문서
  });
});

describe('ADR-0438 NormalizedKrxSymbol type 정합', () => {
  it('valid=true 시 code 항상 6자리 숫자', () => {
    const result: NormalizedKrxSymbol = normalizeKrxCode('005930');
    if (result.valid) {
      expect(result.code).not.toBeNull();
      expect(result.code).toMatch(/^\d{6}$/);
    }
  });

  it('valid=false 시 code 항상 null', () => {
    const result = normalizeKrxCode('0011TO');
    expect(result.valid).toBe(false);
    expect(result.code).toBeNull();
  });

  it('raw 항상 보존 (진단용)', () => {
    const result = normalizeKrxCode('005930.KS');
    expect(result.raw).toBe('005930.KS');
  });
});
