// @responsibility 레짐 전환 알림 idempotency(재시작 유령 알림 차단) 회귀 커버리지.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { MacroState } from '../persistence/macroStateRepo.js';

// telegram/channel 발송만 가로채고 나머지 export 는 실제 모듈 유지.
const alertMock = vi.hoisted(() => ({ sendTelegramAlert: vi.fn(), channelRegimeChange: vi.fn() }));
vi.mock('../alerts/telegramClient.js', async (orig) => ({
  ...(await orig<typeof import('../alerts/telegramClient.js')>()),
  sendTelegramAlert: alertMock.sendTelegramAlert,
}));
vi.mock('../alerts/channelPipeline.js', async (orig) => ({
  ...(await orig<typeof import('../alerts/channelPipeline.js')>()),
  channelRegimeChange: alertMock.channelRegimeChange,
}));

// PERSIST_DATA_DIR 은 paths.ts import 시점에 1회 읽히므로 모듈 import 전에 고정한다.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regime-notify-'));
process.env.PERSIST_DATA_DIR = tmpDir;
const notifyFile = path.join(tmpDir, 'regime-notify-state.json');

function macro(overrides: Partial<MacroState> = {}): MacroState {
  return {
    mhs: 72,
    regime: 'GREEN',
    updatedAt: '2026-06-25T00:00:00.000Z',
    vkospi: 17,
    vkospiDayChange: -3,
    usdKrwDayChange: -0.2,
    usdKrw20dChange: -1,
    kospiDayReturn: 0.8,
    kospi20dReturn: 4,
    kospiAbove20MA: true,
    kospiAbove60MA: true,
    foreignNetBuy5d: 5000,
    passiveActiveBoth: true,
    vkospi5dTrend: -3,
    spx20dReturn: 3,
    vix: 15,
    dxy5dChange: -1,
    shortSellingRatio: 4,
    ...overrides,
  } as MacroState;
}

// VKOSPI day spike → 활성 R6 트리거 → effectiveRegime R6_DEFENSE.
const bearMacro = () => macro({ mhs: 25, vkospi: 40, vkospiDayChange: 31, kospiDayReturn: -3.5, spx20dReturn: -5, vix: 35 });

beforeEach(() => {
  alertMock.sendTelegramAlert.mockReset().mockResolvedValue(undefined);
  alertMock.channelRegimeChange.mockReset().mockResolvedValue(undefined);
});

beforeAll(() => {
  process.env.PERSIST_DATA_DIR = tmpDir;
});
afterAll(() => {
  delete process.env.PERSIST_DATA_DIR;
});

describe('checkAndNotifyRegimeChange — 알림 idempotency', () => {
  it('재시작 baseline 이 현재 regime 과 같으면 전환 알림을 재생하지 않는다 (유령 알림 차단)', async () => {
    const mod = await import('./regimeBridge.base.js');
    // getLiveRegime 은 _previousRegime 을 건드리지 않으므로 first-call 상태가 유지된다.
    const current = mod.getLiveRegime(macro());
    // 마지막으로 *알림한* regime baseline 을 현재와 동일하게 디스크에 기록 = "재시작 직전 동일 상태".
    fs.writeFileSync(notifyFile, JSON.stringify({ regime: current, mhs: 72, vkospi: 17, at: '2026-06-25T00:00:00.000Z' }));

    await mod.checkAndNotifyRegimeChange(macro());

    expect(alertMock.sendTelegramAlert).not.toHaveBeenCalled();
    expect(alertMock.channelRegimeChange).not.toHaveBeenCalled();
  }, 30000);

  it('실제 in-process 전환은 1회만 알림하고 baseline 을 영속화한다', async () => {
    const mod = await import('./regimeBridge.base.js');
    // 직전 테스트에서 _previousRegime 은 current(R3_EARLY)로 시드된 상태.
    await mod.checkAndNotifyRegimeChange(bearMacro());
    expect(alertMock.sendTelegramAlert).toHaveBeenCalledTimes(1);

    // baseline 이 R6_DEFENSE 로 영속화됐는지 — 다음 재시작 때 재생 방지.
    const persisted = JSON.parse(fs.readFileSync(notifyFile, 'utf-8'));
    expect(persisted.regime).toBe('R6_DEFENSE');

    // 같은 상태로 한 번 더 호출해도 중복 발사 없음.
    await mod.checkAndNotifyRegimeChange(bearMacro());
    expect(alertMock.sendTelegramAlert).toHaveBeenCalledTimes(1);
  }, 30000);
});
