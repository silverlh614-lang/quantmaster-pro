// @responsibility Attribution record outcome default writer used before persistence.
import type { AttributionOutcomeStatus } from '../learning/attributionEvidenceTypes.js';
import type { TradeOutcome } from '../trading/canonicalTradeOutcomeResolver.js';
import type { ServerAttributionRecord } from './attributionRepo.js';

function inferCanonicalOutcomeFromReturn(record: ServerAttributionRecord): TradeOutcome {
  if (!Number.isFinite(record.returnPct)) return 'INVALID';
  if (Math.abs(record.returnPct) <= 0.2) return 'BREAKEVEN';
  if (record.attributionType === 'PARTIAL') {
    return record.returnPct > 0 ? 'PARTIAL_WIN' : 'PARTIAL_LOSS';
  }
  return record.returnPct > 0 ? 'FULL_WIN' : 'FULL_LOSS';
}

function inferEvidenceOutcomeStatus(record: ServerAttributionRecord): AttributionOutcomeStatus {
  if (!Number.isFinite(record.returnPct)) return 'INVALID';
  return 'CONFIRMED';
}

export function withAttributionOutcomeDefaults(record: ServerAttributionRecord): ServerAttributionRecord {
  const attributionType = record.attributionType ?? (record.fillId ? 'PARTIAL' : 'FULL_CLOSE');

  return {
    ...record,
    attributionType: attributionType,
    qtyRatio: record.qtyRatio ?? 1.0,
    evidenceOutcomeStatus: record.evidenceOutcomeStatus ?? inferEvidenceOutcomeStatus(record),
    canonicalOutcome: record.canonicalOutcome ?? inferCanonicalOutcomeFromReturn(record),
  };
}
