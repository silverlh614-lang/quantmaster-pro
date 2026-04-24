/**
 * @responsibility KIS 엔드포인트 영속 블랙리스트 회귀 테스트 — PR-24, ADR-0010
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import {
  isEndpointBlacklisted,
  recordEndpoint404,
  resetEndpoint404Counter,
  resetKisEndpointBlacklist,
  loadKisEndpointBlacklist,
  getKisEndpointBlacklist,
  flushKisBlacklist,
  WINDOW_MS,
  FAILURE_THRESHOLD,
  BLOCK_DURATION_MS,
  __testOnly,
} from './kisEndpointBlacklistRepo.js';
import { KIS_ENDPOINT_BLACKLIST_FILE } from './paths.js';

function cleanFile(): void {
  if (fs.existsSync(KIS_ENDPOINT_BLACKLIST_FILE)) fs.unlinkSync(KIS_ENDPOINT_BLACKLIST_FILE);
}

describe('kisEndpointBlacklistRepo — 30분/10회 → 24h 차단 (ADR-0010)', () => {
  beforeEach(() => {
    delete process.env.KIS_DISABLE_404_BLACKLIST;
    cleanFile();
    __testOnly.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T05:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanFile();
    __testOnly.reset();
  });

  it('초기 상태에서는 차단 없음', () => {
    expect(isEndpointBlacklisted('FHPST01710000')).toBe(false);
  });

  it('윈도우 내 9회 누적 → 아직 차단 안 됨', () => {
    for (let i = 0; i < 9; i++) {
      expect(recordEndpoint404('FHPST01710000')).toBe(false);
    }
    expect(__testOnly.windowSize('FHPST01710000')).toBe(9);
    expect(isEndpointBlacklisted('FHPST01710000')).toBe(false);
  });

  it('윈도우 내 10회 누적 → 24h 차단 등록', () => {
    let registered = false;
    for (let i = 0; i < 10; i++) {
      registered = recordEndpoint404('FHPST01710000');
    }
    expect(registered).toBe(true);
    expect(isEndpointBlacklisted('FHPST01710000')).toBe(true);
  });

  it('블랙리스트 등록 후 윈도우 카운터 비워짐', () => {
    for (let i = 0; i < 10; i++) recordEndpoint404('FHPST01710000');
    expect(__testOnly.windowSize('FHPST01710000')).toBe(0);
  });

  it('30분 윈도우 외 호출은 카운터에서 제외', () => {
    for (let i = 0; i < 5; i++) recordEndpoint404('FHPST01710000');
    vi.advanceTimersByTime(WINDOW_MS + 1000);
    for (let i = 0; i < 5; i++) recordEndpoint404('FHPST01710000');
    expect(isEndpointBlacklisted('FHPST01710000')).toBe(false);
    expect(__testOnly.windowSize('FHPST01710000')).toBe(5);
  });

  it('24h 차단 만료 후 자동 해제', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordEndpoint404('FHPST01710000');
    expect(isEndpointBlacklisted('FHPST01710000')).toBe(true);
    vi.advanceTimersByTime(BLOCK_DURATION_MS + 1000);
    expect(isEndpointBlacklisted('FHPST01710000')).toBe(false);
  });

  it('성공 응답 시 윈도우 카운터 리셋 (블랙리스트 entry 는 만료 대기)', () => {
    for (let i = 0; i < 5; i++) recordEndpoint404('FHPST01710000');
    expect(__testOnly.windowSize('FHPST01710000')).toBe(5);
    resetEndpoint404Counter('FHPST01710000');
    expect(__testOnly.windowSize('FHPST01710000')).toBe(0);
  });

  it('영속화 — 등록 후 flush + 재로드 시 entry 유지', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordEndpoint404('FHPST01710000');
    flushKisBlacklist();
    expect(fs.existsSync(KIS_ENDPOINT_BLACKLIST_FILE)).toBe(true);

    __testOnly.reset();
    const active = loadKisEndpointBlacklist();
    expect(active).toBe(1);
    expect(isEndpointBlacklisted('FHPST01710000')).toBe(true);
  });

  it('영속화 — 만료된 entry 는 로드 시 자동 청소', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordEndpoint404('FHPST01710000');
    flushKisBlacklist();

    vi.advanceTimersByTime(BLOCK_DURATION_MS + 1000);
    __testOnly.reset();
    const active = loadKisEndpointBlacklist();
    expect(active).toBe(0);
  });

  it('KIS_DISABLE_404_BLACKLIST=true → 카운팅·차단 모두 비활성', () => {
    process.env.KIS_DISABLE_404_BLACKLIST = 'true';
    for (let i = 0; i < 20; i++) {
      expect(recordEndpoint404('FHPST01710000')).toBe(false);
    }
    expect(isEndpointBlacklisted('FHPST01710000')).toBe(false);
  });

  it('운영자 수동 reset 시 모든 entry 와 카운터 청소', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordEndpoint404('TR_A');
    for (let i = 0; i < 5; i++) recordEndpoint404('TR_B');
    expect(getKisEndpointBlacklist()).toHaveLength(1);

    const cleared = resetKisEndpointBlacklist();
    expect(cleared).toBe(1);
    expect(isEndpointBlacklisted('TR_A')).toBe(false);
    expect(__testOnly.windowSize('TR_B')).toBe(0);
  });

  it('이미 차단된 trId 에 대한 추가 404 호출은 신규 등록으로 처리하지 않음', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) recordEndpoint404('TR_A');
    expect(isEndpointBlacklisted('TR_A')).toBe(true);
    // 이미 blocked 상태에서 호출 시 false 반환
    expect(recordEndpoint404('TR_A')).toBe(false);
  });
});
