/**
 * @responsibility PR-21 KIS 회로 차단기 404 완화 정책 회귀 테스트
 *
 * 404 는 3회가 아닌 10회 / 쿨다운 10분이 아닌 2분으로 관대 처리.
 * 5xx/403 은 기존대로 3회 / 10분 유지. KIS_LENIENT_404 env 로 404 완전 비활성.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __testOnly, getCircuitBreakerStats, resetKisCircuits } from './kisClient.js';

describe('PR-21 KIS 회로 404 완화', () => {
  beforeEach(() => {
    resetKisCircuits();
    delete process.env.KIS_LENIENT_404;
  });

  afterEach(() => {
    resetKisCircuits();
    delete process.env.KIS_LENIENT_404;
  });

  it('404 3회로는 회로가 열리지 않는다 (이전에는 열렸음)', () => {
    const trId = 'FHPST01710000';
    __testOnly.recordFailure(trId, 404);
    __testOnly.recordFailure(trId, 404);
    __testOnly.recordFailure(trId, 404);
    expect(__testOnly.isOpen(trId)).toBe(false);
    const stats = getCircuitBreakerStats().find(s => s.trId === trId)!;
    expect(stats.softFailures).toBe(3);
    expect(stats.hardFailures).toBe(0);
    expect(stats.openFor).toBe(0);
  });

  it('404 10회 연속이면 소프트 회로 차단 (쿨다운 2분)', () => {
    const trId = 'FHPST01710000';
    for (let i = 0; i < 10; i++) __testOnly.recordFailure(trId, 404);
    expect(__testOnly.isOpen(trId)).toBe(true);
    const stats = getCircuitBreakerStats().find(s => s.trId === trId)!;
    expect(stats.softFailures).toBe(10);
    expect(stats.lastBlockedBy).toBe('SOFT');
    // 쿨다운은 약 2분 (2 × 60_000 = 120_000 ms) — 약간의 jitter 허용.
    expect(stats.openFor).toBeGreaterThan(100_000);
    expect(stats.openFor).toBeLessThanOrEqual(120_000);
  });

  it('5xx 3회는 기존대로 하드 회로 차단 (쿨다운 10분)', () => {
    const trId = 'TTTC8434R';
    __testOnly.recordFailure(trId, 503);
    __testOnly.recordFailure(trId, 503);
    __testOnly.recordFailure(trId, 503);
    expect(__testOnly.isOpen(trId)).toBe(true);
    const stats = getCircuitBreakerStats().find(s => s.trId === trId)!;
    expect(stats.hardFailures).toBe(3);
    expect(stats.lastBlockedBy).toBe('HARD');
    expect(stats.openFor).toBeGreaterThan(500_000);
    expect(stats.openFor).toBeLessThanOrEqual(600_000);
  });

  it('403 3회도 하드 경로로 차단', () => {
    const trId = 'FHK_PERMISSION';
    __testOnly.recordFailure(trId, 403);
    __testOnly.recordFailure(trId, 403);
    __testOnly.recordFailure(trId, 403);
    expect(__testOnly.isOpen(trId)).toBe(true);
    const stats = getCircuitBreakerStats().find(s => s.trId === trId)!;
    expect(stats.hardFailures).toBe(3);
    expect(stats.lastBlockedBy).toBe('HARD');
  });

  it('5xx 와 404 카운터는 독립 — 5xx 2회 + 404 5회 → 둘 다 미차단', () => {
    const trId = 'MIX_TR';
    __testOnly.recordFailure(trId, 502);
    __testOnly.recordFailure(trId, 502);
    for (let i = 0; i < 5; i++) __testOnly.recordFailure(trId, 404);
    expect(__testOnly.isOpen(trId)).toBe(false);
    const stats = getCircuitBreakerStats().find(s => s.trId === trId)!;
    expect(stats.hardFailures).toBe(2);
    expect(stats.softFailures).toBe(5);
  });

  it('성공 응답 시 두 카운터 모두 리셋', () => {
    const trId = 'RESET_TEST';
    __testOnly.recordFailure(trId, 502);
    __testOnly.recordFailure(trId, 404);
    __testOnly.recordFailure(trId, 404);
    __testOnly.recordSuccess(trId);
    const stats = getCircuitBreakerStats().find(s => s.trId === trId)!;
    expect(stats.hardFailures).toBe(0);
    expect(stats.softFailures).toBe(0);
  });

  it('KIS_LENIENT_404=true 면 404 는 회로 미카운팅', () => {
    process.env.KIS_LENIENT_404 = 'true';
    const trId = 'LENIENT';
    for (let i = 0; i < 20; i++) __testOnly.recordFailure(trId, 404);
    expect(__testOnly.isOpen(trId)).toBe(false);
    const stats = getCircuitBreakerStats().find(s => s.trId === trId);
    // 회로 상태 자체가 생성되지 않아야 함 — lenient 는 즉시 return.
    expect(stats?.softFailures ?? 0).toBe(0);
  });

  it('resetKisCircuits 는 하드/소프트 모두 해제', () => {
    __testOnly.recordFailure('A', 503);
    __testOnly.recordFailure('A', 503);
    __testOnly.recordFailure('A', 503);
    for (let i = 0; i < 10; i++) __testOnly.recordFailure('B', 404);
    expect(__testOnly.isOpen('A')).toBe(true);
    expect(__testOnly.isOpen('B')).toBe(true);
    const cleared = resetKisCircuits();
    expect(cleared).toBe(2);
    expect(__testOnly.isOpen('A')).toBe(false);
    expect(__testOnly.isOpen('B')).toBe(false);
  });
});
