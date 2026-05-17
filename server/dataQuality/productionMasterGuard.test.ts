import { describe, expect, it, vi, beforeEach } from 'vitest';

const repoMock = vi.hoisted(() => ({
  getMasterSize: vi.fn(() => 2500),
  RAW_KRX_MASTER_MIN_TOTAL: 2000,
  TRADABLE_KRX_UNIVERSE_MIN_TOTAL: 1500,
  getKrxMasterMetadata: vi.fn(() => ({
    raw_krx_master_total: 2500,
    tradable_universe_total: 2000,
    scanner_candidate_total: 60,
  })),
  isMasterStale: vi.fn(() => false),
}));

vi.mock('../persistence/krxStockMasterRepo.js', () => repoMock);

import {
  assertProductionMasterUsable,
  formatProductionMasterBlockedMessage,
  getProductionMasterDecisionSnapshot,
} from './productionMasterGuard';

describe('productionMasterGuard', () => {
  beforeEach(() => {
    repoMock.getMasterSize.mockReturnValue(2500);
    repoMock.getKrxMasterMetadata.mockReturnValue({
      raw_krx_master_total: 2500,
      tradable_universe_total: 2000,
      scanner_candidate_total: 60,
    });
    repoMock.isMasterStale.mockReturnValue(false);
  });

  it('captures persisted master snapshot for decision paths', () => {
    const snapshot = getProductionMasterDecisionSnapshot('SCANNER');
    expect(snapshot).toMatchObject({
      path: 'SCANNER',
      total: 2500,
      rawMasterTotal: 2500,
      tradableUniverseTotal: 2000,
      isStale: false,
      minTotal: 2000,
      ttlHours: 24,
    });
  });

  it('allows production decision path when master is large enough and fresh', () => {
    expect(assertProductionMasterUsable('SCANNER')).toMatchObject({
      path: 'SCANNER',
      total: 2500,
      rawMasterTotal: 2500,
      tradableUniverseTotal: 2000,
      isStale: false,
    });
  });

  it('blocks scanner when persisted master is too small', () => {
    repoMock.getMasterSize.mockReturnValue(395);
    repoMock.getKrxMasterMetadata.mockReturnValue({ raw_krx_master_total: 395, tradable_universe_total: 395, scanner_candidate_total: 395 });
    expect(() => assertProductionMasterUsable('SCANNER'))
      .toThrowError('KRX_MASTER_TOO_SMALL');
  });

  it('blocks autotrade when persisted master is stale', () => {
    repoMock.isMasterStale.mockReturnValue(true);
    expect(() => assertProductionMasterUsable('AUTOTRADE'))
      .toThrowError('KRX_MASTER_TTL_EXPIRED');
  });

  it('formats SCAN_ABORTED operator message from fatal guard errors', () => {
    repoMock.getMasterSize.mockReturnValue(395);
    repoMock.getKrxMasterMetadata.mockReturnValue({ raw_krx_master_total: 395, tradable_universe_total: 395, scanner_candidate_total: 395 });
    try {
      assertProductionMasterUsable('RECOMMENDATION');
      throw new Error('expected guard to throw');
    } catch (err) {
      /* SDS-ignore: test intentionally captures the expected guard error for message assertions. */
      const msg = formatProductionMasterBlockedMessage(err);
      expect(msg).toContain('SCAN_ABORTED');
      expect(msg).toContain('KRX_MASTER_TOO_SMALL');
      expect(msg).toContain('path=RECOMMENDATION');
      expect(msg).toContain('raw=395 < 2000');
      expect(msg).toContain('scannerCandidates=395');
    }
  });
});
