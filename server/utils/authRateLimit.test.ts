import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authrl-'));
process.env.PERSIST_DATA_DIR = tmpDir;

const repo = await import('../persistence/apiAuthBlacklistRepo.js');
const { enforceAuthRateLimit } = await import('./authRateLimit.js');

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
});

interface MockReq {
  headers: Record<string, string | undefined>;
  socket?: { remoteAddress?: string };
}

interface MockRes {
  statusCode: number;
  body: unknown;
  status: (n: number) => MockRes;
  json: (b: unknown) => void;
}

function mkRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status(n: number) { this.statusCode = n; return this; },
    json(b: unknown) { this.body = b; },
  };
  return res;
}

function mkReq(ip = '1.1.1.1'): MockReq {
  return { headers: {}, socket: { remoteAddress: ip } };
}

beforeEach(() => {
  repo.__testOnly.reset();
  delete process.env.API_AUTH_BLACKLIST_DISABLED;
});

describe('enforceAuthRateLimit', () => {
  it('블랙리스트에 없는 IP 는 통과', () => {
    const req = mkReq('1.1.1.1');
    const res = mkRes();
    let nextCalled = false;
    enforceAuthRateLimit(req as never, res as never, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('블랙리스트에 있는 IP 는 403', () => {
    const ip = '2.2.2.2';
    for (let i = 0; i < 10; i++) repo.recordAuthFailure(ip);
    const req = mkReq(ip);
    const res = mkRes();
    let nextCalled = false;
    enforceAuthRateLimit(req as never, res as never, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect((res.body as { error: string }).error).toBe('FORBIDDEN');
  });

  it('API_AUTH_BLACKLIST_DISABLED env 시 차단 우회', () => {
    const ip = '3.3.3.3';
    for (let i = 0; i < 10; i++) repo.recordAuthFailure(ip);
    process.env.API_AUTH_BLACKLIST_DISABLED = 'true';
    const req = mkReq(ip);
    const res = mkRes();
    let nextCalled = false;
    enforceAuthRateLimit(req as never, res as never, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('X-Forwarded-For 우선 추출 후 차단 검사', () => {
    const ip = '4.4.4.4';
    for (let i = 0; i < 10; i++) repo.recordAuthFailure(ip);
    const req: MockReq = {
      headers: { 'x-forwarded-for': '4.4.4.4, 192.168.1.1' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = mkRes();
    enforceAuthRateLimit(req as never, res as never, () => { /* should not be called */ });
    expect(res.statusCode).toBe(403);
  });
});
