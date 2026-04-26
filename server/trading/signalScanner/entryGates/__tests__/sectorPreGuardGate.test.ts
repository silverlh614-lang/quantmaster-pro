/**
 * @responsibility sectorPreGuardGate 단위 테스트 — 섹터 노출 사전 가드
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../preOrderGuard.js', () => ({
  checkSectorExposureBefore: vi.fn(),
}));
vi.mock('../../../../screener/sectorMap.js', () => ({
  getSectorByCode: vi.fn(() => undefined),
}));

const { sectorPreGuardGate } = await import('../sectorPreGuardGate.js');
const { makeMockCtx, makeMockStock } = await import('./_testHelpers.js');
const { checkSectorExposureBefore } = await import('../../../preOrderGuard.js');
const { getSectorByCode } = await import('../../../../screener/sectorMap.js');

describe('sectorPreGuardGate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('secGuard.allowed=true → pass', async () => {
    (checkSectorExposureBefore as any).mockReturnValue({ allowed: true, projectedSectorWeight: 0.2, reason: 'OK' });
    const r = await sectorPreGuardGate(makeMockCtx({ stock: makeMockStock({ sector: '반도체' }) }));
    expect(r.pass).toBe(true);
  });

  it('secGuard.allowed=false → 차단 + stageLog.sectorGuard + pushTrace', async () => {
    (checkSectorExposureBefore as any).mockReturnValue({
      allowed: false,
      projectedSectorWeight: 0.45,
      reason: '단일 섹터 비중 45% 초과',
    });
    const stock = makeMockStock({ sector: '반도체', name: '삼성전자' });
    const r = await sectorPreGuardGate(makeMockCtx({ stock }));
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.logMessage).toContain('SectorPreGuard');
      expect(r.logMessage).toContain('삼성전자');
      expect(r.logMessage).toContain('45%');
      expect(r.stageLog?.key).toBe('sectorGuard');
      expect(r.stageLog?.value).toContain('BLOCK');
      expect(r.pushTrace).toBe(true);
    }
  });

  it('stock.sector 부재 시 getSectorByCode fallback', async () => {
    (checkSectorExposureBefore as any).mockReturnValue({ allowed: true, projectedSectorWeight: 0.1, reason: 'OK' });
    (getSectorByCode as any).mockReturnValue('자동차');
    const stock = makeMockStock({ sector: undefined as unknown as string, code: '005380' });
    await sectorPreGuardGate(makeMockCtx({ stock }));
    expect(getSectorByCode).toHaveBeenCalledWith('005380');
    expect(checkSectorExposureBefore).toHaveBeenCalledWith(
      expect.objectContaining({ candidateSector: '자동차' }),
    );
  });

  it('estCandidateValue 산식 — gateScore 9 이상 → totalAssets * 0.12 * kellyMultiplier', async () => {
    (checkSectorExposureBefore as any).mockReturnValue({ allowed: true, projectedSectorWeight: 0, reason: '' });
    const stock = makeMockStock({ gateScore: 10 });
    await sectorPreGuardGate(makeMockCtx({ stock, totalAssets: 100_000_000, kellyMultiplier: 1.0 }));
    expect(checkSectorExposureBefore).toHaveBeenCalledWith(
      expect.objectContaining({ candidateValue: 100_000_000 * 0.12 }),
    );
  });

  it('estCandidateValue 산식 — gateScore 5 → 0.05 비중', async () => {
    (checkSectorExposureBefore as any).mockReturnValue({ allowed: true, projectedSectorWeight: 0, reason: '' });
    const stock = makeMockStock({ gateScore: 5 });
    await sectorPreGuardGate(makeMockCtx({ stock, totalAssets: 100_000_000, kellyMultiplier: 1.0 }));
    expect(checkSectorExposureBefore).toHaveBeenCalledWith(
      expect.objectContaining({ candidateValue: 100_000_000 * 0.05 }),
    );
  });

  it('차단 메시지 (candidateSector "?" fallback when both sector and getSectorByCode null)', async () => {
    (checkSectorExposureBefore as any).mockReturnValue({
      allowed: false, projectedSectorWeight: 0.5, reason: 'too high',
    });
    (getSectorByCode as any).mockReturnValue(undefined);
    const stock = makeMockStock({ sector: undefined as unknown as string });
    const r = await sectorPreGuardGate(makeMockCtx({ stock }));
    if (!r.pass) {
      expect(r.logMessage).toContain('?'); // 섹터 미정 fallback
    }
  });
});
