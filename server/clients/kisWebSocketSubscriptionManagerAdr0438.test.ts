/**
 * @responsibility ADR-0438 (= 사용자 명시 ADR-0442) 회귀 — `normalizeKrxCodeForWs` SSOT 위임 검증.
 *
 * ADR-0437 의 inline 정규식이 ADR-0438 SSOT 위임으로 통합. 동작 byte-equivalent 보존.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalizeKrxCodeForWs } from './kisWebSocketSubscriptionManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('ADR-0438 normalizeKrxCodeForWs — SSOT 위임 동작 보존', () => {
  it('정상 6자리 → 그대로 반환', () => {
    expect(normalizeKrxCodeForWs('005930')).toBe('005930');
    expect(normalizeKrxCodeForWs('247540')).toBe('247540');
  });

  it('.KS / .KQ suffix → strip', () => {
    expect(normalizeKrxCodeForWs('005930.KS')).toBe('005930');
    expect(normalizeKrxCodeForWs('247540.KQ')).toBe('247540');
  });

  it('.KOSPI / .KOSDAQ suffix → strip (ADR-0438 추가 지원)', () => {
    expect(normalizeKrxCodeForWs('005930.KOSPI')).toBe('005930');
    expect(normalizeKrxCodeForWs('247540.KOSDAQ')).toBe('247540');
  });

  it('소문자 suffix → uppercase 정규화 후 strip (ADR-0438 추가 지원)', () => {
    expect(normalizeKrxCodeForWs('005930.ks')).toBe('005930');
  });
});

describe('ADR-0438 normalizeKrxCodeForWs — invalid 시 null', () => {
  it('4자리 → null', () => {
    expect(normalizeKrxCodeForWs('5930')).toBeNull();
  });

  it('알파벳 포함 → null', () => {
    expect(normalizeKrxCodeForWs('0011TO')).toBeNull();
    expect(normalizeKrxCodeForWs('ABCDEF')).toBeNull();
  });

  it('빈 문자열 → null', () => {
    expect(normalizeKrxCodeForWs('')).toBeNull();
    expect(normalizeKrxCodeForWs('   ')).toBeNull();
  });

  it('null / undefined → null', () => {
    expect(normalizeKrxCodeForWs(null)).toBeNull();
    expect(normalizeKrxCodeForWs(undefined)).toBeNull();
  });

  it('non-string (number) → null', () => {
    expect(normalizeKrxCodeForWs(1234 as unknown)).toBeNull();
  });

  it('whitespace 양옆 → trim 후 처리', () => {
    expect(normalizeKrxCodeForWs(' 005930 ')).toBe('005930');
  });
});

describe('ADR-0438 정적 grep 가드 — inline 정규식 영구 차단', () => {
  function readSrc(relPath: string): string {
    return readFileSync(join(__dirname, relPath), 'utf-8');
  }

  it('kisWebSocketSubscriptionManager.ts: SSOT 위임 import 존재', () => {
    const src = readSrc('kisWebSocketSubscriptionManager.ts');
    expect(src).toMatch(
      /import\s*\{\s*normalizeKrxCode\s+as\s+normalizeKrxCodeSsot\s*\}\s+from\s+['"]\.\.\/utils\/symbolNormalizer\.js['"]/,
    );
  });

  it('kisWebSocketSubscriptionManager.ts: inline `/^[0-9]{6}$/` 정규식 영구 제거', () => {
    const src = readSrc('kisWebSocketSubscriptionManager.ts');
    // ADR-0437 의 `/^[0-9]{6}$/.test(s)` inline 패턴 영구 차단
    expect(src).not.toMatch(/\/\^\[0-9\]\{6\}\$\/\.test/);
  });

  it('kisWebSocketSubscriptionManager.ts: inline `.endsWith(\'.KS\')` 영구 제거', () => {
    const src = readSrc('kisWebSocketSubscriptionManager.ts');
    // suffix strip 도 SSOT 위임 — inline endsWith 영구 차단
    expect(src).not.toMatch(/\.endsWith\(['"]\.KS['"]\)/);
    expect(src).not.toMatch(/\.endsWith\(['"]\.KQ['"]\)/);
  });

  it('kisWebSocketSubscriptionManager.ts: ADR-0438 추적 주석 명시', () => {
    const src = readSrc('kisWebSocketSubscriptionManager.ts');
    expect(src).toMatch(/ADR-0438/);
  });
});
