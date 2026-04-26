import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-'));
process.env.PERSIST_DATA_DIR = tmpDir;

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue(0),
}));

const { sendTelegramAlert } = await import('../alerts/telegramClient.js');
const sentinel = await import('./schemaSentinel.js');
const { validateExternalPayload, isSourceQuarantined, releaseQuarantine, getQuarantineStatus } = sentinel;

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
});

beforeEach(() => {
  sentinel.__testOnly.reset();
  vi.mocked(sendTelegramAlert).mockClear();
});

const KisQuoteSchema = z.object({
  price: z.number().finite(),
  symbol: z.string().min(1),
});

describe('validateExternalPayload', () => {
  it('스키마 통과 시 typed value 반환', () => {
    const data = validateExternalPayload('KIS', { price: 70000, symbol: '005930' }, KisQuoteSchema);
    expect(data).toEqual({ price: 70000, symbol: '005930' });
  });

  it('스키마 실패 시 null + 차단 + 격리 파일 + 텔레그램 알림', async () => {
    const data = validateExternalPayload('YAHOO', { price: 'NaN', symbol: 'AAPL' }, KisQuoteSchema);
    expect(data).toBeNull();
    expect(isSourceQuarantined('YAHOO')).toBe(true);
    // 격리 파일 생성 확인
    const qDir = path.join(tmpDir, 'quarantine');
    expect(fs.existsSync(qDir)).toBe(true);
    const files = fs.readdirSync(qDir).filter((f) => f.startsWith('yahoo-'));
    expect(files.length).toBeGreaterThanOrEqual(1);
    // 알림은 비동기이므로 microtask 한 차례 양보
    await Promise.resolve();
    await Promise.resolve();
    expect(sendTelegramAlert).toHaveBeenCalled();
  });

  it('이미 차단된 source 도 검증 자체는 수행 (호출자가 isSourceQuarantined 로 사전 분기 권장)', () => {
    // 한 번 실패시켜 차단
    validateExternalPayload('KRX', { wrong: 'shape' }, KisQuoteSchema);
    expect(isSourceQuarantined('KRX')).toBe(true);
    // 호출 자체는 가능
    const data = validateExternalPayload('KRX', { price: 100, symbol: '005930' }, KisQuoteSchema);
    expect(data).toEqual({ price: 100, symbol: '005930' });
  });

  it('quarantine 만료 후 isSourceQuarantined=false', () => {
    validateExternalPayload('DART', { bad: true }, KisQuoteSchema, { quarantineDurationMs: 50 });
    expect(isSourceQuarantined('DART')).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(isSourceQuarantined('DART')).toBe(false);
        resolve();
      }, 80);
    });
  });

  it('동일 source 반복 실패 시 알림 dedupe (1시간)', async () => {
    validateExternalPayload('NAVER', { bad: 1 }, KisQuoteSchema, { alertCooldownMs: 60_000 });
    validateExternalPayload('NAVER', { bad: 2 }, KisQuoteSchema, { alertCooldownMs: 60_000 });
    validateExternalPayload('NAVER', { bad: 3 }, KisQuoteSchema, { alertCooldownMs: 60_000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(sendTelegramAlert).mock.calls.length).toBe(1);
  });

  it('failureCount 누적', () => {
    validateExternalPayload('GEMINI', { bad: 1 }, KisQuoteSchema);
    validateExternalPayload('GEMINI', { bad: 2 }, KisQuoteSchema);
    validateExternalPayload('GEMINI', { bad: 3 }, KisQuoteSchema);
    const status = getQuarantineStatus().find((s) => s.source === 'GEMINI');
    expect(status?.failureCount).toBe(3);
  });

  it('releaseQuarantine 으로 수동 해제', () => {
    validateExternalPayload('FRED', { bad: true }, KisQuoteSchema);
    expect(isSourceQuarantined('FRED')).toBe(true);
    expect(releaseQuarantine('FRED')).toBe(true);
    expect(isSourceQuarantined('FRED')).toBe(false);
  });

  it('SCHEMA_SENTINEL_DISABLED env 시 검증은 수행하되 격리·차단 비활성', () => {
    process.env.SCHEMA_SENTINEL_DISABLED = 'true';
    try {
      const data = validateExternalPayload('ECOS', { bad: true }, KisQuoteSchema);
      expect(data).toBeNull(); // 검증 자체는 실패
      expect(isSourceQuarantined('ECOS')).toBe(false); // 차단은 없음
    } finally {
      delete process.env.SCHEMA_SENTINEL_DISABLED;
    }
  });

  it('격리 파일에 source/at/error/payload 포함', async () => {
    const payload = { suspicious: 'data', nested: { deep: 1 } };
    validateExternalPayload('KIS', payload, KisQuoteSchema, { context: { trId: 'TR0001' } });
    const qDir = path.join(tmpDir, 'quarantine');
    const files = fs.readdirSync(qDir).filter((f) => f.startsWith('kis-'));
    const newest = files.sort().pop();
    expect(newest).toBeTruthy();
    const body = JSON.parse(fs.readFileSync(path.join(qDir, newest!), 'utf-8'));
    expect(body.source).toBe('KIS');
    expect(body.payload).toEqual(payload);
    expect(body.context.trId).toBe('TR0001');
    expect(body.error).toBeTruthy();
  });
});
