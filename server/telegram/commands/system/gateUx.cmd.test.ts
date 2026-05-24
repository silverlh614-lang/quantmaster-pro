import { describe, expect, it } from 'vitest';

describe('ADR-0523 Gate UX command registration', () => {
  it('registers compact/detail/full Gate and execution aliases for Telegram autocomplete', async () => {
    const registry = await import('../../commandRegistry.js');
    registry.commandRegistry.__resetForTests();
    await import('./gateUx.cmd.js');

    const gate = registry.commandRegistry.resolve('/gate');
    expect(gate).toBeDefined();
    expect(registry.commandRegistry.resolve('/gate_compact')).toBe(gate);
    expect(registry.commandRegistry.resolve('/scan_blockers_compact')).toBe(gate);
    expect(registry.commandRegistry.resolve('/gate_detail')).toBeDefined();
    expect(registry.commandRegistry.resolve('/gate_full')).toBeDefined();
    expect(registry.commandRegistry.resolve('/exec')).toBeDefined();
    expect(registry.commandRegistry.resolve('/exec_full')).toBeDefined();
    expect(registry.commandRegistry.resolve('/debug_gate')).toBeDefined();
    expect(registry.commandRegistry.resolve('/debug_snapshot')).toBe(registry.commandRegistry.resolve('/debug_gate'));
  }, 15000);
});
