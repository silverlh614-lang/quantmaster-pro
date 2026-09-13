// @responsibility Verify retired live regime getters perform no classification, transition writes, weight resets, or Telegram delivery.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MacroState } from '../persistence/macroStateRepo.js';

const boundary = vi.hoisted(() => ({ classify: vi.fn(), load: vi.fn(), save: vi.fn(), reset: vi.fn(), send: vi.fn(), channel: vi.fn() }));
vi.mock('../../src/services/quant/regimeEngine.js', () => ({ classifyRegime: boundary.classify }));
vi.mock('../persistence/regimeTransitionStateRepo.js', async (importActual) => ({
  ...(await importActual<typeof import('../persistence/regimeTransitionStateRepo.js')>()),
  loadRegimeTransitionState: boundary.load,
  saveRegimeTransitionState: boundary.save,
}));
vi.mock('../persistence/conditionWeightsRepo.js', async (importActual) => ({
  ...(await importActual<typeof import('../persistence/conditionWeightsRepo.js')>()),
  resetConditionWeightsForRegime: boundary.reset,
}));
vi.mock('../alerts/telegramClient.js', () => ({ sendTelegramAlert: boundary.send }));
vi.mock('../alerts/channelPipeline.js', () => ({ channelRegimeChange: boundary.channel }));

import * as bridge from './regimeBridge.js';
import * as base from './regimeBridge.base.js';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('retired live regime bridge', () => {
  it.each([undefined, 'true', 'false'])('old hysteresis flag %s cannot classify or persist', async (value) => {
    vi.stubEnv('REGIME_HYSTERESIS_ENABLED', value);
    vi.stubEnv('REGIME_NOTIFY_WHEN_CLOSED', 'true');
    vi.stubEnv('REGIME_RISK_ON_FAST_UPGRADE_ENABLED', 'true');
    const macro = { regime: 'R6_DEFENSE', mhs: 0, kospiDayReturn: -10 } as MacroState;
    for (const api of [bridge, base]) {
      expect(() => api.getRawRegime(macro)).toThrowError('REGIME_RETIRED');
      expect(() => api.getLiveRegime(macro)).toThrowError('REGIME_RETIRED');
      expect(() => api.getRegimeDiagnostics(macro)).toThrowError('REGIME_RETIRED');
      await expect(api.checkAndNotifyRegimeChange(macro)).rejects.toMatchObject({ code: 'REGIME_RETIRED' });
    }
    for (const dependency of Object.values(boundary)) expect(dependency).not.toHaveBeenCalled();
  });
});
