// @responsibility 현행 상태 명령의 등록·최신 보고 위임을 검증한다.
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../metaCommands.js', () => ({ composeNowVerdict: vi.fn() }));
import { composeNowVerdict } from '../../metaCommands.js';
import { commandRegistry } from '../../commandRegistry.js';
import './status.cmd.js';

describe('/status current command', () => {
  it('remains a read-only menu command', () => {
    expect(commandRegistry.resolve('/status')).toMatchObject({
      name: '/status', category: 'SYS', visibility: 'MENU', riskLevel: 0,
    });
  });

  it('composes a fresh current report for each request', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    vi.mocked(composeNowVerdict)
      .mockReturnValueOnce('Shadow 현재 현황 · 보유 0')
      .mockReturnValueOnce('Shadow 현재 현황 · 관측 갱신 확인 필요');
    const command = commandRegistry.resolve('/status')!;
    await command.execute({ args: [], reply });
    await command.execute({ args: [], reply });
    expect(composeNowVerdict).toHaveBeenCalledTimes(2);
    expect(reply).toHaveBeenNthCalledWith(1, 'Shadow 현재 현황 · 보유 0');
    expect(reply).toHaveBeenNthCalledWith(2, 'Shadow 현재 현황 · 관측 갱신 확인 필요');
  });
});
