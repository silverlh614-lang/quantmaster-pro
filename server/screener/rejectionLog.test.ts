/**
 * @responsibility rejectionLog SSOT (PR-56) — module-local 변수 캡슐화 + setter 동작 검증
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getLastRejectionLog, setLastRejectionLog, type RejectionEntry } from './rejectionLog.js';

describe('rejectionLog SSOT', () => {
  beforeEach(() => {
    // 각 테스트 진입 시 빈 상태로 초기화 — 다른 테스트 누수 차단
    setLastRejectionLog([]);
  });

  it('초기 상태는 빈 배열', () => {
    expect(getLastRejectionLog()).toEqual([]);
  });

  it('setLastRejectionLog 후 getLastRejectionLog 가 동일 배열 반환', () => {
    const entries: RejectionEntry[] = [
      { code: '005930', name: '삼성전자', reason: 'Gate 점수 부족 +5점' },
      { code: '000660', name: 'SK하이닉스', reason: '거래량 -3% 부족' },
    ];
    setLastRejectionLog(entries);
    expect(getLastRejectionLog()).toEqual(entries);
  });

  it('재호출 시 전체 덮어쓰기 (append 아님)', () => {
    setLastRejectionLog([{ code: 'A', name: 'a', reason: 'r1' }]);
    setLastRejectionLog([{ code: 'B', name: 'b', reason: 'r2' }]);
    const log = getLastRejectionLog();
    expect(log).toHaveLength(1);
    expect(log[0].code).toBe('B');
  });

  it('빈 배열 setLastRejectionLog 로 리셋 가능', () => {
    setLastRejectionLog([{ code: 'X', name: 'x', reason: 'r' }]);
    expect(getLastRejectionLog()).toHaveLength(1);
    setLastRejectionLog([]);
    expect(getLastRejectionLog()).toEqual([]);
  });
});
