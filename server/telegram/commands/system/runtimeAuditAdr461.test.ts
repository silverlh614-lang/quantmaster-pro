import { describe, expect, it, vi } from 'vitest';

let disabled = false;

vi.mock('../../../diagnostics/runtimePipelineAudit.js', () => ({
  isRuntimePipelineAuditDisabled: () => disabled,
  buildRuntimePipelineAuditSnapshot: () => ({ latestStage: 'BEFORE_BUYLIST_LOOP' }),
  formatRuntimePipelineAuditDetails: () => '📍 Runtime Pipeline Audit (ADR-461)\n  • latestStage: BEFORE_BUYLIST_LOOP\n  • ADR-460: not installed\n  • livePathSafety: PASS',
}));

describe('ADR-461 /runtime_audit command', () => {
  it('/runtime_audit 명령이 상세 출력', async () => {
    disabled = false;
    await import('./runtimeAudit.cmd.js');
    const { commandRegistry } = await import('../../commandRegistry.js');
    const cmd = commandRegistry.resolve('/runtime_audit')!;
    const reply = vi.fn<Parameters<typeof cmd.execute>[0]['reply']>().mockResolvedValue(undefined);
    await cmd.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('Runtime Pipeline Audit (ADR-461)'));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('ADR-460: not installed'));
  });

  it('/ra alias 등록', async () => {
    await import('./runtimeAudit.cmd.js');
    const { commandRegistry } = await import('../../commandRegistry.js');
    expect(commandRegistry.resolve('/ra')).toBe(commandRegistry.resolve('/runtime_audit'));
  });

  it('ENV disabled 시 출력 skip', async () => {
    disabled = true;
    await import('./runtimeAudit.cmd.js');
    const { commandRegistry } = await import('../../commandRegistry.js');
    const cmd = commandRegistry.resolve('/runtime_audit')!;
    const reply = vi.fn<Parameters<typeof cmd.execute>[0]['reply']>().mockResolvedValue(undefined);
    await cmd.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining('disabled by RUNTIME_PIPELINE_AUDIT_DISABLED=true'));
  });
});
