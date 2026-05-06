import { TradingContext } from '../context/tradingContext';
import { DataDomain, getFreshnessPolicy } from '../context/freshnessPolicy';
// 실제 경로에 맞춰 수정이 필요할 수 있습니다.
import { MetricValue } from '../types/metricValue';

export type SignalDecision = 
  | 'STRONG_BUY'
  | 'BUY'
  | 'HOLD'
  | 'SELL'
  | 'STRONG_SELL'
  | 'NO_DECISION';

export interface SignalResult {
  decision: SignalDecision;
  reason?: string;
  downgraded?: boolean;
}

/**
 * 수집된 지표들의 기준일(asOfDate)이 정책(FreshnessPolicy)에 부합하는지 평가합니다.
 */
export function evaluateBaselineAlignment(
  metrics: Partial<Record<DataDomain, MetricValue<any>>>,
  context: TradingContext
): { isAligned: boolean; shouldDowngrade: boolean; shouldBlock: boolean; reason?: string } {
  let shouldDowngrade = false;
  let shouldBlock = false;
  const reasons: string[] = [];

  for (const [domainStr, metric] of Object.entries(metrics)) {
    if (!metric) continue;
    
    const domain = domainStr as DataDomain;
    
    if (metric.status !== 'OK') {
      // 주요 지표가 누락된 경우 판단을 보류(Block)합니다.
      shouldBlock = true;
      reasons.push(`${domain} data is missing (${metric.reason}).`);
      continue;
    }

    const policy = getFreshnessPolicy(domain);
    const asOfDate = metric.asOfDate;
    
    if (!asOfDate) {
      shouldBlock = true;
      reasons.push(`${domain} data has no asOfDate.`);
      continue;
    }

    // 정책에 따라 엄격한 당일 일치를 요구하는 경우 (예: PRICE, VOLUME, SECTOR)
    if (policy.requireExactTradingDate && asOfDate !== context.effectiveTradingDate) {
      if (policy.blockIfStale) shouldBlock = true;
      if (policy.downgradeIfStale) shouldDowngrade = true;
      reasons.push(`${domain} requires exact trading date ${context.effectiveTradingDate} but got ${asOfDate}.`);
    } 
    // 엄격히 요구하진 않으나 지연된 데이터인 경우 (예: SUPPLY, MACRO)
    // (참고: 실제 구현에서는 최대 허용 거래일(maxTradingDaysOld)을 정밀 계산하는 달력 유틸리티 연동 필요)
    else if (asOfDate !== context.effectiveTradingDate) {
      if (policy.blockIfStale) {
        shouldBlock = true;
        reasons.push(`${domain} is too stale (asOfDate: ${asOfDate}), blocking signal.`);
      } else if (policy.downgradeIfStale) {
        shouldDowngrade = true;
        reasons.push(`${domain} is delayed (asOfDate: ${asOfDate}), causing downgrade.`);
      }
    }
  }

  return {
    isAligned: !shouldBlock && !shouldDowngrade,
    shouldDowngrade,
    shouldBlock,
    reason: reasons.length > 0 ? reasons.join(' | ') : undefined
  };
}

/**
 * 평가된 지표의 Baseline 상태에 따라 원본 신호를 강등하거나 보류합니다.
 */
export function adjustSignalWithBaselineAlignment(
  baseSignal: SignalDecision,
  metrics: Partial<Record<DataDomain, MetricValue<any>>>,
  context: TradingContext
): SignalResult {
  const alignment = evaluateBaselineAlignment(metrics, context);

  if (alignment.shouldBlock) return { decision: 'NO_DECISION', reason: `DATA_BASELINE_MISMATCH: ${alignment.reason}` };
  if (alignment.shouldDowngrade && baseSignal === 'STRONG_BUY') return { decision: 'BUY', reason: alignment.reason, downgraded: true };
  if (alignment.shouldDowngrade && baseSignal === 'STRONG_SELL') return { decision: 'SELL', reason: alignment.reason, downgraded: true };
  return { decision: baseSignal };
}