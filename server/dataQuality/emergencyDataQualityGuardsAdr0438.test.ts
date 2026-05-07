/**
 * @responsibility ADR-0438 (= 사용자 명시 ADR-0442) 회귀 — emergencyDataQualityGuards SSOT 위임 검증.
 *
 * 4개 기존 호출자 (watchlistRepo / buyPipeline / historicalClosePrice /
 * kisWebSocketSubscriptionManager) 의 `normalizeKrxCode` import 자체는 변경 0 —
 * 본 모듈이 SSOT 위임 wrapper 가 되므로 자동 흡수.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  normalizeKrxCode,
  assertValidKrxCode,
  DataQualityError,
} from './emergencyDataQualityGuards.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('ADR-0438 emergencyDataQualityGuards.normalizeKrxCode — wrapper 후방호환', () => {
  it('정상 6자리 → 그대로 (시그니처 string | null 보존)', () => {
    expect(normalizeKrxCode('005930')).toBe('005930');
  });

  it('.KS suffix → strip', () => {
    expect(normalizeKrxCode('005930.KS')).toBe('005930');
  });

  it('invalid → null (DataQualityError throw 안 함)', () => {
    expect(normalizeKrxCode('0011TO')).toBeNull();
    expect(normalizeKrxCode('5930')).toBeNull();
    expect(normalizeKrxCode(null)).toBeNull();
    expect(normalizeKrxCode(undefined)).toBeNull();
  });

  it('whitespace trim', () => {
    expect(normalizeKrxCode(' 005930 ')).toBe('005930');
  });

  it('SSOT 동작과 byte-equivalent — 4개 호출자 시그니처 보존', () => {
    // watchlistRepo / buyPipeline / historicalClosePrice / kisWebSocketSubscriptionManager
    // 가 사용하는 unknown → string | null 시그니처 그대로.
    const result: string | null = normalizeKrxCode('005930');
    expect(result).toBe('005930');
    const invalid: string | null = normalizeKrxCode('XYZ');
    expect(invalid).toBeNull();
  });
});

describe('ADR-0438 emergencyDataQualityGuards.assertValidKrxCode — wrapper 후방호환', () => {
  it('정상 6자리 → code 반환', () => {
    expect(assertValidKrxCode('005930')).toBe('005930');
  });

  it('invalid → DataQualityError throw (code=INVALID_KRX_CODE)', () => {
    let caught: unknown;
    try {
      assertValidKrxCode('0011TO');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DataQualityError);
    expect((caught as DataQualityError).code).toBe('INVALID_KRX_CODE');
  });
});

describe('ADR-0438 정적 grep 가드 — wrapper 정합', () => {
  function readSrc(relPath: string): string {
    return readFileSync(join(__dirname, relPath), 'utf-8');
  }

  it('emergencyDataQualityGuards.ts: symbolNormalizer SSOT import 존재', () => {
    const src = readSrc('emergencyDataQualityGuards.ts');
    expect(src).toMatch(
      /import\s*\*\s*as\s+symbolNormalizerSsot\s+from\s+['"]\.\.\/utils\/symbolNormalizer\.js['"]/,
    );
  });

  it('emergencyDataQualityGuards.ts: 기존 inline 정규식 영구 제거 (SSOT 위임)', () => {
    const src = readSrc('emergencyDataQualityGuards.ts');
    // 본문에 `^\d{6}$` 정규식 inline 영구 차단 (DataQualityError throw 메시지 제외)
    const stripComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    // 메시지 텍스트 ('exactly 6 numeric digits') 는 허용, 정규식 패턴은 차단
    expect(stripComments).not.toMatch(/\.replace\(.*\\\.KS\$/);
    expect(stripComments).not.toMatch(/test\(code\)/);
  });

  it('emergencyDataQualityGuards.ts: @deprecated ADR-0438 명시', () => {
    const src = readSrc('emergencyDataQualityGuards.ts');
    expect(src).toMatch(/@deprecated ADR-0438/);
  });

  it('emergencyDataQualityGuards.ts: symbolNormalizerSsot 함수 호출 존재', () => {
    const src = readSrc('emergencyDataQualityGuards.ts');
    expect(src).toMatch(/symbolNormalizerSsot\.normalizeKrxCode/);
    expect(src).toMatch(/symbolNormalizerSsot\.assertValidKrxCode/);
  });
});
