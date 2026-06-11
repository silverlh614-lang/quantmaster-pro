// @responsibility healthLoop — KIS 토큰 만료 선치유-후경보(heal-first) + ack 해소 회복 가시화 회귀 (2026-06-11 인시던트)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;
const origDataDir = process.env.PERSIST_DATA_DIR;
const origDisabled = process.env.HEALTH_LOOP_DISABLED;
const origCriticalOnKrxClosed = process.env.HEALTH_LOOP_CRITICAL_ON_KRX_CLOSED;

type AlertOpts = {
  priority?: string;
  dedupeKey?: string;
  noiseEvent?: { eventType?: string; status?: string; channel?: string; executionImpact?: string };
};
const sendTelegramAlertMock = vi.fn(async (_msg?: string, _opts?: AlertOpts) => 1);
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

const refreshKisTokenMock = vi.fn(async () => 'token');
const refreshRealDataTokenMock = vi.fn(async () => 'real-token');
const getKisTokenRemainingHoursMock = vi.fn(() => 0);

vi.mock('../clients/kisClient/auth.js', () => ({
  refreshKisToken: refreshKisTokenMock,
  refreshRealDataToken: refreshRealDataTokenMock,
  getKisTokenRemainingHours: getKisTokenRemainingHoursMock,
}));

// HAS_REAL_DATA_CLIENT 를 테스트별로 토글 — getter 로 매 접근 시 ctl 반영.
// partial mock: KIS_IS_REAL 등 나머지 상수는 원본 유지 (orderGateway 등 전이 import).
const ctl = { hasRealData: false };
vi.mock('../clients/kisClient/constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/kisClient/constants.js')>();
  return {
    ...actual,
    get HAS_REAL_DATA_CLIENT() {
      return ctl.hasRealData;
    },
  };
});

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-healfirst-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  delete process.env.HEALTH_LOOP_DISABLED;
  // 실행 요일 무관 deterministic CRITICAL 분기 (ADR-0157 패턴) — 휴장일 테스트는 개별 해제.
  process.env.HEALTH_LOOP_CRITICAL_ON_KRX_CLOSED = 'true';
  ctl.hasRealData = false;
  sendTelegramAlertMock.mockClear();
  editMessageTextMock.mockClear();
  refreshKisTokenMock.mockClear().mockResolvedValue('token');
  refreshRealDataTokenMock.mockClear().mockResolvedValue('real-token');
  getKisTokenRemainingHoursMock.mockClear().mockReturnValue(0);
  vi.resetModules();
});

afterEach(() => {
  if (origDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = origDataDir;
  if (origDisabled === undefined) delete process.env.HEALTH_LOOP_DISABLED;
  else process.env.HEALTH_LOOP_DISABLED = origDisabled;
  if (origCriticalOnKrxClosed === undefined) delete process.env.HEALTH_LOOP_CRITICAL_ON_KRX_CLOSED;
  else process.env.HEALTH_LOOP_CRITICAL_ON_KRX_CLOSED = origCriticalOnKrxClosed;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function importHealthLoop() {
  return await import('./healthLoop.js');
}
async function mockSnapshots(...hours: number[]) {
  const { collectHealthSnapshot } = await import('../health/diagnostics.js');
  const m = collectHealthSnapshot as ReturnType<typeof vi.fn>;
  for (const h of hours) m.mockReturnValueOnce({ ...baseSnapshot, kisTokenHours: h });
  return m;
}

describe('heal-first — 만료 감지 시 CRITICAL 발송 전 재발급 1회 시도', () => {
  it('(a) 만료 + refresh 성공 → NORMAL self-healed 1건, CRITICAL 0건', async () => {
    const { runTier1 } = await importHealthLoop();
    await mockSnapshots(12, 0);
    getKisTokenRemainingHoursMock.mockReturnValue(22);

    await runTier1();
    sendTelegramAlertMock.mockClear();
    await runTier1();

    expect(refreshKisTokenMock).toHaveBeenCalledTimes(1);
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    const [msg, opts] = sendTelegramAlertMock.mock.calls[0] as [string, AlertOpts];
    expect(msg).toMatch(/KIS 토큰 만료 감지 → 자동 재발급 완료/);
    expect(msg).toMatch(/잔여 22\.0h/);
    expect(opts?.priority).toBe('NORMAL');
    expect(opts?.noiseEvent?.eventType).toBe('HEALTH_RECOVERY');
    expect(opts?.noiseEvent?.status).toBe('SELF_HEALED');
    expect(opts?.noiseEvent?.channel).toBe('CH4_JOURNAL');
    expect(opts?.noiseEvent?.executionImpact).toBe('NONE');
  });

  it('(b) 만료 + refresh 실패(throw) → 기존 CRITICAL byte 동일', async () => {
    refreshKisTokenMock.mockRejectedValue(new Error('OAuth down'));
    const { runTier1 } = await importHealthLoop();
    await mockSnapshots(12, 0);

    await runTier1();
    sendTelegramAlertMock.mockClear();
    await runTier1();

    expect(refreshKisTokenMock).toHaveBeenCalledTimes(1);
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    const [msg, opts] = sendTelegramAlertMock.mock.calls[0] as [string, AlertOpts];
    expect(msg).toBe('🚨 KIS 토큰 만료\n자동 갱신 cron 또는 운영자 수동 갱신 필요.');
    expect(opts?.priority).toBe('CRITICAL');
    expect(opts?.noiseEvent?.eventType).toBe('KIS_TOKEN_EXPIRED_IMPACTED');
  });

  it('(b2) refresh resolve 했지만 잔여 여전히 0h → 기존 CRITICAL 경로', async () => {
    getKisTokenRemainingHoursMock.mockReturnValue(0);
    const { runTier1 } = await importHealthLoop();
    await mockSnapshots(12, 0);

    await runTier1();
    sendTelegramAlertMock.mockClear();
    await runTier1();

    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    const [msg, opts] = sendTelegramAlertMock.mock.calls[0] as [string, AlertOpts];
    expect(msg).toMatch(/^🚨 KIS 토큰 만료/);
    expect(opts?.priority).toBe('CRITICAL');
  });

  it('(c) 휴장일 + refresh 실패 → NORMAL 휴장일 점검 다운그레이드 분기 보존', async () => {
    delete process.env.HEALTH_LOOP_CRITICAL_ON_KRX_CLOSED;
    refreshKisTokenMock.mockRejectedValue(new Error('OAuth down'));
    const { runTier1 } = await importHealthLoop();
    await mockSnapshots(12, 0);
    const sunday1 = new Date('2026-06-14T00:00:00+09:00');
    const sunday2 = new Date('2026-06-14T00:05:00+09:00');

    await runTier1(sunday1);
    sendTelegramAlertMock.mockClear();
    await runTier1(sunday2);

    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    const [msg, opts] = sendTelegramAlertMock.mock.calls[0] as [string, AlertOpts];
    expect(msg).toMatch(/KIS 토큰 만료 — 휴장일 점검/);
    expect(opts?.priority).toBe('NORMAL');
    expect(opts?.noiseEvent?.executionImpact).toBe('NONE');
  });

  it('(e) 6h bucket 경고 경로 (12h→8h) 무회귀 — heal 미시도', async () => {
    const { runTier1 } = await importHealthLoop();
    await mockSnapshots(12, 8);

    await runTier1();
    sendTelegramAlertMock.mockClear();
    await runTier1();

    expect(refreshKisTokenMock).not.toHaveBeenCalled();
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    expect(String(sendTelegramAlertMock.mock.calls[0][0])).toMatch(/KIS 토큰 잔여 8/);
  });

  it('realData 토큰 실패는 main self-heal 결과에 무영향 (NORMAL 유지 + 시도 흔적)', async () => {
    ctl.hasRealData = true;
    refreshRealDataTokenMock.mockRejectedValue(new Error('real-data OAuth down'));
    getKisTokenRemainingHoursMock.mockReturnValue(22);
    const { runTier1 } = await importHealthLoop();
    await mockSnapshots(12, 0);

    await runTier1();
    sendTelegramAlertMock.mockClear();
    await runTier1();

    expect(refreshRealDataTokenMock).toHaveBeenCalledTimes(1);
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    const [msg, opts] = sendTelegramAlertMock.mock.calls[0] as [string, AlertOpts];
    expect(msg).toMatch(/자동 재발급 완료/);
    expect(opts?.priority).toBe('NORMAL');
  });
});

describe('회복 가시화 — ack 자동 해소 시 운영자 대면 메시지', () => {
  it('(d-1) pending ack 해소 ≥1 → ✅ 회복 메시지 1건 (NORMAL)', async () => {
    const ack = await import('../alerts/ackTracker.js');
    ack.registerPendingAck({
      ackId: 'kis1',
      messageId: 4242,
      summary: '🚨 KIS 토큰 만료',
      sentAt: Date.now(),
      category: 'health_loop',
      dedupeKey: 'health_loop:kis_token_expired:2026-06-10',
    });

    const { runTier1 } = await importHealthLoop();
    await mockSnapshots(12);
    await runTier1();

    expect(ack.countPendingAcks()).toBe(0);
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    const [msg, opts] = sendTelegramAlertMock.mock.calls[0] as [string, AlertOpts];
    expect(msg).toMatch(/✅ KIS 토큰 재발급 확인 — 만료 경보 해소/);
    expect(msg).toMatch(/1건 자동 해소/);
    expect(opts?.priority).toBe('NORMAL');
    expect(opts?.noiseEvent?.status).toBe('SELF_HEALED');
  });

  it('(d-2) 해소 0건 → 무발송 (평시 무소음 보존)', async () => {
    const { runTier1 } = await importHealthLoop();
    await mockSnapshots(12);
    await runTier1();

    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });
});
