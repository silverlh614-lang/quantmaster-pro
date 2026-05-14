import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  delete process.env.KIS_SECTOR_INDEX_DAILY_ENABLED;
});

describe('/sector_iscd_probe command', () => {
  it('registers as an admin read-only diagnostic command', async () => {
    const mod = await import('./sectorIscdProbe.cmd.js');

    expect(mod.default.name).toBe('/sector_iscd_probe');
    expect(mod.default.category).toBe('SYS');
    expect(mod.default.visibility).toBe('ADMIN');
    expect(mod.default.riskLevel).toBe(0);
  }, 15_000);

  it('does not probe when KIS sector index daily endpoint is disabled', async () => {
    const mod = await import('./sectorIscdProbe.cmd.js');

    await expect(mod.buildSectorIscdProbeMessage()).resolves.toContain('KIS_SECTOR_INDEX_DAILY_ENABLED=true 필요');
  }, 15_000);
});
