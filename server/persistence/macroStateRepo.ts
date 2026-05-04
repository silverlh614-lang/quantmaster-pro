// @responsibility macroStateRepo 영속화 저장소 모듈
import fs from 'fs';
import { MACRO_STATE_FILE, ensureDataDir } from './paths.js';
import type { SectorEnergyResult } from '../../src/types/sectorEnergy.js';
import type { FssRecordsAgeInfo } from './fssRepo.js';

export interface MacroState {
  mhs: number;        // Macro Health Score (0~100)
  regime: string;     // 'GREEN' | 'YELLOW' | 'RED'
  updatedAt: string;  // ISO
  vkospi?: number;
  foreignFuturesSellDays?: number;
  iri?: number;
  vix?: number;
  mhsTrend?: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
  vkospiRising?: boolean;
  bearRegimeTriggeredCount?: number;
  bearDefenseMode?: boolean;
  oeciCliKorea?: number;
  exportGrowth3mAvg?: number;
  dxyBullish?: boolean;
  kospiBelow120ma?: boolean;
  ips?: number;
  fss?: number;
  fssAlertLevel?: 'NORMAL' | 'CAUTION' | 'HIGH_ALERT';
  vkospiDayChange?: number;
  vkospi5dTrend?: number;
  usdKrw?: number;
  usdKrw20dChange?: number;
  usdKrwDayChange?: number;
  usdKrwSource?: 'PRIMARY' | 'SECONDARY' | null;
  usdKrwDivergencePct?: number | null;
  usdKrwDivergenceTier?: string;
  foreignNetBuy5d?: number;
  passiveActiveBoth?: boolean | null;
  fssRecordsAge?: FssRecordsAgeInfo;
  fssDetailFetchedAt?: string;
  fssDetailSource?: 'KRX_BLD' | 'NONE';
  programNetBuyAmount?: number;
  programArbitrageNetBuy?: number | null;
  programFetchedAt?: string;
  programSource?: 'KIS_API' | 'NONE';
  kospiAbove20MA?: boolean;
  kospiAbove60MA?: boolean;
  kospi20dReturn?: number;
  kospiDayReturn?: number;
  leadingSectorRS?: number;
  sectorCycleStage?: 'EARLY' | 'MID' | 'LATE' | 'TURNING';
  marginBalance5dChange?: number;
  marginBalanceFetchedAt?: string;
  marginBalanceSource?: 'ECOS_API' | 'NONE';
  shortSellingRatio?: number;
  /** Phase 1 — 어느 fallback 단계에서 데이터를 얻었는지. CACHE 는 수동/영속 backfill 경로. */
  shortSellingSource?: 'KRX_DIRECT' | 'KRX_OTP' | 'KIS_ESTIMATE' | 'CACHE';
  shortSellingFetchedAt?: string;
  spx20dReturn?: number;
  dxy5dChange?: number;
  vixHistory?: number[];
  ewyDayChange?: number;
  yieldCurve10y2y?: number;
  hySpread?: number;
  sofr?: number;
  financialStress?: number;
  wtiCrude?: number;
  kospiAboveMA20Pct?: number;
  foreignContinuousBuyDays?: number;
  sectorEnergyResult?: SectorEnergyResult;
  sectorEnergyUpdatedAt?: string;
  sectorEnergyDataQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED';
  sectorEnergyValidSectorCount?: number;
  sectorEnergyReasons?: string[];
  mhsAxis?: {
    interestRate: number;
    liquidity: number;
    economy: number;
    risk: number;
  };
  mhsAxisUpdatedAt?: string;
}

export function loadMacroState(): MacroState | null {
  ensureDataDir();
  if (!fs.existsSync(MACRO_STATE_FILE)) {
    const defaultState: MacroState = {
      mhs: 50,
      regime: 'R4_NEUTRAL',
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(MACRO_STATE_FILE, JSON.stringify(defaultState, null, 2));
    return defaultState;
  }
  try { return JSON.parse(fs.readFileSync(MACRO_STATE_FILE, 'utf-8')); } catch { return null; }
}

export function saveMacroState(state: MacroState): void {
  ensureDataDir();
  fs.writeFileSync(MACRO_STATE_FILE, JSON.stringify(state, null, 2));
}
