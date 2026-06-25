/**
 * @responsibility ADR-0651 W3 — circuit 키 격리 검증. leader 전용 namespaced 키(`${trId}#LEADER`)의
 * 404 누적이 screener 가 쓰는 원본 trId circuit 을 trip/blackhole 하지 않음 + screener circuit byte-equivalent.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __testOnly, resetKisCircuits } from './resilience.js';

const SCREENER_TR = 'FHPST01710000';        // screener volume 이 직접 쓰는 원본 trId
const LEADER_KEY = `${SCREENER_TR}#LEADER`;  // leader 경로 namespaced circuit 키

// soft(404) circuit 임계 — resilience.ts CIRCUIT_THRESHOLD_SOFT(10)
const SOFT_THRESHOLD = 10;

describe('ADR-0651 W3 — leader namespaced circuit 격리', () => {
  beforeEach(() => {
    resetKisCircuits();
    __testOnly.resetRecoveryLogRateLimit();
  });
  afterEach(() => {
    resetKisCircuits();
  });

  it('leader 키 404 반복(임계 초과)이 원본 trId circuit 을 OPEN 시키지 않는다', () => {
    // leader 전용 키로 임계 이상 404 누적 → leader 키 circuit OPEN.
    for (let i = 0; i < SOFT_THRESHOLD; i++) {
      __testOnly.recordFailure(LEADER_KEY, 404);
    }
    expect(__testOnly.isOpen(LEADER_KEY)).toBe(true);

    // 핵심 단언: screener 의 원본 trId circuit 은 무오염(false).
    expect(__testOnly.isOpen(SCREENER_TR)).toBe(false);
  });

  it('screener 원본 trId 의 직접 404 누적 → 정상 OPEN (byte-equivalent 회귀)', () => {
    for (let i = 0; i < SOFT_THRESHOLD; i++) {
      __testOnly.recordFailure(SCREENER_TR, 404);
    }
    // screener circuit 은 leader 격리와 무관하게 자기 임계로 정상 동작.
    expect(__testOnly.isOpen(SCREENER_TR)).toBe(true);
    // 반대로 leader 키는 미오염.
    expect(__testOnly.isOpen(LEADER_KEY)).toBe(false);
  });

  it('leader 키 OPEN 상태에서 screener 직접 호출 회로는 여전히 닫혀 있다(blackhole 미발생)', () => {
    for (let i = 0; i < SOFT_THRESHOLD; i++) {
      __testOnly.recordFailure(LEADER_KEY, 404);
    }
    expect(__testOnly.isOpen(LEADER_KEY)).toBe(true);
    // screener 가 직후 동일 trId 로 호출해도 회로는 닫힘 → 정상 fetch 가능(stale fallback 회피).
    expect(__testOnly.isOpen(SCREENER_TR)).toBe(false);
  });

  it('leader 키 성공 시 leader 키만 복구 — 원본 trId 카운터에 누수 없음', () => {
    for (let i = 0; i < 3; i++) __testOnly.recordFailure(LEADER_KEY, 500); // hard 404 임계 도달
    expect(__testOnly.isOpen(LEADER_KEY)).toBe(true);
    __testOnly.recordSuccess(LEADER_KEY);
    expect(__testOnly.isOpen(LEADER_KEY)).toBe(false);
    expect(__testOnly.isOpen(SCREENER_TR)).toBe(false);
  });
});
