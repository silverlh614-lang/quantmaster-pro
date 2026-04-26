import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-bl-'));
process.env.PERSIST_DATA_DIR = tmpDir;

const repo = await import('./apiAuthBlacklistRepo.js');

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
});

beforeEach(() => {
  repo.__testOnly.reset();
  // 파일도 청소해 테스트 간 격리.
  try { fs.rmSync(path.join(tmpDir, 'api-auth-blacklist.json'), { force: true }); } catch { /* noop */ }
});

describe('apiAuthBlacklistRepo', () => {
  it('첫 401 만으로는 차단되지 않는다', () => {
    const blocked = repo.recordAuthFailure('1.2.3.4');
    expect(blocked).toBe(false);
    expect(repo.isIpBlacklisted('1.2.3.4')).toBe(false);
  });

  it('5분 윈도우 내 10회 누적 시 1시간 차단', () => {
    const ip = '5.6.7.8';
    for (let i = 0; i < 9; i++) {
      expect(repo.recordAuthFailure(ip)).toBe(false);
    }
    const tenth = repo.recordAuthFailure(ip);
    expect(tenth).toBe(true);
    expect(repo.isIpBlacklisted(ip)).toBe(true);
  });

  it('5분 경과 후 윈도우는 새 시도를 받아들인다 (블랙리스트 미진입)', () => {
    const ip = '9.9.9.9';
    const t0 = Date.now();
    for (let i = 0; i < 9; i++) repo.recordAuthFailure(ip, t0 + i * 1000);
    expect(repo.__testOnly.windowSize(ip)).toBe(9);
    // 윈도우 전체가 빠진 시점(가장 마지막 시도 + 5분 + 1ms) — 모두 stale.
    const futureTs = t0 + 8000 + 5 * 60 * 1000 + 1;
    repo.recordAuthFailure(ip, futureTs);
    expect(repo.__testOnly.windowSize(ip)).toBe(1);
  });

  it('차단 시간이 만료되면 isIpBlacklisted 가 false 를 반환', () => {
    const ip = '10.0.0.1';
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) repo.recordAuthFailure(ip, t0 + i);
    expect(repo.isIpBlacklisted(ip, t0 + 100)).toBe(true);
    // blockedUntil = t0 + 9 + 1h. 1h + 100ms 후엔 만료.
    expect(repo.isIpBlacklisted(ip, t0 + 9 + 60 * 60 * 1000 + 1)).toBe(false);
  });

  it('성공 응답 시 카운터만 리셋되고 블랙리스트 entry 는 유지', () => {
    const ip = '11.11.11.11';
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) repo.recordAuthFailure(ip, t0 + i);
    expect(repo.isIpBlacklisted(ip, t0 + 100)).toBe(true);
    repo.resetAuthFailureCounter(ip);
    expect(repo.__testOnly.windowSize(ip)).toBe(0);
    expect(repo.isIpBlacklisted(ip, t0 + 100)).toBe(true); // 차단은 만료 대기
  });

  it('resetApiAuthBlacklist 는 모든 entry + 카운터를 청소', () => {
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) repo.recordAuthFailure('a.a', t0 + i);
    for (let i = 0; i < 10; i++) repo.recordAuthFailure('b.b', t0 + i);
    expect(repo.getApiAuthBlacklist().length).toBe(2);
    const removed = repo.resetApiAuthBlacklist();
    expect(removed).toBe(2);
    expect(repo.getApiAuthBlacklist().length).toBe(0);
    expect(repo.isIpBlacklisted('a.a', t0 + 100)).toBe(false);
  });

  it('API_AUTH_BLACKLIST_DISABLED env 시 차단 우회', () => {
    const ip = 'c.c.c.c';
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) repo.recordAuthFailure(ip, t0 + i);
    process.env.API_AUTH_BLACKLIST_DISABLED = 'true';
    try {
      expect(repo.isIpBlacklisted(ip, t0 + 100)).toBe(false);
      expect(repo.recordAuthFailure(ip, t0 + 100)).toBe(false);
    } finally {
      delete process.env.API_AUTH_BLACKLIST_DISABLED;
    }
  });

  it('round-trip: flush → reset → load 후 동일 차단 상태 유지', () => {
    const ip = 'd.d.d.d';
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) repo.recordAuthFailure(ip, t0 + i);
    repo.flushApiAuthBlacklist();
    repo.__testOnly.reset();
    expect(repo.loadApiAuthBlacklist()).toBe(1);
    expect(repo.isIpBlacklisted(ip, t0 + 100)).toBe(true);
  });
});
