/**
 * @responsibility EnemyCheckResult 자동 차단 정책 평가 SSOT (ADR-0078)
 *
 * `enemyCheckClient.ts` 가 수집한 신용잔고율 + 개인 비중 데이터를 기반으로 매수
 * 자동 차단 여부를 결정한다. `buyPipeline.ts` 가 매수 직전 1회 호출 — 차단 시
 * `requestBuyApproval` 발송 자체를 막고 `markBlocked('ENEMY')` 영속화한다.
 *
 * 임계값 SSOT (보수적 default, ENV 오버라이드 가능):
 *   creditRate ≥ 12% → BLOCK (표시 ⚠️⚠️ 8% 보다 4% 마진)
 *   individualDominance ≥ 88% → BLOCK (표시 ⚠️⚠️ 80% 보다 8% 마진)
 *
 * 데이터 부재 (`source === 'UNAVAILABLE'` 또는 `null`) → shouldBlock=false 안전
 * fallback. KIS 일시 장애가 매매 차단 안 함.
 *
 * `ENEMY_AUTO_BLOCK_DISABLED=true` 시 평가 skip — 비상 우회 회로.
 */

import type { EnemyCheckResult } from '../clients/enemyCheckClient.js';

export interface EnemyAutoBlockThresholds {
  creditRateBlock: number;
  creditRateWarn: number;
  individualBlock: number;
  individualWarn: number;
  shortSaleIncreaseWarn: number;
  loanIncreaseWarn: number;
  creditIncreaseWarn: number;
}

export interface EnemyAutoBlockDecision {
  shouldBlock: boolean;
  /** BLOCK 임계 위반 사유 ('/' 결합) — `markBlocked` reason 으로 사용 */
  reason: string;
  /** BLOCK 미달이지만 WARN 통과한 항목 — 운영자 인지용 */
  warnings: string[];
  thresholds: EnemyAutoBlockThresholds;
  /** disabled ENV 또는 데이터 부재 시 skipReason 부여 (진단용) */
  skipReason?: 'DISABLED' | 'NO_DATA';
  strongBuyAllowed: boolean;
  shadowOnlyRecommended: boolean;
  riskSignalCount: number;
}

const DEFAULTS: EnemyAutoBlockThresholds = {
  creditRateBlock: 12.0,
  creditRateWarn: 8.0,
  individualBlock: 88.0,
  individualWarn: 80.0,
  shortSaleIncreaseWarn: 30.0,
  loanIncreaseWarn: 30.0,
  creditIncreaseWarn: 30.0,
};

function parsePosNumberEnv(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function getDefaultEnemyThresholds(): EnemyAutoBlockThresholds {
  return {
    creditRateBlock: parsePosNumberEnv(process.env.ENEMY_CREDIT_RATE_BLOCK, DEFAULTS.creditRateBlock),
    creditRateWarn: parsePosNumberEnv(process.env.ENEMY_CREDIT_RATE_WARN, DEFAULTS.creditRateWarn),
    individualBlock: parsePosNumberEnv(process.env.ENEMY_INDIVIDUAL_BLOCK, DEFAULTS.individualBlock),
    individualWarn: parsePosNumberEnv(process.env.ENEMY_INDIVIDUAL_WARN, DEFAULTS.individualWarn),
    shortSaleIncreaseWarn: parsePosNumberEnv(process.env.ENEMY_SHORT_SALE_INCREASE_WARN, DEFAULTS.shortSaleIncreaseWarn),
    loanIncreaseWarn: parsePosNumberEnv(process.env.ENEMY_LOAN_INCREASE_WARN, DEFAULTS.loanIncreaseWarn),
    creditIncreaseWarn: parsePosNumberEnv(process.env.ENEMY_CREDIT_INCREASE_WARN, DEFAULTS.creditIncreaseWarn),
  };
}

export function isEnemyAutoBlockDisabled(): boolean {
  return process.env.ENEMY_AUTO_BLOCK_DISABLED === 'true';
}

export const ENEMY_AUTO_BLOCK_DEFAULTS = DEFAULTS;

/**
 * EnemyCheckResult 를 자동 차단 결정으로 변환한다.
 *
 * @param enemy `fetchEnemyCheckData()` 결과. null 또는 UNAVAILABLE 시 shouldBlock=false.
 * @param thresholds 임계 override. 미전달 시 ENV 기반 기본값 사용.
 */
export function evaluateEnemyAutoBlock(
  enemy: EnemyCheckResult | null,
  thresholds: EnemyAutoBlockThresholds = getDefaultEnemyThresholds(),
): EnemyAutoBlockDecision {
  if (isEnemyAutoBlockDisabled()) {
    return {
      shouldBlock: false,
      reason: '',
      warnings: [],
      thresholds,
      skipReason: 'DISABLED',
      strongBuyAllowed: true,
      shadowOnlyRecommended: false,
      riskSignalCount: 0,
    };
  }

  if (!enemy || enemy.source === 'UNAVAILABLE') {
    return {
      shouldBlock: false,
      reason: '',
      warnings: [],
      thresholds,
      skipReason: 'NO_DATA',
      strongBuyAllowed: true,
      shadowOnlyRecommended: false,
      riskSignalCount: 0,
    };
  }

  const reasons: string[] = [];
  const warnings: string[] = [];
  let riskSignalCount = 0;

  if (enemy.creditRate !== null && Number.isFinite(enemy.creditRate)) {
    if (enemy.creditRate >= thresholds.creditRateBlock) {
      reasons.push(
        `신용잔고율 ${enemy.creditRate.toFixed(1)}% ≥ ${thresholds.creditRateBlock.toFixed(1)}%`,
      );
    } else if (enemy.creditRate >= thresholds.creditRateWarn) {
      warnings.push(`신용잔고율 ${enemy.creditRate.toFixed(1)}%`);
    }
  }

  if (enemy.individualDominance !== null && Number.isFinite(enemy.individualDominance)) {
    if (enemy.individualDominance >= thresholds.individualBlock) {
      reasons.push(
        `개인 비중 ${enemy.individualDominance.toFixed(0)}% ≥ ${thresholds.individualBlock.toFixed(0)}%`,
      );
    } else if (enemy.individualDominance >= thresholds.individualWarn) {
      warnings.push(`개인 비중 ${enemy.individualDominance.toFixed(0)}%`);
    }
  }

  if (enemy.shortSaleIncreaseRate !== null && enemy.shortSaleIncreaseRate !== undefined && Number.isFinite(enemy.shortSaleIncreaseRate)) {
    if (enemy.shortSaleIncreaseRate >= thresholds.shortSaleIncreaseWarn) {
      warnings.push(`공매도 ${enemy.shortSaleIncreaseRate.toFixed(1)}% 증가`);
      riskSignalCount++;
    }
  }

  if (enemy.loanIncreaseRate !== null && enemy.loanIncreaseRate !== undefined && Number.isFinite(enemy.loanIncreaseRate)) {
    if (enemy.loanIncreaseRate >= thresholds.loanIncreaseWarn) {
      warnings.push(`대차잔고 ${enemy.loanIncreaseRate.toFixed(1)}% 증가`);
      riskSignalCount++;
    }
  }

  if (enemy.creditIncreaseRate !== null && enemy.creditIncreaseRate !== undefined && Number.isFinite(enemy.creditIncreaseRate)) {
    if (enemy.creditIncreaseRate >= thresholds.creditIncreaseWarn) {
      warnings.push(`신용잔고 ${enemy.creditIncreaseRate.toFixed(1)}% 증가`);
      riskSignalCount++;
    }
  }

  if (riskSignalCount >= 3) {
    reasons.push('공매도/대차/신용 3개 위험 신호');
  }

  return {
    shouldBlock: reasons.length > 0,
    reason: reasons.join(' / '),
    warnings,
    thresholds,
    strongBuyAllowed: riskSignalCount < 2,
    shadowOnlyRecommended: riskSignalCount >= 3,
    riskSignalCount,
  };
}
