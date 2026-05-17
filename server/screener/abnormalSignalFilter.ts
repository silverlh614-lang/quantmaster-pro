/**
 * @responsibility Screener abnormal signal evaluation
 */

import type { AbnormalSignalRecord, QuantFilterRecord, ScreenerConfig, ScreenerDataPoint } from './quantScreenerTypes.js';
import { QuantScreenerReason } from './quantScreenerTypes.js';
import { classifyProviderSignalState } from './screenerProviderSignalSplit.js';

function numericValue(point: ScreenerDataPoint<number> | undefined): number | null {
  return typeof point?.value === 'number' && Number.isFinite(point.value) ? point.value : null;
}

function verifiedNumber(point: ScreenerDataPoint<number> | undefined): number | null {
  return point?.confidence === 'VERIFIED' ? numericValue(point) : null;
}

function verifiedBoolean(point: ScreenerDataPoint<boolean> | undefined): boolean | null {
  return point?.confidence === 'VERIFIED' && typeof point.value === 'boolean' ? point.value : null;
}

export function applyAbnormalSignalFilter(records: QuantFilterRecord[], config: ScreenerConfig): AbnormalSignalRecord[] {
  return records.filter((record) => record.passedQuantFilter).map((record) => evaluateAbnormalSignalFilter(record, config));
}

export function evaluateAbnormalSignalFilter(record: QuantFilterRecord, config: ScreenerConfig): AbnormalSignalRecord {
  const reasons = [...record.reasons];
  const risks = [...record.risks];
  const missingData = [...record.missingData];
  const item = record.item;
  let abnormalSignalScore = 0;
  let marketSignal = false;

  const volume = verifiedNumber(item.volume);
  const avgVolume20d = verifiedNumber(item.avgVolume20d);
  if (volume !== null && avgVolume20d !== null && avgVolume20d > 0) {
    if (volume / avgVolume20d >= config.volumeSpikeRatio) {
      reasons.push(QuantScreenerReason.PassVolumeSpike);
      abnormalSignalScore += 35;
      marketSignal = true;
    }
  } else {
    missingData.push(volume === null ? 'volume' : 'avgVolume20d');
  }

  const close = verifiedNumber(item.latestClose);
  const high52w = verifiedNumber(item.high52w);
  if (close !== null && high52w !== null && high52w > 0) {
    if (close >= high52w * config.nearHigh52wRatio) {
      reasons.push(QuantScreenerReason.PassNear52wHigh);
      abnormalSignalScore += 30;
      marketSignal = true;
    }
  } else {
    missingData.push(high52w === null ? 'high52w' : 'latestClose');
  }

  const flow = verifiedBoolean(item.institutionForeignNetBuy3d);
  if (flow === true) {
    reasons.push(QuantScreenerReason.PassInstitutionForeignFlow);
    abnormalSignalScore += 20;
    marketSignal = true;
  } else if (flow === null) {
    reasons.push(QuantScreenerReason.PendingInstitutionForeignFlow);
    missingData.push('institutionForeignNetBuy3d');
  }

  const relativeStrengthPct = verifiedNumber(item.relativeStrengthPct);
  if (relativeStrengthPct !== null) {
    if (config.minRelativeStrengthPct === undefined || relativeStrengthPct >= config.minRelativeStrengthPct) {
      reasons.push(QuantScreenerReason.PassRelativeStrength);
      abnormalSignalScore += 15;
      marketSignal = true;
    }
  } else {
    reasons.push(QuantScreenerReason.PendingRelativeStrength);
    missingData.push('relativeStrengthPct');
  }

  const ma20 = verifiedNumber(item.ma20);
  if (close !== null && ma20 !== null && ma20 > 0 && config.maxDistanceFromMa20Pct !== undefined) {
    const distancePct = ((close - ma20) / ma20) * 100;
    if (distancePct > config.maxDistanceFromMa20Pct) {
      reasons.push(QuantScreenerReason.RejectTooExtendedFromMa20);
      risks.push(`close is ${distancePct.toFixed(1)}% above ma20`);
      abnormalSignalScore = Math.max(0, abnormalSignalScore - 20);
    }
  } else if (ma20 === null) {
    missingData.push('ma20');
  }

  if (verifiedBoolean(item.volatilityContraction) === null) {
    reasons.push(QuantScreenerReason.PendingVcp);
    missingData.push('volatilityContraction');
  }

  const uniqueReasons = [...new Set(reasons)];
  const uniqueMissing = [...new Set(missingData)];
  const hardRejected = uniqueReasons.includes(QuantScreenerReason.RejectTooExtendedFromMa20);
  const passedAbnormalSignalFilter = marketSignal && !hardRejected;
  if (!passedAbnormalSignalFilter && !uniqueReasons.includes(QuantScreenerReason.RejectNoAbnormalSignal)) {
    uniqueReasons.push(QuantScreenerReason.RejectNoAbnormalSignal);
  }

  const providerIssue = record.providerIssue || uniqueMissing.length > record.missingData.length;
  const signalState = classifyProviderSignalState({ providerIssue, marketSignal });
  if (signalState === 'MIXED') risks.push('MIXED_PROVIDER_ISSUE_MARKET_SIGNAL');
  const addedMissingCount = Math.max(0, uniqueMissing.length - record.missingData.length);
  return {
    ...record,
    reasons: uniqueReasons,
    risks,
    missingData: uniqueMissing,
    dataConfidence: { ...record.dataConfidence, missing: record.dataConfidence.missing + addedMissingCount },
    providerIssue,
    passedAbnormalSignalFilter,
    abnormalSignalScore: Math.min(100, abnormalSignalScore),
    marketSignal: marketSignal && !providerIssue,
    signalState,
  };
}
