/**
 * aiCacheRepo.test.ts — PR-3 #3 canonical cache key 계약.
 *
 * makeCanonicalCacheKey 는 동일 의미의 입력에 대해 동일 키를 생성해야 하며,
 * 프롬프트 공백·JSON 키 순서·모델명 대소문자 같은 표면 차이를 흡수해야 한다.
 */

import { describe, it, expect } from 'vitest';
import { makeCanonicalCacheKey } from './aiCacheRepo.js';

describe('makeCanonicalCacheKey', () => {
  it('공백 정규화 — 연속 공백은 단일 공백으로 동일 키', () => {
    const a = makeCanonicalCacheKey({ prompt: 'hello  world\n\ttest' });
    const b = makeCanonicalCacheKey({ prompt: 'hello world test' });
    expect(a).toBe(b);
  });

  it('앞뒤 공백·탭·줄바꿈 trim 은 동일 키', () => {
    const a = makeCanonicalCacheKey({ prompt: '\n\n  analyze stocks  \t' });
    const b = makeCanonicalCacheKey({ prompt: 'analyze stocks' });
    expect(a).toBe(b);
  });

  it('JSON params 키 순서 변경은 동일 키', () => {
    const a = makeCanonicalCacheKey({
      prompt: 'x', params: { b: 2, a: 1, c: { y: 20, x: 10 } },
    });
    const b = makeCanonicalCacheKey({
      prompt: 'x', params: { a: 1, c: { x: 10, y: 20 }, b: 2 },
    });
    expect(a).toBe(b);
  });

  it('모델명 대소문자 무관', () => {
    // SDS validator 가 실제 모델 식별자 상수 외 사용을 경고하므로, 여기서는
    // 정규화 로직 자체를 검증하기 위해 추상 모델명을 사용한다.
    const a = makeCanonicalCacheKey({ prompt: 'x', model: 'Test-MODEL-Alpha' });
    const b = makeCanonicalCacheKey({ prompt: 'x', model: 'test-model-alpha' });
    expect(a).toBe(b);
  });

  it('scope 가 다르면 다른 키', () => {
    const a = makeCanonicalCacheKey({ prompt: 'x', scope: 'reportGenerator' });
    const b = makeCanonicalCacheKey({ prompt: 'x', scope: 'persona' });
    expect(a).not.toBe(b);
  });

  it('프롬프트 내용이 실질 변경되면 다른 키', () => {
    const a = makeCanonicalCacheKey({ prompt: 'analyze A' });
    const b = makeCanonicalCacheKey({ prompt: 'analyze B' });
    expect(a).not.toBe(b);
  });

  it('v1 접두사와 12자 해시 형식', () => {
    const key = makeCanonicalCacheKey({ prompt: 'any input' });
    expect(key).toMatch(/^v1:[0-9a-f]{12}$/);
  });
});
