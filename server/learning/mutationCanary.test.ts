/**
 * mutationCanary.test.ts — 판단 로직 카나리아 계약 고정.
 *
 * 판단 로직에 **의도된** 변경이 있을 때 이 테스트가 빨간불이 나야 운용자가
 * 기대값 업데이트 여부를 의식적으로 결정할 수 있다.
 */

import { describe, it, expect } from 'vitest';
import { runCanaryCases } from './mutationCanary.js';

describe('mutationCanary — 판단 로직 돌연변이 감지', () => {
  it('모든 카나리아 케이스가 현 평가기 구현으로 통과한다', () => {
    const results = runCanaryCases();
    const failures = results.filter(r => !r.ok);
    if (failures.length > 0) {
      // 실패 시 자세한 디버깅 정보 노출
      console.error('Canary failures:', JSON.stringify(failures, null, 2));
    }
    expect(failures).toEqual([]);
  });

  it('최소 2개 이상의 카나리아 케이스가 등록되어 있다', () => {
    // 케이스 수가 0 이면 카나리아 무의미 — 회귀로 케이스 삭제 방지
    expect(runCanaryCases().length).toBeGreaterThanOrEqual(2);
  });
});
