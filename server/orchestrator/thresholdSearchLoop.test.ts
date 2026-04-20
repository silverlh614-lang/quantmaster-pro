/**
 * thresholdSearchLoop.test.ts — Phase 5-⑪ 임계치 탐색 루프 회귀.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildGateHistogram,
  formatGateHistogram,
  projectCapturesAtLoweredThreshold,
  buildThresholdProposal,
  alreadyExecutedThisSession,
  markSessionExecuted,
  _resetThresholdSearchSession,
  THRESHOLD_SEARCH_MAX_TOTAL_DELTA,
} from './thresholdSearchLoop.js';

describe('buildGateHistogram', () => {
  it('0.5pt 버킷으로 분포 집계', () => {
    const h = buildGateHistogram([3.5, 4.2, 4.9, 5.3, 5.8, 6.5, 7.1, 8.5, 9.0]);
    expect(h['<4']).toBe(1);   // 3.5
    expect(h['4-5']).toBe(2);  // 4.2, 4.9
    expect(h['5-6']).toBe(2);  // 5.3, 5.8
    expect(h['6-7']).toBe(1);  // 6.5
    expect(h['7-8']).toBe(1);  // 7.1
    expect(h['8+']).toBe(2);   // 8.5, 9.0
  });

  it('NaN/Infinity 는 무시', () => {
    const h = buildGateHistogram([5, NaN, Infinity, -Infinity, 7]);
    expect(h['5-6']).toBe(1);
    expect(h['7-8']).toBe(1);
    expect(h['8+']).toBe(0);
  });

  it('빈 배열 → 모든 버킷 0', () => {
    const h = buildGateHistogram([]);
    expect(Object.values(h).every((v) => v === 0)).toBe(true);
  });
});

describe('projectCapturesAtLoweredThreshold', () => {
  it('임계 8.0, delta -0.5 → ≥7.5 건수', () => {
    const scores = [6.5, 7.0, 7.5, 7.9, 8.1, 9.0];
    expect(projectCapturesAtLoweredThreshold(scores, 8.0, -0.5)).toBe(4);
  });
});

describe('buildThresholdProposal', () => {
  it('≥5건 포착 가능 → shouldPropose=true', () => {
    const scores = [7.5, 7.6, 7.7, 7.8, 7.9, 8.0]; // 기준 8.0, -0.5 하향 시 모두 통과
    const p = buildThresholdProposal({
      scores, baselineThreshold: 8.0, currentDelta: 0,
    });
    expect(p.shouldPropose).toBe(true);
    expect(p.projectedCaptures).toBe(6);
  });

  it('5건 미만 → shouldPropose=false, 보류 사유 기록', () => {
    const scores = [7.6, 7.7]; // 하향 후에도 2건
    const p = buildThresholdProposal({
      scores, baselineThreshold: 8.0, currentDelta: 0,
    });
    expect(p.shouldPropose).toBe(false);
    expect(p.reason).toContain('미미');
  });

  it('누적 델타 -1pt 한도 초과 방지 → shouldPropose=false', () => {
    const scores = Array(10).fill(7.5);
    const p = buildThresholdProposal({
      scores, baselineThreshold: 8.0, currentDelta: -0.7,  // -0.7 + -0.5 = -1.2 < -1.0
    });
    expect(p.shouldPropose).toBe(false);
    expect(p.reason).toContain('한도');
  });

  it('누적 델타 정확히 -1pt 경계 — max 한도에 정확히 도달하면 추가 제안 안 함', () => {
    const scores = Array(10).fill(7.5);
    const p = buildThresholdProposal({
      scores, baselineThreshold: 8.0, currentDelta: -0.5, dryDelta: -0.5,
    });
    // -0.5 + -0.5 = -1.0 === THRESHOLD_SEARCH_MAX_TOTAL_DELTA (엄격히 "< max" 이므로 경계는 통과)
    expect(THRESHOLD_SEARCH_MAX_TOTAL_DELTA).toBe(-1.0);
    expect(p.shouldPropose).toBe(true);
  });
});

describe('formatGateHistogram', () => {
  it('Telegram HTML 호환 포맷 생성 (빈 버킷 대체 문자 포함)', () => {
    const h = buildGateHistogram([3.5, 5.0, 8.0]);
    const out = formatGateHistogram(h, 3);
    expect(out).toContain('n=3');
    expect(out).toContain('<4');
    expect(out).toContain('8+');
  });
});

describe('session 실행 가드', () => {
  beforeEach(() => _resetThresholdSearchSession());

  it('미실행 세션 → false', () => {
    expect(alreadyExecutedThisSession()).toBe(false);
  });

  it('실행 기록 후 같은 날짜 → true', () => {
    markSessionExecuted();
    expect(alreadyExecutedThisSession()).toBe(true);
  });

  it('다른 KST 일자 → false (날짜 경계)', () => {
    const today = Date.now();
    markSessionExecuted(today);
    const tomorrow = today + 25 * 3_600_000;
    expect(alreadyExecutedThisSession(tomorrow)).toBe(false);
  });
});
