// @responsibility Verify read-only current Shadow commands.
import { describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../../commandRegistry.js';
const mocks = vi.hoisted(() => ({ view: vi.fn(() => ({ mode: 'SHADOW', lastRun: null, experiments: [], totalCount: 0, completedCount: 0, outcomes: [] })) }));
vi.mock('../../../trading/paper/paperExperimentRunner.js', () => ({ getPaperExperimentView: mocks.view }));
vi.mock('../../../alerts/paperBot.js', () => ({ recentPaperNews: () => [] }));
vi.mock('../../../trading/paper/paperMorningRuntime.js', () => ({ formatStoredPaperMorningReport: () => '저장된 08:30 추천 · 이후 가상 성과',
  getPaperMorningReviewSafely: () => undefined }));
vi.mock('../../../trading/paper/paperAccountRuntime.js', () => ({ readVirtualAccount: () => { throw new Error('계좌 파일 읽기 실패'); } }));
vi.mock('../../../persistence/paperBotRepo.js', () => ({ loadPaperBotState: () => ({ messages: [], lastCheckedAt: null }) }));
vi.mock('../../../state.js', () => ({ getTradingMode: () => 'SHADOW', getAutoTradePaused: () => false }));
import './paper.cmd.js';
describe('current Shadow commands', () => {
  it.each(['/paper', '/paper_research', '/paper_bot', '/paper_recommend'])('registers %s as a read-only command with a usable reply', async name => {
    const command = commandRegistry.resolve(name);
    expect(command?.riskLevel).toBe(0);
    const reply = vi.fn(async (_message: string) => {});
    await command!.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(name === '/paper_research' ? 2 : 1);
    expect(reply.mock.calls[0]?.[0]).toContain('현재 모드 SHADOW');
  });
  it('sends the archived study after the live research so the length limit cannot drop the exit comparison', async () => {
    const reply = vi.fn(async (_message: string) => {});
    await commandRegistry.resolve('/paper_research')!.execute({ args: [], reply });
    expect(reply.mock.calls[0]?.[0]).toContain('Shadow 연구 점검');
    expect(reply.mock.calls[0]?.[0]).not.toContain('저장 자료 연구 · 자율 연구와 별도');
    expect(reply.mock.calls[1]?.[0]).toContain('저장 자료 연구 · 자율 연구와 별도');
    expect(reply.mock.calls[1]?.[0]).not.toContain('현재 모드');
  });
  it('shows the operation checklist in /paper and reports an unreadable account instead of failing', async () => {
    const reply = vi.fn(async (_message: string) => {});
    await commandRegistry.resolve('/paper')!.execute({ args: [], reply });
    expect(reply.mock.calls[0]?.[0]).toContain('Shadow 운용 점검');
    expect(reply.mock.calls[0]?.[0]).toContain('❌ 가상 계좌 기록 확인 불가');
  });
  it('reads every saved record so daily counts match the scheduled reports', async () => {
    mocks.view.mockClear();
    for (const name of ['/paper', '/paper_research']) await commandRegistry.resolve(name)!.execute({ args: [], reply: vi.fn(async () => {}) });
    expect(mocks.view.mock.calls.map(call => (call as unknown[])[0])).toEqual([true, true]);
  });
});
