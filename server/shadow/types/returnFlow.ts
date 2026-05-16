// @responsibility Shadow virtual return-flow lookup contracts.
import type { ProviderHealth, SourceConfidence } from './shadowCase.js';

export interface ReturnFlowCheck {
  caseId: string;
  symbol: string;
  lookupDay: number;
  checkedAt: string;
  hit: boolean;
  stale: boolean;
  pending: boolean;
  providerFallbackUsed: boolean;
  providerHealth: ProviderHealth;
  sourceConfidence: SourceConfidence;
  marketRiskInferred: false;
  price?: number;
  error?: string;
}
