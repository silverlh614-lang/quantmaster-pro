// @responsibility healthLoop — KIS 토큰 재발급 시 만료 경보 미확인 ack 자동 해소 회귀
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;
const origDataDir = process.env.PERSIST_DATA_DIR;
const origDisabled = process.env.HEALTH_LOOP_DISABLED;

const sendTelegramAlertMock = vi.fn(async (_msg?: string, _opts?: unknown) => 1);
const editMessageTextMock = vi.fn(async (_id?: number, _text?: string) => undefined);
const answerCallbackQueryMock = vi.fn(async (_id?: string, _text?: string) => undefined);

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: sendTelegramAlertMock,
  editMessageText: editMessageTextMock,
  answerCallbackQuery: answerCallbackQueryMock,
}));

vi.mock('../health/diagnostics.js', () => ({
  collectHealthSnapshot: vi.fn(),
}));

// 밀폐: kisHours=0 케이스는 heal-first(만료 지속 재시도 포함, 2026-07-04)가 auth 를 동적
// import 하므로 실 OAuth 호출이 나가지 않게 mock — 본 파일의 검증 대상은 ack 해소뿐.
vi.mock('../clients/kisClient/auth.js', () => ({
  refreshKisToken: vi.fn(async () => {
    throw new Error('mocked: OAuth unavailable');
  }),
  refreshRealDataToken: vi.fn(async () => {
    throw new Error('mocked: OAuth unavailable');
  }),
  getKisTokenRemainingHours: vi.fn(() => 0),
}));

const baseSnapshot = {
  kisConfigured: true,
  kisTokenHours: 12,
  autoTradeEnabled: true,
  autoTradeMode: 'SHADOW',
  watchlistCount: 10,
  activePositions: 0,
  emergencyStop: false,
  krxTokenConfigured: true,
  krxTokenValid: true,
  krxCircuitState: 'CLOSED',
  krxFailures: 0,
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-selfheal-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  delete process.env.HEALTH_LOOP_DISABLED;
  sendTelegramAlertMock.mockClear();
  editMessageTextMock.mockClear();
  vi.resetModules();
});

afterEach(() => {
  if (origDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = origDataDir;
  if (origDisabled === undefined) delete process.env.HEALTH_LOOP_DISABLED;
  else process.env.HEALTH_LOOP_DISABLED = origDisabled;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function seedKisTokenPendingAck(): Promise<void> {
  const ack = await import('../alerts/ackTracker.js');
  ack.registerPendingAck({
    ackId: 'kis1',
    messageId: 4242,
    summary: '🚨 KIS 토큰 만료',
    sentAt: Date.now(),
    category: 'health_loop',
    dedupeKey: 'health_loop:kis_token_expired:2026-06-04',
  });
  expect(ack.countPendingAcks()).toBe(1);
}

describe('healthLoop — KIS 토큰 self-heal ack 자동 해소', () => {
  it('kisHours>0 (재발급) 시 kis_token_expired pending ack 자동 해소 + 메시지 편집', async () => {
    await seedKisTokenPendingAck();

    const { runTier1 } = await import('./healthLoop.js');
    const { collectHealthSnapshot } = await import('../health/diagnostics.js');
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({ ...baseSnapshot, kisTokenHours: 12 });

    await runTier1();

    const ack = await import('../alerts/ackTracker.js');
    expect(ack.countPendingAcks()).toBe(0);
    expect(editMessageTextMock).toHaveBeenCalledTimes(1);
    expect(editMessageTextMock.mock.calls[0][0]).toBe(4242);
    expect(String(editMessageTextMock.mock.calls[0][1])).toMatch(/자동 해소 — KIS 토큰 재발급/);
  });

  it('kisHours=0 (여전히 만료) 시 ack 미해소 — self-heal 트리거 안 됨', async () => {
    await seedKisTokenPendingAck();

    const { runTier1 } = await import('./healthLoop.js');
    const { collectHealthSnapshot } = await import('../health/diagnostics.js');
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({ ...baseSnapshot, kisTokenHours: 0 });

    await runTier1();

    const ack = await import('../alerts/ackTracker.js');
    expect(ack.countPendingAcks()).toBe(1);
    expect(editMessageTextMock).not.toHaveBeenCalled();
  });

  it('다른 카테고리 pending ack (regime) 는 KIS 회복 시에도 무영향', async () => {
    const ack0 = await import('../alerts/ackTracker.js');
    ack0.registerPendingAck({
      ackId: 'rg1', messageId: 11, summary: 'regime downgrade R3', sentAt: Date.now(),
      category: 'regime', dedupeKey: 'regime_downgrade:2026-06-04',
    });

    const { runTier1 } = await import('./healthLoop.js');
    const { collectHealthSnapshot } = await import('../health/diagnostics.js');
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({ ...baseSnapshot, kisTokenHours: 12 });

    await runTier1();

    const ack = await import('../alerts/ackTracker.js');
    expect(ack.countPendingAcks()).toBe(1);
    expect(ack.listPendingAcks()[0].ackId).toBe('rg1');
    expect(editMessageTextMock).not.toHaveBeenCalled();
  });
});
