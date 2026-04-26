import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authguard-'));
process.env.PERSIST_DATA_DIR = tmpDir;

const repo = await import('../persistence/apiAuthBlacklistRepo.js');
const { requireOperatorToken, extractClientIp, extractToken } = await import('./authGuard.js');

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
});

interface MockReq {
  headers: Record<string, string | undefined>;
  socket?: { remoteAddress?: string };
  ip?: string;
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

function mkReq(headers: Record<string, string | undefined> = {}, ip = '1.1.1.1'): MockReq {
  return { headers, socket: { remoteAddress: ip } };
}

beforeEach(() => {
  repo.__testOnly.reset();
  delete process.env.OPERATOR_TOKEN;
  delete process.env.AUTO_TRADE_MODE;
});

describe('extractClientIp', () => {
  it('X-Forwarded-For 우선 (Railway proxy 환경)', () => {
    const req = mkReq({ 'x-forwarded-for': '10.0.0.1, 192.168.1.1' });
    expect(extractClientIp(req as never)).toBe('10.0.0.1');
  });

  it('X-Forwarded-For 없으면 socket.remoteAddress fallback', () => {
    const req = mkReq({}, '2.2.2.2');
    expect(extractClientIp(req as never)).toBe('2.2.2.2');
  });

  it('빈 헤더는 unknown 반환', () => {
    const req: MockReq = { headers: {}, socket: {} };
    expect(extractClientIp(req as never)).toBe('unknown');
  });
});

describe('extractToken', () => {
  it('Bearer 접두사 추출', () => {
    expect(extractToken(mkReq({ authorization: 'Bearer abc123' }) as never)).toBe('abc123');
  });

  it('x-operator-token 헤더 추출', () => {
    expect(extractToken(mkReq({ 'x-operator-token': 'xyz' }) as never)).toBe('xyz');
  });

  it('헤더 없으면 빈 문자열', () => {
    expect(extractToken(mkReq({}) as never)).toBe('');
  });
});

describe('requireOperatorToken', () => {
  it('OPERATOR_TOKEN 미설정 + SHADOW 모드: 통과 (개발 편의)', () => {
    process.env.AUTO_TRADE_MODE = 'SHADOW';
    const req = mkReq();
    const res = mkRes();
    let nextCalled = false;
    requireOperatorToken(req as never, res as never, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('OPERATOR_TOKEN 미설정 + LIVE 모드: 401 (사고 방지)', () => {
    process.env.AUTO_TRADE_MODE = 'LIVE';
    const req = mkReq();
    const res = mkRes();
    let nextCalled = false;
    requireOperatorToken(req as never, res as never, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect((res.body as { error: string }).error).toBe('OPERATOR_TOKEN_NOT_SET');
  });

  it('토큰 일치: 통과 + 카운터 리셋', () => {
    process.env.OPERATOR_TOKEN = 'secret-token';
    const ip = '7.7.7.7';
    // 사전 누적 9회 — 통과 후 리셋되어야 함
    for (let i = 0; i < 9; i++) repo.recordAuthFailure(ip);
    expect(repo.__testOnly.windowSize(ip)).toBe(9);

    const req = mkReq({ authorization: 'Bearer secret-token' }, ip);
    const res = mkRes();
    let nextCalled = false;
    requireOperatorToken(req as never, res as never, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(repo.__testOnly.windowSize(ip)).toBe(0);
  });

  it('토큰 불일치: 401 + recordAuthFailure', () => {
    process.env.OPERATOR_TOKEN = 'secret-token';
    const ip = '8.8.8.8';
    const req = mkReq({ authorization: 'Bearer wrong' }, ip);
    const res = mkRes();
    requireOperatorToken(req as never, res as never, () => { /* should not be called */ });
    expect(res.statusCode).toBe(401);
    expect(repo.__testOnly.windowSize(ip)).toBe(1);
  });

  it('상수시간 비교: 길이 다른 토큰도 401 (타이밍 누설 차단)', () => {
    process.env.OPERATOR_TOKEN = 'long-secret-token-12345';
    const req = mkReq({ authorization: 'Bearer x' }, '9.9.9.9');
    const res = mkRes();
    requireOperatorToken(req as never, res as never, () => { /* noop */ });
    expect(res.statusCode).toBe(401);
  });
});
