// @responsibility healthLoop — Master Tier 4 회복 시 진입 경보 미확인 ack 자동 해소 회귀
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-master-selfheal-'));
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

/** Tier 4 fallback 활성 상태로 health-loop 상태를 씨딩 (회복 전이 재현용). */
async function seedTier4Active(): Promise<void> {
  const { saveHealthLoopState } = await import('./healthLoop.js');
  saveHealthLoopState({ masterTier4Active: true, alertedKeys: {} });
}

async function seedMasterTier4PendingAck(): Promise<void> {
  const ack = await import('../alerts/ackTracker.js');
  ack.registerPendingAck({
    ackId: 'm4-1',
    messageId: 7373,
    summary: '🚨 Master Tier 4 fallback 진입',
    sentAt: Date.now(),
    category: 'health_loop',
    dedupeKey: 'health_loop:master_tier4_enter:2026-06-28',
  });
  expect(ack.countPendingAcks()).toBe(1);
}

describe('healthLoop — Master Tier 4 self-heal ack 자동 해소', () => {
  it('Tier 4 → 정상 회복 시 master_tier4_enter pending ack 자동 해소 + 메시지 편집', async () => {
    await seedTier4Active();
    await seedMasterTier4PendingAck();

    const { runTier1 } = await import('./healthLoop.js');
    const { collectHealthSnapshot } = await import('../health/diagnostics.js');
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({ ...baseSnapshot });

    await runTier1();

    const ack = await import('../alerts/ackTracker.js');
    expect(ack.countPendingAcks()).toBe(0);
    expect(editMessageTextMock).toHaveBeenCalledTimes(1);
    expect(editMessageTextMock.mock.calls[0][0]).toBe(7373);
    expect(String(editMessageTextMock.mock.calls[0][1])).toMatch(/자동 해소 — Master Tier 4 회복/);
  });

  it('Tier 4 미활성(회복 전이 없음) 시 master_tier4_enter ack 미해소', async () => {
    // masterTier4Active 미씨딩 → wasTier4=false → 회복 분기 미진입.
    await seedMasterTier4PendingAck();

    const { runTier1 } = await import('./healthLoop.js');
    const { collectHealthSnapshot } = await import('../health/diagnostics.js');
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({ ...baseSnapshot });

    await runTier1();

    const ack = await import('../alerts/ackTracker.js');
    expect(ack.countPendingAcks()).toBe(1);
    expect(editMessageTextMock).not.toHaveBeenCalled();
  });

  it('다른 카테고리 pending ack (regime) 는 Master 회복 시에도 무영향', async () => {
    await seedTier4Active();
    const ack0 = await import('../alerts/ackTracker.js');
    ack0.registerPendingAck({
      ackId: 'rg1', messageId: 11, summary: 'regime downgrade R3', sentAt: Date.now(),
      category: 'regime', dedupeKey: 'regime_downgrade:2026-06-28',
    });

    const { runTier1 } = await import('./healthLoop.js');
    const { collectHealthSnapshot } = await import('../health/diagnostics.js');
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({ ...baseSnapshot });

    await runTier1();

    const ack = await import('../alerts/ackTracker.js');
    expect(ack.countPendingAcks()).toBe(1);
    expect(ack.listPendingAcks()[0].ackId).toBe('rg1');
    expect(editMessageTextMock).not.toHaveBeenCalled();
  });
});
