/**
 * @responsibility KIS 회로 ↔ 영속 블랙리스트 wiring 회귀 테스트 — PR-24, ADR-0010
 *
 * `_recordCircuitFailure(trId, 404)` 가 호출될 때마다 영속 블랙리스트 카운터도
 * 함께 증가하고, 30분 윈도우 내 10회 누적 시 `_isCircuitOpen` 이 즉시 true 로
 * 떨어져야 한다. 회로의 SOFT 쿨다운 2분과는 독립.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import { __testOnly, resetKisCircuits } from './kisClient.js';
import {
  isEndpointBlacklisted,
  __testOnly as __blacklistTestOnly,
} from '../persistence/kisEndpointBlacklistRepo.js';
import { KIS_ENDPOINT_BLACKLIST_FILE } from '../persistence/paths.js';

function cleanFile(): void {
  if (fs.existsSync(KIS_ENDPOINT_BLACKLIST_FILE)) fs.unlinkSync(KIS_ENDPOINT_BLACKLIST_FILE);
}

describe('kisClient ↔ blacklist wiring (ADR-0010)', () => {
  beforeEach(() => {
    delete process.env.KIS_DISABLE_404_BLACKLIST;
    delete process.env.KIS_LENIENT_404;
    cleanFile();
    __blacklistTestOnly.reset();
    resetKisCircuits();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T05:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanFile();
    __blacklistTestOnly.reset();
    resetKisCircuits();
  });

  it('404 9회 → 회로 닫힘, 블랙리스트 미등록', () => {
    const trId = 'FHPST01710000';
    for (let i = 0; i < 9; i++) __testOnly.recordFailure(trId, 404);
    expect(__testOnly.isOpen(trId)).toBe(false);
    expect(isEndpointBlacklisted(trId)).toBe(false);
  });

  it('404 10회 → 회로 SOFT 차단 + 블랙리스트 등록 → _isCircuitOpen 가 true', () => {
    const trId = 'FHPST01710000';
    for (let i = 0; i < 10; i++) __testOnly.recordFailure(trId, 404);
    expect(__testOnly.isOpen(trId)).toBe(true);
    expect(isEndpointBlacklisted(trId)).toBe(true);
  });

  it('SOFT 쿨다운 2분 만료 후에도 블랙리스트 24h 동안 _isCircuitOpen 유지', () => {
    const trId = 'FHPST01710000';
    for (let i = 0; i < 10; i++) __testOnly.recordFailure(trId, 404);
    expect(__testOnly.isOpen(trId)).toBe(true);
    // SOFT 쿨다운(2분) 만료
    vi.advanceTimersByTime(2 * 60 * 1000 + 1000);
    // 회로 자체는 풀려도 블랙리스트가 살아있어야 함
    expect(isEndpointBlacklisted(trId)).toBe(true);
    expect(__testOnly.isOpen(trId)).toBe(true);
  });

  it('성공 응답 시 블랙리스트 윈도우 카운터 리셋', () => {
    const trId = 'FHPST01710000';
    for (let i = 0; i < 5; i++) __testOnly.recordFailure(trId, 404);
    expect(__blacklistTestOnly.windowSize(trId)).toBe(5);
    __testOnly.recordSuccess(trId);
    expect(__blacklistTestOnly.windowSize(trId)).toBe(0);
  });

  it('resetKisCircuits 호출 시 블랙리스트도 함께 청소', () => {
    const trId = 'FHPST01710000';
    for (let i = 0; i < 10; i++) __testOnly.recordFailure(trId, 404);
    expect(isEndpointBlacklisted(trId)).toBe(true);
    resetKisCircuits();
    expect(isEndpointBlacklisted(trId)).toBe(false);
  });

  it('KIS_DISABLE_404_BLACKLIST=true → 회로 SOFT 만 작동, 블랙리스트 비활성', () => {
    process.env.KIS_DISABLE_404_BLACKLIST = 'true';
    const trId = 'FHPST01710000';
    for (let i = 0; i < 10; i++) __testOnly.recordFailure(trId, 404);
    expect(isEndpointBlacklisted(trId)).toBe(false);
    // SOFT 회로는 닫힘
    expect(__testOnly.isOpen(trId)).toBe(true);
    // SOFT 쿨다운 만료 후엔 풀려야 함 (블랙리스트가 비활성이므로)
    vi.advanceTimersByTime(2 * 60 * 1000 + 1000);
    expect(__testOnly.isOpen(trId)).toBe(false);
  });
});
