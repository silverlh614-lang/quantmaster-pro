// @responsibility postHolidayKickstart — isPostHolidayFirstDay 분기 + 5 check + 메시지 빌더 회귀 (ADR-0131)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;
const origDataDir = process.env.PERSIST_DATA_DIR;
const origDisabled = process.env.POST_HOLIDAY_KICKSTART_DISABLED;

type AlertOpts = { priority?: string; dedupeKey?: string; cooldownMs?: number; category?: string };
const sendTelegramAlertMock = vi.fn(async (_msg: string, _opts?: AlertOpts) => 1);
vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: sendTelegramAlertMock,
}));

vi.mock('../health/diagnostics.js', () => ({
  collectHealthSnapshot: vi.fn(),
}));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-holiday-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  delete process.env.POST_HOLIDAY_KICKSTART_DISABLED;
  sendTelegramAlertMock.mockClear();
  vi.resetModules();
});

afterEach(() => {
  if (origDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = origDataDir;
  if (origDisabled === undefined) delete process.env.POST_HOLIDAY_KICKSTART_DISABLED;
  else process.env.POST_HOLIDAY_KICKSTART_DISABLED = origDisabled;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const baseHealth = {
  watchlistCount: 10,
  activePositions: 0,
  autoTradeEnabled: true,
  autoTradeMode: 'SHADOW',
  emergencyStop: false,
  kisConfigured: true,
  kisTokenHours: 12,
  krxTokenConfigured: true,
  krxTokenValid: true,
  krxCircuitState: 'CLOSED',
  krxFailures: 0,
};

async function imp() {
  return await import('./postHolidayKickstart.js');
}
async function impDiag() {
  return await import('../health/diagnostics.js');
}

describe('ADR-0131 — isPostHolidayFirstDay 4 분기', () => {
  it('정상 거래일 (어제도 영업일) → false', async () => {
    const { isPostHolidayFirstDay } = await imp();
    // 2026-04-29 수 (어제 4-28 화 영업일)
    expect(isPostHolidayFirstDay(new Date('2026-04-29T00:00:00Z'))).toBe(false);
  });

  it('월요일 (어제 일요일 비영업) → true', async () => {
    const { isPostHolidayFirstDay } = await imp();
    // 2026-04-27 월 (어제 4-26 일요일)
    expect(isPostHolidayFirstDay(new Date('2026-04-27T00:00:00Z'))).toBe(true);
  });

  it('휴장일 본인 (KRX 공휴일/주말) → false', async () => {
    const { isPostHolidayFirstDay } = await imp();
    // 2026-04-26 일요일
    expect(isPostHolidayFirstDay(new Date('2026-04-26T00:00:00Z'))).toBe(false);
  });

  it('어린이날 (5/5 화) 다음 날 (5/6 수) → true', async () => {
    const { isPostHolidayFirstDay } = await imp();
    expect(isPostHolidayFirstDay(new Date('2026-05-06T00:00:00Z'))).toBe(true);
  });
});

describe('ADR-0131 — preMarketKickstart 일반 거래일 silent', () => {
  it('일반 거래일에는 snapshot 호출 없음 + 텔레그램 없음', async () => {
    const { preMarketKickstart } = await imp();
    const { collectHealthSnapshot } = await impDiag();
    // 화요일 — 어제도 영업일
    await preMarketKickstart(new Date('2026-04-28T00:00:00Z'));
    expect(collectHealthSnapshot).not.toHaveBeenCalled();
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });

  it('POST_HOLIDAY_KICKSTART_DISABLED=true 시 휴장 후 첫날도 silent', async () => {
    process.env.POST_HOLIDAY_KICKSTART_DISABLED = 'true';
    const { preMarketKickstart } = await imp();
    await preMarketKickstart(new Date('2026-04-27T00:00:00Z')); // 월
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });
});

describe('ADR-0131 — preMarketKickstart 5 check 분기', () => {
  it('휴장 후 첫날 + 모두 PASS → ✅ 헤더 + NORMAL 알림', async () => {
    const { preMarketKickstart, loadPostHolidayState } = await imp();
    const { collectHealthSnapshot } = await impDiag();
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({ ...baseHealth });

    await preMarketKickstart(new Date('2026-04-27T00:00:00Z')); // 월
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    const msg = String(sendTelegramAlertMock.mock.calls[0][0]);
    expect(msg).toMatch(/^✅/);
    const opts = sendTelegramAlertMock.mock.calls[0][1] as { priority?: string };
    expect(opts?.priority).toBe('NORMAL');
    const state = loadPostHolidayState();
    expect(state.lastChecks?.length).toBe(5);
  });

  it('KIS 토큰 만료 (FAIL) → 🚨 헤더 + CRITICAL 알림', async () => {
    const { preMarketKickstart } = await imp();
    const { collectHealthSnapshot } = await impDiag();
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      ...baseHealth,
      kisTokenHours: 0,
    });

    await preMarketKickstart(new Date('2026-04-27T00:00:00Z'));
    const msg = String(sendTelegramAlertMock.mock.calls[0][0]);
    expect(msg).toMatch(/^🚨/);
    expect(msg).toContain('KIS Token');
    const opts = sendTelegramAlertMock.mock.calls[0][1] as { priority?: string };
    expect(opts?.priority).toBe('CRITICAL');
  });

  it('워치리스트 부족 (3개, WARN) → ⚠️ 헤더 + HIGH 알림', async () => {
    const { preMarketKickstart } = await imp();
    const { collectHealthSnapshot } = await impDiag();
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      ...baseHealth,
      watchlistCount: 3,
    });

    await preMarketKickstart(new Date('2026-04-27T00:00:00Z'));
    const msg = String(sendTelegramAlertMock.mock.calls[0][0]);
    expect(msg).toMatch(/^⚠️/);
    const opts = sendTelegramAlertMock.mock.calls[0][1] as { priority?: string };
    expect(opts?.priority).toBe('HIGH');
  });

  it('비상정지 활성 → Auto Trade FAIL', async () => {
    const { preMarketKickstart } = await imp();
    const { collectHealthSnapshot } = await impDiag();
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      ...baseHealth,
      emergencyStop: true,
    });

    await preMarketKickstart(new Date('2026-04-27T00:00:00Z'));
    const msg = String(sendTelegramAlertMock.mock.calls[0][0]);
    expect(msg).toContain('비상정지');
  });
});

describe('ADR-0131 — formatKickstartMessage 헤더 이모지', () => {
  it('FAIL 1건 → 🚨', async () => {
    const { formatKickstartMessage } = await imp();
    const msg = formatKickstartMessage(
      [
        { name: 'A', status: 'PASS', detail: 'ok' },
        { name: 'B', status: 'FAIL', detail: 'fail' },
      ],
      '2026-04-27',
    );
    expect(msg).toMatch(/^🚨/);
  });

  it('WARN 1건만 → ⚠️', async () => {
    const { formatKickstartMessage } = await imp();
    const msg = formatKickstartMessage(
      [
        { name: 'A', status: 'PASS', detail: 'ok' },
        { name: 'B', status: 'WARN', detail: 'warn' },
      ],
      '2026-04-27',
    );
    expect(msg).toMatch(/^⚠️/);
  });

  it('모두 PASS → ✅', async () => {
    const { formatKickstartMessage } = await imp();
    const msg = formatKickstartMessage(
      [{ name: 'A', status: 'PASS', detail: 'ok' }],
      '2026-04-27',
    );
    expect(msg).toMatch(/^✅/);
  });
});

describe('ADR-0131 — preMarketFollowup 변화 비교', () => {
  it('1차 fail → 2차 pass 회복 시 변화 보고', async () => {
    const { preMarketKickstart, preMarketFollowup, savePostHolidayState } = await imp();
    const { collectHealthSnapshot } = await impDiag();

    // 휴장 후 첫 거래일: 2026-05-06 수 (5/5 어린이날 직후).
    // 1차: FAIL 상태 영속 (lastFirstDayDate=05-06)
    savePostHolidayState({
      lastFirstDayCheckedAt: '2026-05-05T22:30:00Z',
      lastFirstDayDate: '2026-05-06',
      lastChecks: [
        { name: 'KIS Token', status: 'FAIL', detail: '만료' },
        { name: 'KRX Master', status: 'PASS', detail: 'ok' },
        { name: 'KRX OpenAPI', status: 'PASS', detail: 'ok' },
        { name: 'Auto Trade', status: 'PASS', detail: 'ok' },
        { name: 'Watchlist', status: 'PASS', detail: 'ok' },
      ],
    });

    // 2차: KIS 토큰 회복
    (collectHealthSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      ...baseHealth,
      kisTokenHours: 18,
    });

    // KST 2026-05-06 08:30 = UTC 2026-05-05 23:30
    await preMarketFollowup(new Date('2026-05-05T23:30:00Z'));
    expect(sendTelegramAlertMock).toHaveBeenCalled();
    const msg = String(sendTelegramAlertMock.mock.calls[0][0]);
    expect(msg).toMatch(/추적/);
  });

  it('1차 점검 미실행 + 2차만 호출 시 silent (매칭 데이터 없음)', async () => {
    const { preMarketFollowup } = await imp();
    // 휴장 후 첫 거래일 (5/6 수) 이지만 1차 영속 부재
    await preMarketFollowup(new Date('2026-05-05T23:30:00Z'));
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });
});
