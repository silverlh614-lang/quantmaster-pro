/**
 * @responsibility 유동성 사용률·섹터 노출도 기반 포지션 비중 감쇄 — 대형 계좌 시장 충격 방어
 *
 * getLiquidityMultiplier: 예상 매수금액이 20일 평균 거래대금 대비 비율로 감쇄
 * getSectorExposureMultiplier: 섹터 집중도를 이진 차단 대신 연속 감쇄 함수로 처리
 */

import type { AccountTierName } from './accountSizeTiers.js';

// ─── 유동성 프리미엄 조정 ────────────────────────────────────────────────────

export interface LiquidityResult {
  multiplier: number;
  usageRatio: number;
  blocked: boolean;
  reason?: string;
}

/**
 * 예상 매수금액과 20일 평균 거래대금으로 유동성 배수를 계산한다.
 *
 * @param tierName           계좌 티어
 * @param intendedAmount     매수 예정 금액 (원)
 * @param avgDailyVolume20d  20일 평균 거래대금 (원) — 0이면 유동성 미확인으로 0.8 적용
 */
export function getLiquidityMultiplier(
  tierName: AccountTierName,
  intendedAmount: number,
  avgDailyVolume20d: number,
): LiquidityResult {
  if (avgDailyVolume20d <= 0) {
    return {
      multiplier: 0.8,
      usageRatio: 0,
      blocked: false,
      reason: '20일 평균 거래대금 미확인 — 보수적 0.8 적용',
    };
  }

  const usageRatio = intendedAmount / avgDailyVolume20d;

  // 티어별 임계값
  const thresholds = getTierLiquidityThresholds(tierName);

  if (usageRatio > thresholds.block) {
    return {
      multiplier: 0.5,
      usageRatio,
      blocked: false,
      reason: `유동성 사용률 ${(usageRatio * 100).toFixed(2)}% — 강한 감액 (0.5)`,
    };
  }
  if (usageRatio > thresholds.warn) {
    return {
      multiplier: 0.8,
      usageRatio,
      blocked: false,
      reason: `유동성 사용률 ${(usageRatio * 100).toFixed(2)}% — 주의 감액 (0.8)`,
    };
  }

  return { multiplier: 1.0, usageRatio, blocked: false };
}

function getTierLiquidityThresholds(tierName: AccountTierName) {
  switch (tierName) {
    case 'MICRO':
    case 'SMALL':
      return { warn: 0.01, block: 0.02 };
    case 'GROWTH':
    case 'BALANCED':
      return { warn: 0.005, block: 0.01 };
    case 'DEFENSIVE':
    case 'CAPITAL_PRESERVATION':
      return { warn: 0.003, block: 0.005 };
  }
}

// ─── 섹터 노출도 연속 감쇄 ──────────────────────────────────────────────────

export interface SectorExposureResult {
  multiplier: number;
  blocked: boolean;
  currentSectorWeight: number;
  reason?: string;
}

/**
 * 섹터 집중도를 이진 차단 대신 선형 감쇄로 처리한다.
 *
 * warningZone(= maxSectorWeight × 0.5)까지는 감액 없음.
 * warningZone을 초과하면 maxSectorWeight까지 선형 감쇄하여 0에 수렴.
 *
 * @param currentSectorWeight  현재 해당 섹터 포트폴리오 비중 (0~1)
 * @param maxSectorWeight      최대 허용 섹터 비중 (기본 0.30)
 */
export function getSectorExposureMultiplier(
  currentSectorWeight: number,
  maxSectorWeight: number = 0.30,
): SectorExposureResult {
  const warningZone = maxSectorWeight * 0.5;

  if (currentSectorWeight >= maxSectorWeight) {
    return {
      multiplier: 0,
      blocked: true,
      currentSectorWeight,
      reason: `섹터 집중도 ${(currentSectorWeight * 100).toFixed(1)}% ≥ 상한 ${(maxSectorWeight * 100).toFixed(0)}% — 진입 차단`,
    };
  }

  if (currentSectorWeight <= warningZone) {
    return { multiplier: 1.0, blocked: false, currentSectorWeight };
  }

  // 선형 감쇄: warningZone → 1.0, maxSectorWeight → 0.0
  const excessRatio =
    (currentSectorWeight - warningZone) / (maxSectorWeight - warningZone);
  const multiplier = Math.max(0, 1.0 - excessRatio);

  return {
    multiplier,
    blocked: false,
    currentSectorWeight,
    reason: `섹터 노출 ${(currentSectorWeight * 100).toFixed(1)}% — 감쇄 적용 (×${multiplier.toFixed(2)})`,
  };
}

/**
 * 유동성 Universe 최소 기준을 통과하는지 확인한다.
 */
export function checkUniverseEligibility(params: {
  tierName: AccountTierName;
  marketCap: number;
  avgDailyVolume20d: number;
  isAdminStock: boolean;      // 관리종목 여부
  isInvestmentWarning: boolean; // 투자경고 여부
}): { eligible: boolean; reason?: string } {
  if (params.isAdminStock) {
    return { eligible: false, reason: '관리종목 — 진입 불가' };
  }
  if (params.isInvestmentWarning) {
    return { eligible: false, reason: '투자경고 종목 — 진입 불가' };
  }

  const CAPS: Record<AccountTierName, number> = {
    MICRO: 100_000_000_000,
    SMALL: 150_000_000_000,
    GROWTH: 200_000_000_000,
    BALANCED: 300_000_000_000,
    DEFENSIVE: 500_000_000_000,
    CAPITAL_PRESERVATION: 1_000_000_000_000,
  };

  const VOLUMES: Record<AccountTierName, number> = {
    MICRO: 3_000_000_000,
    SMALL: 5_000_000_000,
    GROWTH: 7_000_000_000,
    BALANCED: 10_000_000_000,
    DEFENSIVE: 20_000_000_000,
    CAPITAL_PRESERVATION: 50_000_000_000,
  };

  const minCap = CAPS[params.tierName];
  const minVol = VOLUMES[params.tierName];

  if (params.marketCap < minCap) {
    return {
      eligible: false,
      reason: `시가총액 ${(params.marketCap / 1e8).toFixed(0)}억 < 최소 ${(minCap / 1e8).toFixed(0)}억`,
    };
  }
  if (params.avgDailyVolume20d < minVol) {
    return {
      eligible: false,
      reason: `20일 평균 거래대금 ${(params.avgDailyVolume20d / 1e8).toFixed(0)}억 < 최소 ${(minVol / 1e8).toFixed(0)}억`,
    };
  }

  return { eligible: true };
}
