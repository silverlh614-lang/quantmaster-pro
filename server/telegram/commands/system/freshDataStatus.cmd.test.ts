import { describe, expect, it } from 'vitest';

describe('/fresh_data_status command metadata', () => {
  it('registers compact aliases for operator use', async () => {
    const mod = await import('./freshDataStatus.cmd.js');

    expect(mod.default.name).toBe('/fresh_data_status');
    expect(mod.default.aliases).toContain('/fd');
    expect(mod.default.aliases).toContain('/fds');
    expect(mod.default.category).toBe('SYS');
    expect(mod.default.visibility).toBe('ADMIN');
    expect(mod.default.riskLevel).toBe(0);
  }, 15_000);
});
