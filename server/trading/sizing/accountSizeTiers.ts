/**
 * @responsibility 계좌 규모별 포지션 사이징 티어 상수 SSOT — 신호 등급·리스크 비중 정의
 *
 * 변경 시 이 파일만 수정하면 전체 사이징 로직에 반영된다.
 * positionSizingEngine.ts / drawdownAdapter.ts / tierMigrationDetector.ts 가 이 파일을 import한다.
 */

// ─── 타입 ────────────────────────────────────────────────────────────────────

export type AccountTierName =
  | 'MICRO'
  | 'SMALL'
  | 'GROWTH'
  | 'BALANCED'
  | 'DEFENSIVE'
  | 'CAPITAL_PRESERVATION';

export type SignalGrade =
  | 'BUY'
  | 'STRONG_BUY'
  | 'CONFIRMED_STRONG_BUY';

export interface AccountSizeTier {
  name: AccountTierName;
  minEquity: number;
  maxEquity: number;
  /** BUY 신호 기본 비중 */
  buyPct: number;
  /** STRONG_BUY 기본 비중 */
  strongBuyPct: number;
  /** CONFIRMED_STRONG_BUY 기본 비중 */
  confirmedStrongBuyPct: number;
  /** 단일 종목 최대 비중 (하드캡) */
  maxPositionPct: number;
  /** 거래당 허용 손실률 (계좌 대비) */
  riskPerTradePct: number;
  /** 손절 시 계좌 최대 허용 손실률 */
  maxStopLossDamagePct: number;
  /** 권장 보유 종목 최소 */
  targetHoldingsMin: number;
  /** 권장 보유 종목 최대 */
  targetHoldingsMax: number;
  /** 유니버스: 최소 시가총액 (원) */
  minMarketCap: number;
  /** 유니버스: 20일 평균 거래대금 최소 (원) */
  minAvgDailyVolume: number;
  /** 유동성 사용률 임계값 1 (초과 시 0.8배) */
  liquidityWarnRatio: number;
  /** 유동성 사용률 임계값 2 (초과 시 0.5배) */
  liquidityBlockRatio: number;
  /** 실현 수익 재투자 비율 */
  profitReinvestmentRate: number;
}

// ─── SSOT 테이블 ─────────────────────────────────────────────────────────────

export const ACCOUNT_SIZE_TIERS: AccountSizeTier[] = [
  {
    name: 'MICRO',
    minEquity: 0,
    maxEquity: 5_000_000,
    buyPct: 0.12,
    strongBuyPct: 0.20,
    confirmedStrongBuyPct: 0.28,
    maxPositionPct: 0.30,
    riskPerTradePct: 0.018,
    maxStopLossDamagePct: 0.020,
    targetHoldingsMin: 3,
    targetHoldingsMax: 5,
    minMarketCap: 100_000_000_000,       // 1,000억
    minAvgDailyVolume: 3_000_000_000,    // 30억
    liquidityWarnRatio: 0.01,
    liquidityBlockRatio: 0.02,
    profitReinvestmentRate: 1.0,
  },
  {
    name: 'SMALL',
    minEquity: 5_000_000,
    maxEquity: 10_000_000,
    buyPct: 0.10,
    strongBuyPct: 0.17,
    confirmedStrongBuyPct: 0.24,
    maxPositionPct: 0.25,
    riskPerTradePct: 0.015,
    maxStopLossDamagePct: 0.017,
    targetHoldingsMin: 4,
    targetHoldingsMax: 6,
    minMarketCap: 150_000_000_000,       // 1,500억
    minAvgDailyVolume: 5_000_000_000,    // 50억
    liquidityWarnRatio: 0.01,
    liquidityBlockRatio: 0.02,
    profitReinvestmentRate: 1.0,
  },
  {
    name: 'GROWTH',
    minEquity: 10_000_000,
    maxEquity: 30_000_000,
    buyPct: 0.08,
    strongBuyPct: 0.12,
    confirmedStrongBuyPct: 0.18,
    maxPositionPct: 0.20,
    riskPerTradePct: 0.012,
    maxStopLossDamagePct: 0.015,
    targetHoldingsMin: 5,
    targetHoldingsMax: 8,
    minMarketCap: 200_000_000_000,       // 2,000억
    minAvgDailyVolume: 7_000_000_000,    // 70억
    liquidityWarnRatio: 0.005,
    liquidityBlockRatio: 0.01,
    profitReinvestmentRate: 0.9,
  },
  {
    name: 'BALANCED',
    minEquity: 30_000_000,
    maxEquity: 100_000_000,
    buyPct: 0.06,
    strongBuyPct: 0.10,
    confirmedStrongBuyPct: 0.14,
    maxPositionPct: 0.15,
    riskPerTradePct: 0.010,
    maxStopLossDamagePct: 0.012,
    targetHoldingsMin: 7,
    targetHoldingsMax: 10,
    minMarketCap: 300_000_000_000,       // 3,000억
    minAvgDailyVolume: 10_000_000_000,   // 100억
    liquidityWarnRatio: 0.005,
    liquidityBlockRatio: 0.01,
    profitReinvestmentRate: 0.8,
  },
  {
    name: 'DEFENSIVE',
    minEquity: 100_000_000,
    maxEquity: 300_000_000,
    buyPct: 0.04,
    strongBuyPct: 0.07,
    confirmedStrongBuyPct: 0.10,
    maxPositionPct: 0.12,
    riskPerTradePct: 0.007,
    maxStopLossDamagePct: 0.010,
    targetHoldingsMin: 10,
    targetHoldingsMax: 15,
    minMarketCap: 500_000_000_000,       // 5,000억
    minAvgDailyVolume: 20_000_000_000,   // 200억
    liquidityWarnRatio: 0.003,
    liquidityBlockRatio: 0.005,
    profitReinvestmentRate: 0.7,
  },
  {
    name: 'CAPITAL_PRESERVATION',
    minEquity: 300_000_000,
    maxEquity: Infinity,
    buyPct: 0.03,
    strongBuyPct: 0.05,
    confirmedStrongBuyPct: 0.07,
    maxPositionPct: 0.08,
    riskPerTradePct: 0.005,
    maxStopLossDamagePct: 0.007,
    targetHoldingsMin: 12,
    targetHoldingsMax: 20,
    minMarketCap: 1_000_000_000_000,     // 1조
    minAvgDailyVolume: 50_000_000_000,   // 500억
    liquidityWarnRatio: 0.003,
    liquidityBlockRatio: 0.005,
    profitReinvestmentRate: 0.5,
  },
];

/** 티어 경계값 (마이그레이션 이벤트 트리거) */
export const TIER_THRESHOLDS = [
  5_000_000,
  10_000_000,
  30_000_000,
  100_000_000,
  300_000_000,
] as const;

// ─── 유틸리티 ────────────────────────────────────────────────────────────────

/** 계좌 총액으로 티어를 조회한다. */
export function getAccountSizeTier(equity: number): AccountSizeTier {
  const tier = ACCOUNT_SIZE_TIERS.find(
    (t) => equity >= t.minEquity && equity < t.maxEquity,
  );
  // Infinity 경계 처리 — CAPITAL_PRESERVATION 폴백
  return tier ?? ACCOUNT_SIZE_TIERS[ACCOUNT_SIZE_TIERS.length - 1];
}

/** 신호 등급으로 기본 비중을 가져온다. */
export function getBasePositionPct(
  tier: AccountSizeTier,
  grade: SignalGrade,
): number {
  switch (grade) {
    case 'CONFIRMED_STRONG_BUY': return tier.confirmedStrongBuyPct;
    case 'STRONG_BUY':           return tier.strongBuyPct;
    case 'BUY':                  return tier.buyPct;
  }
}

/** 티어 레이블 (한글) */
export function getTierLabel(name: AccountTierName): string {
  const LABELS: Record<AccountTierName, string> = {
    MICRO:                '집중 성장 계좌',
    SMALL:                '공격적 성장 계좌',
    GROWTH:               '균형 성장 계좌',
    BALANCED:             '안정 성장 계좌',
    DEFENSIVE:            '방어적 복리 계좌',
    CAPITAL_PRESERVATION: '자산 보존 계좌',
  };
  return LABELS[name];
}
