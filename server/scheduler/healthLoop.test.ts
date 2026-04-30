// @responsibility healthLoop — 4 임계 분기 + alertOnce dedupe + 영속 round-trip 회귀 (ADR-0131)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;
const origDataDir = process.env.PERSIST_DATA_DIR;
const origDisabled = process.env.HEALTH_LOOP_DISABLED;

type AlertOpts = { priority?: string; dedupeKey?: string; cooldownMs?: number; category?: string };
const sendTelegramAlertMock = vi.fn(async (_msg: string, _opts?: AlertOpts) => 1);

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: sendTelegramAlertMock,
}));

vi.mock('../health/diagnostics.js', () => ({
  collectHealthSnapshot: vi.fn(),
}));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-loop-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  delete process.env.HEALTH_LOOP_DISABLED;
  sendTelegramAlertMock.mockClear();
  vi.resetModules();
});

afterEach(() => {
  if (origDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = origDataDir;
  if (origDisabled === undefined) delete process.env.HEALTH_LOOP_DISABLED;
  else process.env.HEALTH_LOOP_DISABLED = origDisabled;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface MockSnapshot {
  kisConfigured: boolean;
  kisTokenHours: number;
  autoTradeEnabled: boolean;
  autoTradeMode: string;
  watchlistCount: number;
  activePositions: number;
  emergencyStop: boolean;
  krxTokenConfigured: boolean;
  krxTokenValid: boolean;
  krxCircuitState: string;
  krxFailures: number;
}

const baseSnapshot: MockSnapshot = {
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

async function importHealthLoop() {
  return await import('./healthLoop.js');
}
async function importDiagnostics() {
  return await import('../health/diagnostics.js');
}

describe('ADR-0131 — Tier 1 KIS 토큰 6h bucket 변화', () => {
  it('첫 호출 시 lastBucket=undefined → 알림 없음 + state 영속', async () => {
    const { runTier1, loadHealthLoopState } = await importHealthLoop();
    const { collectHealthSnapshot } = await importDiagnostics();
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({ ...baseSnapshot });

    await runTier1();
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
    const state = loadHealthLoopState();
    expect(state.kisTokenLastBucket).toBe(2); // floor(12/6)=2
  });

  it('bucket 감소 시 (12h→8h, bucket 2→1) 알림 발송', async () => {
    const { runTier1 } = await importHealthLoop();
    const { collectHealthSnapshot } = await importDiagnostics();
    (collectHealthSnapshot as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ ...baseSnapshot, kisTokenHours: 12 })
      .mockReturnValueOnce({ ...baseSnapshot, kisTokenHours: 8 });

    await runTier1();
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
    await runTier1();
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    const args = sendTelegramAlertMock.mock.calls[0];
    expect(String(args[0])).toMatch(/KIS 토큰 잔여 8/);
  });

  it('kisTokenHours=0 (만료) 시 CRITICAL 알림', async () => {
    const { runTier1 } = await importHealthLoop();
    const { collectHealthSnapshot } = await importDiagnostics();
    (collectHealthSnapshot as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ ...baseSnapshot, kisTokenHours: 12 })
      .mockReturnValueOnce({ ...baseSnapshot, kisTokenHours: 0 });

    await runTier1();
    sendTelegramAlertMock.mockClear();
    await runTier1();
    expect(sendTelegramAlertMock).toHaveBeenCalled();
    const opts = sendTelegramAlertMock.mock.calls[0][1] as { priority?: string };
    expect(opts?.priority).toBe('CRITICAL');
  });

  it('bucket 동일 (12h→12h) 시 알림 없음', async () => {
    const { runTier1 } = await importHealthLoop();
    const { collectHealthSnapshot } = await importDiagnostics();
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({ ...baseSnapshot });

    await runTier1();
    sendTelegramAlertMock.mockClear();
    await runTier1();
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });
});

describe('ADR-0131 — Tier 1 AUTO_TRADE 토글', () => {
  it('AUTO_TRADE true→false 변화 시 HIGH 알림', async () => {
    const { runTier1 } = await importHealthLoop();
    const { collectHealthSnapshot } = await importDiagnostics();
    (collectHealthSnapshot as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ ...baseSnapshot, autoTradeEnabled: true })
      .mockReturnValueOnce({ ...baseSnapshot, autoTradeEnabled: false });

    await runTier1();
    sendTelegramAlertMock.mockClear();
    await runTier1();
    const calls = sendTelegramAlertMock.mock.calls;
    expect(calls.length).toBe(1);
    expect(String(calls[0][0])).toMatch(/자동매매 비활성화/);
  });

  it('AUTO_TRADE false→true 변화 시 NORMAL 알림', async () => {
    const { runTier1 } = await importHealthLoop();
    const { collectHealthSnapshot } = await importDiagnostics();
    (collectHealthSnapshot as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ ...baseSnapshot, autoTradeEnabled: false })
      .mockReturnValueOnce({ ...baseSnapshot, autoTradeEnabled: true });

    await runTier1();
    sendTelegramAlertMock.mockClear();
    await runTier1();
    const calls = sendTelegramAlertMock.mock.calls;
    expect(calls.length).toBe(1);
    expect(String(calls[0][0])).toMatch(/자동매매 활성화/);
    const opts = calls[0][1] as { priority?: string };
    expect(opts?.priority).toBe('NORMAL');
  });
});

describe('ADR-0131 — alertOnce dedupe 중복 차단', () => {
  it('같은 날 같은 key 중복 알림 차단', async () => {
    const { alertOnce, loadHealthLoopState } = await importHealthLoop();
    const state = loadHealthLoopState();
    const ok1 = await alertOnce(state, 'test_key', 'message 1');
    expect(ok1).toBe(true);
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    const ok2 = await alertOnce(state, 'test_key', 'message 2');
    expect(ok2).toBe(false);
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1); // 추가 호출 없음
  });

  it('telegram 실패 시 alertedKeys 미갱신 (다음 cron 재시도)', async () => {
    sendTelegramAlertMock.mockRejectedValueOnce(new Error('network'));
    const { alertOnce, loadHealthLoopState } = await importHealthLoop();
    const state = loadHealthLoopState();
    const ok = await alertOnce(state, 'test_key', 'msg');
    expect(ok).toBe(false);
    expect(state.alertedKeys?.test_key).toBeUndefined();
  });
});

describe('ADR-0131 — state 영속 round-trip + 손상 fallback', () => {
  it('saveHealthLoopState → loadHealthLoopState 정합', async () => {
    const { saveHealthLoopState, loadHealthLoopState } = await importHealthLoop();
    saveHealthLoopState({
      kisTokenLastBucket: 1,
      masterLastCount: 2700,
      masterTier4Active: false,
      autoTradeLastEnabled: true,
      lastTier1RunAt: '2026-04-30T10:00:00Z',
      alertedKeys: { foo: '2026-04-30' },
    });
    const loaded = loadHealthLoopState();
    expect(loaded.kisTokenLastBucket).toBe(1);
    expect(loaded.masterLastCount).toBe(2700);
    expect(loaded.alertedKeys?.foo).toBe('2026-04-30');
  });

  it('손상된 JSON → 빈 state fallback (graceful)', async () => {
    const { HEALTH_LOOP_STATE_FILE } = await import('../persistence/paths.js');
    fs.writeFileSync(HEALTH_LOOP_STATE_FILE, '{"corrupted":');
    const { loadHealthLoopState } = await importHealthLoop();
    const loaded = loadHealthLoopState();
    expect(loaded).toEqual({});
  });

  it('파일 부재 시 빈 객체 반환', async () => {
    const { loadHealthLoopState } = await importHealthLoop();
    expect(loadHealthLoopState()).toEqual({});
  });

  it('HEALTH_LOOP_DISABLED=true 시 runTier1 즉시 종료 (snapshot 호출 없음)', async () => {
    process.env.HEALTH_LOOP_DISABLED = 'true';
    const { runTier1 } = await importHealthLoop();
    const { collectHealthSnapshot } = await importDiagnostics();
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockClear();
    await runTier1();
    expect(collectHealthSnapshot).not.toHaveBeenCalled();
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });

  it('Tier 2 / Tier 3 실행 시 각 lastRunAt 영속', async () => {
    const { runTier2, runTier3, loadHealthLoopState } = await importHealthLoop();
    await runTier2();
    await runTier3();
    const state = loadHealthLoopState();
    expect(state.lastTier2RunAt).toBeDefined();
    expect(state.lastTier3RunAt).toBeDefined();
  });
});
