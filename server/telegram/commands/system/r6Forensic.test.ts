// @responsibility 폐기한 레짐 진단 명령이 계산 없이 새 모델 안내를 반환하는지 검증한다.
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ register: vi.fn(), diagnostics: vi.fn(() => { throw new Error('REGIME_RETIRED'); }) }));
vi.mock('../../commandRegistry.js', () => ({ commandRegistry: { register: mocks.register } }));
vi.mock('../../../trading/regimeBridge.js', () => ({ getRegimeDiagnostics: mocks.diagnostics }));
import command from './r6Forensic.cmd.js';
describe(command.name, () => {
  it('현재 레짐을 재계산하지 않고 관측·연구 명령으로 안내한다', async () => {
    const reply = vi.fn(async (_message: string) => undefined);
    await command.execute({ args: [], reply });
    expect(mocks.register).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('폐기'));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('/paper_research'));
    expect(mocks.diagnostics).not.toHaveBeenCalled();
  });
});
