/**
 * @responsibility 데이터 도메인별 시효(Freshness) 정책 및 Zero Fallback 방지 타입 정의
 */

export type DataDomain =
  | 'PRICE'
  | 'VOLUME'
  | 'SECTOR'
  | 'SUPPLY'
  | 'SHORT_SELLING'
  | 'FUNDAMENTAL'
  | 'DART_DISCLOSURE'
  | 'MACRO';

export interface FreshnessPolicy {
  maxTradingDaysOld: number;
  maxCalendarDaysOld?: number;
  requireExactTradingDate: boolean;
  downgradeIfStale: boolean;
  blockIfStale: boolean;
}

export const FRESHNESS_POLICIES: Record<DataDomain, FreshnessPolicy> = {
  PRICE: {
    maxTradingDaysOld: 0,
    requireExactTradingDate: true,
    downgradeIfStale: true,
    blockIfStale: true,
  },
  VOLUME: {
    maxTradingDaysOld: 0,
    requireExactTradingDate: true,
    downgradeIfStale: true,
    blockIfStale: true,
  },
  SECTOR: {
    maxTradingDaysOld: 0,
    requireExactTradingDate: true,
    downgradeIfStale: true,
    blockIfStale: true,
  },
  SUPPLY: {
    maxTradingDaysOld: 1,
    requireExactTradingDate: false,
    downgradeIfStale: true,
    blockIfStale: false,
  },
  SHORT_SELLING: {
    maxTradingDaysOld: 2,
    requireExactTradingDate: false,
    downgradeIfStale: true,
    blockIfStale: false,
  },
  FUNDAMENTAL: {
    maxTradingDaysOld: 70,
    requireExactTradingDate: false,
    downgradeIfStale: false,
    blockIfStale: false,
  },
  DART_DISCLOSURE: {
    maxTradingDaysOld: 30,
    requireExactTradingDate: false,
    downgradeIfStale: false,
    blockIfStale: false,
  },
  MACRO: {
    maxTradingDaysOld: 5,
    requireExactTradingDate: false,
    downgradeIfStale: true,
    blockIfStale: false,
  },
};

/**
 * 주어진 데이터 도메인에 대한 Freshness Policy를 반환합니다.
 * @param domain - 데이터 도메인
 * @returns 해당 도메인의 FreshnessPolicy
 */
export function getFreshnessPolicy(domain: DataDomain): FreshnessPolicy {
  return FRESHNESS_POLICIES[domain];
}