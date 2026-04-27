// @responsibility demoData 모듈
import type {
  MarketRegime, SectorRotation, EuphoriaSignal, EmergencyStopSignal,
  StockProfile,
} from '../types/quant';

export const DEMO_REGIME: MarketRegime = {
  type: '상승초기',
  weightMultipliers: { 1: 3.0, 2: 2.5, 3: 2.0 },
  vKospi: 15.5,
  samsungIri: 0.85,
};

export const DEMO_SECTOR_ROTATION: SectorRotation = {
  name: '반도체',
  rank: 1,
  strength: 85,
  isLeading: true,
  sectorLeaderNewHigh: false,
  leadingSectors: ['반도체', 'AI'],
};

export const DEMO_EUPHORIA: EuphoriaSignal = {
  id: 'E1',
  name: '과열 신호',
  active: false,
};

export const DEMO_EMERGENCY: EmergencyStopSignal = {
  id: 'S1',
  name: '긴급 중단',
  triggered: false,
};

export const DEMO_PROFILE: StockProfile = {
  type: 'A',
  monitoringCycle: 'DAILY',
  stopLoss: 7,
  executionDelay: 0,
};

// 데모용 데이터 (실제 데이터는 API로 대체 예정)
export const DEMO_STOCK_DATA: Record<number, number> = {
  1: 9, 3: 8, 5: 9, 7: 10, 9: 8, // Gate 1
  2: 7, 4: 8, 6: 9, 8: 7, 10: 8, // Gate 2
  11: 9, 13: 8, 15: 7, 17: 9, 19: 8, // Gate 3
  21: 9, 23: 8, 25: 7, 27: 9, // Others
};
