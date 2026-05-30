/**
 * @responsibility ADR-0545 sectorEnergyVerifiedSnapshotRepo write/read·우선순위·실패미저장 회귀 테스트
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  writeSectorEnergyVerifiedSnapshot,
  readLatestSectorEnergyVerifiedSnapshot,
  readSectorEnergyVerifiedSnapshotForTradeDate,
  readLastKnownSectorEnergyVerifiedSnapshot,
  __resetSectorEnergyVerifiedSnapshotForTests,
  type SectorEnergyVerifiedSnapshotRecord,
} from './sectorEnergyVerifiedSnapshotRepo.js';

function rec(over: Partial<SectorEnergyVerifiedSnapshotRecord> = {}): SectorEnergyVerifiedSnapshotRecord {
  return {
    snapshotId: 'sector-verified:2026-05-29:2026-05-29T05:00:00.000Z',
    asOf: '2026-05-29T05:00:00.000Z',
    tradeDate: '2026-05-29',
    verifiedOfficialSectorCount: 11,
    promotionCoverage: 1,
    selectedSourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
    ...over,
  };
}

describe('sectorEnergyVerifiedSnapshotRepo (ADR-0545)', () => {
  beforeEach(() => __resetSectorEnergyVerifiedSnapshotForTests());
  afterEach(() => __resetSectorEnergyVerifiedSnapshotForTests());

  it('빈 상태에서 read 는 null', () => {
    expect(readLatestSectorEnergyVerifiedSnapshot()).toBeNull();
    expect(readSectorEnergyVerifiedSnapshotForTradeDate('2026-05-29')).toBeNull();
  });

  it('verify 성공(verified>0) write → tradeDate 로 read', () => {
    writeSectorEnergyVerifiedSnapshot(rec());
    const got = readSectorEnergyVerifiedSnapshotForTradeDate('2026-05-29');
    expect(got?.verifiedOfficialSectorCount).toBe(11);
    expect(got?.selectedSourceTier).toBe('OFFICIAL_KIS_SECTOR_INDEX');
  });

  it('verified<=0 이면 write 미저장 (실패·휴일 보장)', () => {
    writeSectorEnergyVerifiedSnapshot(rec({ verifiedOfficialSectorCount: 0 }));
    expect(readLatestSectorEnergyVerifiedSnapshot()).toBeNull();
  });

  it('잘못된 tradeDate 형식은 write 미저장', () => {
    writeSectorEnergyVerifiedSnapshot(rec({ tradeDate: 'not-a-date' }));
    expect(readLatestSectorEnergyVerifiedSnapshot()).toBeNull();
  });

  it('동일 tradeDate upsert — 마지막 verify 가 이긴다', () => {
    writeSectorEnergyVerifiedSnapshot(rec({ verifiedOfficialSectorCount: 9, promotionCoverage: 9 / 11 }));
    writeSectorEnergyVerifiedSnapshot(rec({ verifiedOfficialSectorCount: 11, promotionCoverage: 1 }));
    expect(readSectorEnergyVerifiedSnapshotForTradeDate('2026-05-29')?.verifiedOfficialSectorCount).toBe(11);
  });

  it('read 우선순위: same tradeDate intraday > prev EOD', () => {
    writeSectorEnergyVerifiedSnapshot(rec({ tradeDate: '2026-05-28', verifiedOfficialSectorCount: 8 }));
    writeSectorEnergyVerifiedSnapshot(rec({ tradeDate: '2026-05-29', verifiedOfficialSectorCount: 11 }));
    const sameDay = readLastKnownSectorEnergyVerifiedSnapshot({ tradeDate: '2026-05-29', prevTradingDay: '2026-05-28' });
    expect(sameDay?.tradeDate).toBe('2026-05-29');
  });

  it('read 우선순위: same 없으면 prev trading day EOD', () => {
    writeSectorEnergyVerifiedSnapshot(rec({ tradeDate: '2026-05-29', verifiedOfficialSectorCount: 11 }));
    // 휴일 today=2026-05-30, prev trading day = 2026-05-29
    const prev = readLastKnownSectorEnergyVerifiedSnapshot({ tradeDate: '2026-05-30', prevTradingDay: '2026-05-29' });
    expect(prev?.tradeDate).toBe('2026-05-29');
  });

  it('read 우선순위: prev 정확 일치 없으면 그 이하 가장 최근 EOD fallback', () => {
    writeSectorEnergyVerifiedSnapshot(rec({ tradeDate: '2026-05-27', verifiedOfficialSectorCount: 10 }));
    const got = readLastKnownSectorEnergyVerifiedSnapshot({ tradeDate: '2026-05-30', prevTradingDay: '2026-05-29' });
    expect(got?.tradeDate).toBe('2026-05-27');
  });

  it('아무 snapshot 없으면 last-known read 는 null (부재)', () => {
    expect(readLastKnownSectorEnergyVerifiedSnapshot({ tradeDate: '2026-05-30', prevTradingDay: '2026-05-29' })).toBeNull();
  });
});
