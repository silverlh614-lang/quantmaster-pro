/**
 * @responsibility kisTokenRepo 회귀 — 디스크 영속 + hydrate + 만료 자동 청소 검증
 *
 * ADR-0147 — 재부팅 시 OAuth2 갱신 차단 정책의 영속 layer 회귀 테스트.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

// PERSIST_DATA_DIR 격리 — 각 test 가 별도 디렉토리 사용
const TEST_DATA_DIR = join(tmpdir(), `kis-token-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// paths.ts 가 import 시점에 PERSIST_DATA_DIR 평가 → vi.resetModules 로 dynamic import 강제
vi.mock('../persistence/paths.js', async () => {
  const actual = await vi.importActual<typeof import('./paths.js')>('./paths.js');
  return actual;
});

beforeEach(() => {
  process.env.PERSIST_DATA_DIR = TEST_DATA_DIR;
  if (!existsSync(TEST_DATA_DIR)) mkdirSync(TEST_DATA_DIR, { recursive: true });
  vi.resetModules();
});

afterEach(() => {
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
  delete process.env.PERSIST_DATA_DIR;
});

async function loadRepo() {
  // dynamic import — PERSIST_DATA_DIR 가 새 path 로 평가되도록 module cache 격리
  return await import('./kisTokenRepo.js');
}

describe('kisTokenRepo — load', () => {
  it('파일 부재 시 빈 번들 반환 (schemaVersion=1)', async () => {
    const { loadKisTokens } = await loadRepo();
    const bundle = loadKisTokens();
    expect(bundle).toEqual({ schemaVersion: 1 });
  });

  it('손상된 JSON 시 빈 번들 fallback', async () => {
    const { KIS_TOKEN_FILE } = await import('./paths.js');
    if (!existsSync(dirname(KIS_TOKEN_FILE))) mkdirSync(dirname(KIS_TOKEN_FILE), { recursive: true });
    writeFileSync(KIS_TOKEN_FILE, '{ broken json !@#');
    const { loadKisTokens } = await loadRepo();
    const bundle = loadKisTokens();
    expect(bundle).toEqual({ schemaVersion: 1 });
  });

  it('빈 파일 시 빈 번들 fallback', async () => {
    const { KIS_TOKEN_FILE } = await import('./paths.js');
    if (!existsSync(dirname(KIS_TOKEN_FILE))) mkdirSync(dirname(KIS_TOKEN_FILE), { recursive: true });
    writeFileSync(KIS_TOKEN_FILE, '');
    const { loadKisTokens } = await loadRepo();
    expect(loadKisTokens()).toEqual({ schemaVersion: 1 });
  });

  it('schemaVersion 불일치 시 빈 번들 fallback', async () => {
    const { KIS_TOKEN_FILE } = await import('./paths.js');
    if (!existsSync(dirname(KIS_TOKEN_FILE))) mkdirSync(dirname(KIS_TOKEN_FILE), { recursive: true });
    writeFileSync(KIS_TOKEN_FILE, JSON.stringify({ schemaVersion: 999, main: { token: 'x' } }));
    const { loadKisTokens } = await loadRepo();
    expect(loadKisTokens()).toEqual({ schemaVersion: 1 });
  });

  it('만료된 토큰은 자동 제거 (now > expiry)', async () => {
    const { KIS_TOKEN_FILE } = await import('./paths.js');
    if (!existsSync(dirname(KIS_TOKEN_FILE))) mkdirSync(dirname(KIS_TOKEN_FILE), { recursive: true });
    const now = Date.now();
    writeFileSync(
      KIS_TOKEN_FILE,
      JSON.stringify({
        schemaVersion: 1,
        main: { token: 'expired-token', expiry: now - 1000, issuedAt: 'old' },
      }),
    );
    const { loadKisTokens } = await loadRepo();
    const bundle = loadKisTokens(now);
    expect(bundle.main).toBeUndefined();
  });

  it('유효한 토큰은 그대로 반환', async () => {
    const { KIS_TOKEN_FILE } = await import('./paths.js');
    if (!existsSync(dirname(KIS_TOKEN_FILE))) mkdirSync(dirname(KIS_TOKEN_FILE), { recursive: true });
    const now = Date.now();
    const expiry = now + 12 * 60 * 60 * 1000;
    writeFileSync(
      KIS_TOKEN_FILE,
      JSON.stringify({
        schemaVersion: 1,
        main: { token: 'valid-token', expiry, issuedAt: 'iso-string' },
      }),
    );
    const { loadKisTokens } = await loadRepo();
    const bundle = loadKisTokens(now);
    expect(bundle.main).toEqual({ token: 'valid-token', expiry, issuedAt: 'iso-string' });
  });
});

describe('kisTokenRepo — save / persist', () => {
  it('saveKisTokens atomic write (tmp → rename)', async () => {
    const { saveKisTokens, loadKisTokens } = await loadRepo();
    const expiry = Date.now() + 23 * 60 * 60 * 1000;
    saveKisTokens({
      schemaVersion: 1,
      main: { token: 'tok-A', expiry, issuedAt: '2026-05-01T00:00:00.000Z' },
    });
    const bundle = loadKisTokens();
    expect(bundle.main?.token).toBe('tok-A');
  });

  it('persistKisToken main 갱신 시 realData 보존', async () => {
    const { saveKisTokens, persistKisToken, loadKisTokens } = await loadRepo();
    const expiry = Date.now() + 23 * 60 * 60 * 1000;
    saveKisTokens({
      schemaVersion: 1,
      main: { token: 'main-old', expiry, issuedAt: 'old' },
      realData: { token: 'real-keep', expiry, issuedAt: 'keep' },
    });
    persistKisToken('main', { token: 'main-new', expiry, issuedAt: 'new' });
    const bundle = loadKisTokens();
    expect(bundle.main?.token).toBe('main-new');
    expect(bundle.realData?.token).toBe('real-keep');
  });

  it('persistKisToken realData 갱신 시 main 보존', async () => {
    const { saveKisTokens, persistKisToken, loadKisTokens } = await loadRepo();
    const expiry = Date.now() + 23 * 60 * 60 * 1000;
    saveKisTokens({
      schemaVersion: 1,
      main: { token: 'main-keep', expiry, issuedAt: 'keep' },
    });
    persistKisToken('realData', { token: 'real-new', expiry, issuedAt: 'new' });
    const bundle = loadKisTokens();
    expect(bundle.main?.token).toBe('main-keep');
    expect(bundle.realData?.token).toBe('real-new');
  });

  it('atomic write — tmp 파일 잔존 안 함', async () => {
    const { saveKisTokens } = await loadRepo();
    const { KIS_TOKEN_FILE } = await import('./paths.js');
    saveKisTokens({
      schemaVersion: 1,
      main: { token: 'tok', expiry: Date.now() + 1000, issuedAt: 'iso' },
    });
    expect(existsSync(`${KIS_TOKEN_FILE}.tmp`)).toBe(false);
    expect(existsSync(KIS_TOKEN_FILE)).toBe(true);
  });
});

describe('kisTokenRepo — clear / invalidate', () => {
  it('clearKisTokens 파일 삭제', async () => {
    const { saveKisTokens, clearKisTokens } = await loadRepo();
    const { KIS_TOKEN_FILE } = await import('./paths.js');
    saveKisTokens({
      schemaVersion: 1,
      main: { token: 'tok', expiry: Date.now() + 1000, issuedAt: 'iso' },
    });
    expect(existsSync(KIS_TOKEN_FILE)).toBe(true);
    clearKisTokens();
    expect(existsSync(KIS_TOKEN_FILE)).toBe(false);
  });

  it('clearKisTokens 부재 파일 silent skip', async () => {
    const { clearKisTokens } = await loadRepo();
    expect(() => clearKisTokens()).not.toThrow();
  });
});

describe('kisTokenRepo — getPersistedTokenRemainingHours', () => {
  it('유효 토큰 잔여 시간 hour 단위', async () => {
    const { saveKisTokens, getPersistedTokenRemainingHours } = await loadRepo();
    const now = Date.now();
    const expiry = now + 5 * 60 * 60 * 1000 + 30 * 60 * 1000; // 5.5h
    saveKisTokens({
      schemaVersion: 1,
      main: { token: 'tok', expiry, issuedAt: 'iso' },
    });
    expect(getPersistedTokenRemainingHours('main', now)).toBe(5);
  });

  it('부재 시 0 반환', async () => {
    const { getPersistedTokenRemainingHours } = await loadRepo();
    expect(getPersistedTokenRemainingHours('main')).toBe(0);
    expect(getPersistedTokenRemainingHours('realData')).toBe(0);
  });

  it('만료 후 0 반환 (자동 청소)', async () => {
    const { saveKisTokens, getPersistedTokenRemainingHours } = await loadRepo();
    const now = Date.now();
    saveKisTokens({
      schemaVersion: 1,
      main: { token: 'expired', expiry: now - 1000, issuedAt: 'old' },
    });
    expect(getPersistedTokenRemainingHours('main', now)).toBe(0);
  });
});

describe('kisTokenRepo — schema 검증', () => {
  it('잘못된 token 필드 (number) 시 슬롯 무시', async () => {
    const { KIS_TOKEN_FILE } = await import('./paths.js');
    if (!existsSync(dirname(KIS_TOKEN_FILE))) mkdirSync(dirname(KIS_TOKEN_FILE), { recursive: true });
    writeFileSync(
      KIS_TOKEN_FILE,
      JSON.stringify({
        schemaVersion: 1,
        main: { token: 12345, expiry: Date.now() + 10000, issuedAt: 'iso' },
      }),
    );
    const { loadKisTokens } = await loadRepo();
    expect(loadKisTokens().main).toBeUndefined();
  });

  it('빈 token 문자열 시 슬롯 무시', async () => {
    const { KIS_TOKEN_FILE } = await import('./paths.js');
    if (!existsSync(dirname(KIS_TOKEN_FILE))) mkdirSync(dirname(KIS_TOKEN_FILE), { recursive: true });
    writeFileSync(
      KIS_TOKEN_FILE,
      JSON.stringify({
        schemaVersion: 1,
        main: { token: '', expiry: Date.now() + 10000, issuedAt: 'iso' },
      }),
    );
    const { loadKisTokens } = await loadRepo();
    expect(loadKisTokens().main).toBeUndefined();
  });

  it('expiry NaN 시 슬롯 무시', async () => {
    const { KIS_TOKEN_FILE } = await import('./paths.js');
    if (!existsSync(dirname(KIS_TOKEN_FILE))) mkdirSync(dirname(KIS_TOKEN_FILE), { recursive: true });
    writeFileSync(
      KIS_TOKEN_FILE,
      JSON.stringify({
        schemaVersion: 1,
        main: { token: 'tok', expiry: 'invalid', issuedAt: 'iso' },
      }),
    );
    const { loadKisTokens } = await loadRepo();
    expect(loadKisTokens().main).toBeUndefined();
  });
});
