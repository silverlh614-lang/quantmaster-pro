// @responsibility Verify read-only current Shadow commands.
import { describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../../commandRegistry.js';
const mocks = vi.hoisted(() => ({ view: vi.fn(() => ({ mode: 'SHADOW', lastRun: null, experiments: [], totalCount: 0, completedCount: 0, outcomes: [] })) }));
vi.mock('../../../trading/paper/paperExperimentRunner.js', () => ({ getPaperExperimentView: mocks.view }));
vi.mock('../../../alerts/paperBot.js', () => ({ recentPaperNews: () => [] }));
vi.mock('../../../persistence/paperBotRepo.js', () => ({ loadPaperBotState: () => ({ messages: [], lastCheckedAt: null }) }));
vi.mock('../../../state.js', () => ({ getTradingMode: () => 'SHADOW', getAutoTradePaused: () => false }));
import './paper.cmd.js';
describe('current Shadow commands', () => {
  it.each(['/paper', '/paper_research', '/paper_bot'])('registers %s as a read-only command with a usable reply', async name => {
    const command = commandRegistry.resolve(name);
    expect(command?.riskLevel).toBe(0);
    const reply = vi.fn(async (_message: string) => {});
    await command!.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]?.[0]).toContain('현재 모드 SHADOW');
  });
});
