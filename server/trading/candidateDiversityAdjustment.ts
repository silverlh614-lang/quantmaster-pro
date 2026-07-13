// @responsibility Candidate repetition, discovery, and sector diversity score adjustment.

export interface CandidateExposureHistory {
  symbol: string;
  tradingDate: string;
  lastSeenAt?: string;
  lastSignalAt?: string;
  lastBuyAllowedAt?: string;
  lastShadowFilledAt?: string;
  lastLiveOrderedAt?: string;
  lastPositionClosedAt?: string;
  seenCount1d: number;
  seenCount3d: number;
  seenCount7d: number;
  signalCount1d: number;
  signalCount3d: number;
  signalCount7d: number;
  lastDecision?: string;
  lastFinalScore?: number;
  lastOutcome?: string;
  sector?: string;
}

interface SectorExposureState {
  sector: string;
  currentOpenPositions: number;
  candidateCountToday: number;
  grossExposurePct: number;
}

interface DiversityAdjustment {
  freshnessPenalty: number;
  discoveryBonus: number;
  sectorDiversityAdjustment: number;
  totalDiversityAdjustment: number;
  riskTags: string[];
  learningLabels: string[];
  executionImpact: 'NONE';
}

export interface DiversityAdjustmentInput {
  snapshotId?: string;
  symbol: string;
  sector?: string;
  history?: CandidateExposureHistory | null;
  sectorExposure?: SectorExposureState | null;
  volumeExpansionConfirmed?: boolean;
  asOf?: string;
}

export interface DiversityAdjustmentResult extends DiversityAdjustment {
  snapshotId?: string;
  symbol: string;
  sector?: string;
  history?: CandidateExposureHistory | null;
  seenCount1d: number;
  seenCount3d: number;
  seenCount7d: number;
  signalCount1d: number;
  signalCount3d: number;
  signalCount7d: number;
  lastSignalAt?: string;
  lastBuyAllowedAt?: string;
  lastShadowFilledAt?: string;
  discoveryReasons: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function finiteOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function positiveInt(value: number | undefined): number {
  return Math.max(0, Math.floor(finiteOrZero(value)));
}

function parseTime(value: string | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function ageDays(asOfMs: number, value: string | undefined): number {
  const time = parseTime(value);
  if (time === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, (asOfMs - time) / DAY_MS);
}

function mostRecentAgeDays(asOfMs: number, values: Array<string | undefined>): number {
  return values.reduce((best, value) => Math.min(best, ageDays(asOfMs, value)), Number.POSITIVE_INFINITY);
}

function kv(key: string, value: unknown): string {
  return `${key}=${value === undefined || value === null ? 'none' : String(value)}`;
}

function calculateFreshnessPenalty(
  history: CandidateExposureHistory | null | undefined,
  asOf: string = new Date().toISOString(),
): number {
  if (!history) return 0;
  const asOfMs = parseTime(asOf) ?? Date.now();
  const recentEntryAge = mostRecentAgeDays(asOfMs, [
    history.lastBuyAllowedAt,
    history.lastShadowFilledAt,
    history.lastLiveOrderedAt,
  ]);

  let penalty = 0;
  if (recentEntryAge <= 1) penalty -= 5;
  else if (recentEntryAge <= 3) penalty -= 3;
  else if (recentEntryAge <= 7) penalty -= 1;

  if (positiveInt(history.seenCount1d) >= 3) penalty -= 2;
  if (positiveInt(history.seenCount3d) >= 5) penalty -= 2;

  return penalty;
}

function calculateSectorDiversityAdjustment(
  sectorExposure: SectorExposureState | null | undefined,
): number {
  if (!sectorExposure) return 0;
  const open = positiveInt(sectorExposure.currentOpenPositions);
  const candidates = positiveInt(sectorExposure.candidateCountToday);
  const grossExposurePct = finiteOrZero(sectorExposure.grossExposurePct);

  let adjustment = 0;
  if (open >= 3 || grossExposurePct >= 30) adjustment -= 4;
  else if (open >= 2 || grossExposurePct >= 20) adjustment -= 3;
  else if (open >= 1 || grossExposurePct >= 10) adjustment -= 2;

  if (candidates >= 6) adjustment -= 3;
  else if (candidates >= 4) adjustment -= 2;
  else if (candidates >= 3) adjustment -= 1;

  if (open === 0 && grossExposurePct <= 5 && candidates <= 1) adjustment += 2;
  else if (open === 0 && grossExposurePct < 10) adjustment += 1;

  return adjustment;
}

function calculateDiscoveryBonus(input: {
  history?: CandidateExposureHistory | null;
  sectorExposure?: SectorExposureState | null;
  volumeExpansionConfirmed?: boolean;
  asOf?: string;
}): { bonus: number; reasons: string[] } {
  const asOfMs = parseTime(input.asOf) ?? Date.now();
  const history = input.history;
  let bonus = 0;
  const reasons: string[] = [];
  const lastExposureAge = history
    ? mostRecentAgeDays(asOfMs, [
        history.lastSeenAt,
        history.lastSignalAt,
        history.lastBuyAllowedAt,
        history.lastShadowFilledAt,
        history.lastLiveOrderedAt,
        history.lastPositionClosedAt,
      ])
    : Number.POSITIVE_INFINITY;
  const lastSignalAge = history
    ? mostRecentAgeDays(asOfMs, [
        history.lastSignalAt,
        history.lastBuyAllowedAt,
        history.lastShadowFilledAt,
        history.lastLiveOrderedAt,
      ])
    : Number.POSITIVE_INFINITY;

  if (lastExposureAge > 7) {
    bonus += 3;
    reasons.push('NEW_CANDIDATE_7D');
  }

  if (lastSignalAge > 14) {
    bonus += 2;
    reasons.push('NO_SIGNAL_14D');
  }

  const sectorExposure = input.sectorExposure;
  if (
    sectorExposure
    && positiveInt(sectorExposure.currentOpenPositions) === 0
    && finiteOrZero(sectorExposure.grossExposurePct) <= 5
    && positiveInt(sectorExposure.candidateCountToday) <= 1
  ) {
    bonus += 2;
    reasons.push('NEW_SECTOR_LOW_EXPOSURE');
  }

  if (input.volumeExpansionConfirmed === true) {
    bonus += 2;
    reasons.push('VOLUME_EXPANSION_CONFIRMED');
  }

  return { bonus: Math.min(5, bonus), reasons };
}

export function calculateDiversityAdjustment(input: DiversityAdjustmentInput): DiversityAdjustmentResult {
  const history = input.history ?? null;
  const asOf = input.asOf ?? new Date().toISOString();
  const freshnessPenalty = calculateFreshnessPenalty(history, asOf);
  const discovery = calculateDiscoveryBonus({
    history,
    sectorExposure: input.sectorExposure,
    volumeExpansionConfirmed: input.volumeExpansionConfirmed,
    asOf,
  });
  const sectorDiversityAdjustment = calculateSectorDiversityAdjustment(input.sectorExposure);
  const totalDiversityAdjustment = freshnessPenalty + discovery.bonus + sectorDiversityAdjustment;

  const riskTags = new Set<string>();
  const learningLabels = new Set<string>();
  if (freshnessPenalty < 0) {
    riskTags.add('REPEATED_CANDIDATE');
    learningLabels.add('REPEATED_CANDIDATE_OBSERVED');
    learningLabels.add('FRESHNESS_PENALTY_APPLIED');
  }
  if (discovery.bonus > 0) {
    riskTags.add('DISCOVERY_CANDIDATE');
    learningLabels.add('DISCOVERY_BONUS_APPLIED');
  }
  if (sectorDiversityAdjustment !== 0) {
    riskTags.add(sectorDiversityAdjustment < 0 ? 'SECTOR_CONCENTRATION' : 'SECTOR_DIVERSIFICATION');
    learningLabels.add('SECTOR_DIVERSITY_ADJUSTMENT_APPLIED');
  }

  return {
    snapshotId: input.snapshotId,
    symbol: input.symbol,
    sector: input.sector ?? history?.sector ?? input.sectorExposure?.sector,
    history,
    freshnessPenalty,
    discoveryBonus: discovery.bonus,
    sectorDiversityAdjustment,
    totalDiversityAdjustment,
    riskTags: [...riskTags],
    learningLabels: [...learningLabels],
    executionImpact: 'NONE',
    seenCount1d: positiveInt(history?.seenCount1d),
    seenCount3d: positiveInt(history?.seenCount3d),
    seenCount7d: positiveInt(history?.seenCount7d),
    signalCount1d: positiveInt(history?.signalCount1d),
    signalCount3d: positiveInt(history?.signalCount3d),
    signalCount7d: positiveInt(history?.signalCount7d),
    lastSignalAt: history?.lastSignalAt,
    lastBuyAllowedAt: history?.lastBuyAllowedAt,
    lastShadowFilledAt: history?.lastShadowFilledAt,
    discoveryReasons: discovery.reasons,
  };
}

export function formatDiversityAdjustmentAppliedLog(result: DiversityAdjustmentResult): string {
  return [
    '[DIVERSITY_ADJUSTMENT_APPLIED]',
    kv('snapshotId', result.snapshotId),
    kv('symbol', result.symbol),
    kv('sector', result.sector),
    kv('freshnessPenalty', result.freshnessPenalty),
    kv('discoveryBonus', result.discoveryBonus),
    kv('sectorDiversityAdjustment', result.sectorDiversityAdjustment),
    kv('totalDiversityAdjustment', result.totalDiversityAdjustment),
    kv('seenCount1d', result.seenCount1d),
    kv('seenCount3d', result.seenCount3d),
    kv('seenCount7d', result.seenCount7d),
    kv('signalCount1d', result.signalCount1d),
    kv('signalCount3d', result.signalCount3d),
    kv('signalCount7d', result.signalCount7d),
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatRepeatedCandidatePenaltyAppliedLog(result: DiversityAdjustmentResult): string {
  return [
    '[REPEATED_CANDIDATE_PENALTY_APPLIED]',
    kv('snapshotId', result.snapshotId),
    kv('symbol', result.symbol),
    kv('lastSignalAt', result.lastSignalAt),
    kv('lastBuyAllowedAt', result.lastBuyAllowedAt),
    kv('lastShadowFilledAt', result.lastShadowFilledAt),
    kv('freshnessPenalty', result.freshnessPenalty),
    "previousBehavior='EXCLUDE_OR_DUPLICATE_BLOCK'",
    "newBehavior='SCORE_PENALTY_ONLY'",
    "executionImpact='NONE'",
  ].join(' ');
}

export function formatDiscoveryBonusAppliedLog(result: DiversityAdjustmentResult): string {
  return [
    '[DISCOVERY_BONUS_APPLIED]',
    kv('snapshotId', result.snapshotId),
    kv('symbol', result.symbol),
    kv('reason', `[${result.discoveryReasons.join(',') || 'none'}]`),
    kv('discoveryBonus', result.discoveryBonus),
    "executionImpact='NONE'",
  ].join(' ');
}
