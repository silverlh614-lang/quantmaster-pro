// @responsibility Gate3 threshold evidence scoring from labeled shadow outcomes; suggest-only.

import type { Gate3OutcomeLabel, Gate3OutcomeSeed } from './gate3OutcomeSeed.js';

export type Gate3EvidenceWindow = 'D3' | 'D5' | 'D10';

export type Gate3ThresholdKey =
  | 'RRR_PASS_MIN'
  | 'RRR_WATCH_MIN'
  | 'VOLUME_CONFIRMED_RATIO'
  | 'VOLUME_PARTIAL_RATIO'
  | 'VOLUME_DRY_UP_RATIO'
  | 'NEAR_BREAKOUT_DISTANCE'
  | 'BREAKOUT_CONFIRM_BUFFER'
  | 'OVEREXTENDED_MA20_PCT'
  | 'RSI_UPPER_BOUND';

export interface Gate3ThresholdSuggestion {
  key: Gate3ThresholdKey;
  currentValue: number;
  suggestedValue: number;
  reason: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  sampleSize: number;
  evidenceWindow: Gate3EvidenceWindow;
  applyMode: 'SUGGEST_ONLY';
}

export interface Gate3EvidenceScore {
  sampleSize: number;
  evidenceWindow: Gate3EvidenceWindow;
  readySampleSize: number;
  readyWinRate: number | null;
  readyAvgReturn: number | null;
  readyFailureRate: number | null;
  waitSampleSize: number;
  waitBecameReadyRate: number | null;
  waitMissedBreakoutRate: number | null;
  waitCorrectPatienceRate: number | null;
  blockedSampleSize: number;
  blockedCorrectRate: number | null;
  blockedFalseNegativeRate: number | null;
  dataIncompleteSampleSize: number;
  dataIncompleteResolvedRate: number | null;
  dataIncompleteMissedOpportunityRate: number | null;
  falsePositiveRate: number | null;
  falseNegativeRate: number | null;
  missedBreakoutRate: number | null;
  correctBlockRate: number | null;
  rrrOverstrictScore: number | null;
  volumeOverstrictScore: number | null;
  priceOverstrictScore: number | null;
  suggestions: Gate3ThresholdSuggestion[];
}

export interface Gate3ThresholdConfig {
  rrrPassMin: number;
  rrrWatchMin: number;
  volumeConfirmedRatio: number;
  volumePartialRatio: number;
  volumeDryUpRatio: number;
  nearBreakoutDistance: number;
  breakoutConfirmBuffer: number;
  overextendedMa20Pct: number;
  rsiUpperBound: number;
}

export interface BuildGate3EvidenceScoreConfig {
  evidenceWindow?: Gate3EvidenceWindow;
  thresholds?: Partial<Gate3ThresholdConfig>;
}

const DEFAULT_THRESHOLDS: Gate3ThresholdConfig = {
  rrrPassMin: 2,
  rrrWatchMin: 1.5,
  volumeConfirmedRatio: 1.5,
  volumePartialRatio: 1.1,
  volumeDryUpRatio: 0.5,
  nearBreakoutDistance: 0.985,
  breakoutConfirmBuffer: 1.002,
  overextendedMa20Pct: 12,
  rsiUpperBound: 75,
};

const READY_SUCCESS_LABELS = new Set<Gate3OutcomeLabel>([
  'GATE3_READY_WIN',
  'GATE3_READY_FOLLOW_THROUGH',
]);

const READY_FAILURE_LABELS = new Set<Gate3OutcomeLabel>([
  'GATE3_READY_LOSS',
  'GATE3_READY_FAILED_BREAKOUT',
]);

const BLOCKED_FALSE_NEGATIVE_LABELS = new Set<Gate3OutcomeLabel>([
  'GATE3_BLOCKED_FALSE_NEGATIVE',
  'GATE3_BLOCKED_OVERSTRICT_RRR',
  'GATE3_BLOCKED_OVERSTRICT_VOLUME',
  'GATE3_BLOCKED_OVERSTRICT_PRICE',
]);

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round1((numerator / denominator) * 100);
}

function avg(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function returnForWindow(seed: Gate3OutcomeSeed, window: Gate3EvidenceWindow): number | null {
  if (window === 'D3') return finiteNumber(seed.forwardReturns.d3);
  if (window === 'D10') return finiteNumber(seed.forwardReturns.d10);
  return finiteNumber(seed.forwardReturns.d5) ?? finiteNumber(seed.maxForwardReturnPct);
}

function labeledSeeds(outcomes: readonly Gate3OutcomeSeed[]): Gate3OutcomeSeed[] {
  return outcomes.filter((seed) => seed.outcomeStatus === 'LABELED' && seed.outcomeLabel !== null);
}

function confidenceFor(sampleSize: number): Gate3ThresholdSuggestion['confidence'] {
  if (sampleSize >= 50) return 'HIGH';
  if (sampleSize >= 20) return 'MEDIUM';
  return 'LOW';
}

function currentThresholdValue(key: Gate3ThresholdKey, thresholds: Gate3ThresholdConfig): number {
  switch (key) {
    case 'RRR_PASS_MIN':
      return thresholds.rrrPassMin;
    case 'RRR_WATCH_MIN':
      return thresholds.rrrWatchMin;
    case 'VOLUME_CONFIRMED_RATIO':
      return thresholds.volumeConfirmedRatio;
    case 'VOLUME_PARTIAL_RATIO':
      return thresholds.volumePartialRatio;
    case 'VOLUME_DRY_UP_RATIO':
      return thresholds.volumeDryUpRatio;
    case 'NEAR_BREAKOUT_DISTANCE':
      return thresholds.nearBreakoutDistance;
    case 'BREAKOUT_CONFIRM_BUFFER':
      return thresholds.breakoutConfirmBuffer;
    case 'OVEREXTENDED_MA20_PCT':
      return thresholds.overextendedMa20Pct;
    case 'RSI_UPPER_BOUND':
      return thresholds.rsiUpperBound;
  }
}

function suggestion(input: {
  key: Gate3ThresholdKey;
  suggestedValue: number;
  reason: string;
  sampleSize: number;
  evidenceWindow: Gate3EvidenceWindow;
  thresholds: Gate3ThresholdConfig;
}): Gate3ThresholdSuggestion {
  return {
    key: input.key,
    currentValue: currentThresholdValue(input.key, input.thresholds),
    suggestedValue: input.suggestedValue,
    reason: input.reason,
    confidence: confidenceFor(input.sampleSize),
    sampleSize: input.sampleSize,
    evidenceWindow: input.evidenceWindow,
    applyMode: 'SUGGEST_ONLY',
  };
}

function d5Winners(seeds: readonly Gate3OutcomeSeed[]): Gate3OutcomeSeed[] {
  return seeds.filter((seed) => (finiteNumber(seed.forwardReturns.d5) ?? finiteNumber(seed.maxForwardReturnPct) ?? Number.NEGATIVE_INFINITY) >= 5);
}

function overstrictRate(input: {
  seeds: readonly Gate3OutcomeSeed[];
  issueMatches: readonly string[];
  labelMatches: readonly Gate3OutcomeLabel[];
}): { score: number | null; sampleSize: number } {
  const labelSet = new Set(input.labelMatches);
  const issueSet = new Set(input.issueMatches);
  const samples = input.seeds.filter((seed) =>
    issueSet.has(seed.issue) || (seed.outcomeLabel !== null && labelSet.has(seed.outcomeLabel)),
  );
  const winners = samples.filter((seed) =>
    (seed.outcomeLabel !== null && labelSet.has(seed.outcomeLabel))
    || ((finiteNumber(seed.forwardReturns.d5) ?? finiteNumber(seed.maxForwardReturnPct) ?? Number.NEGATIVE_INFINITY) >= 5),
  );
  return { score: rate(winners.length, samples.length), sampleSize: samples.length };
}

function buildSuggestions(input: {
  labeled: readonly Gate3OutcomeSeed[];
  score: Omit<Gate3EvidenceScore, 'suggestions'>;
  thresholds: Gate3ThresholdConfig;
}): Gate3ThresholdSuggestion[] {
  const { labeled, score, thresholds } = input;
  const suggestions: Gate3ThresholdSuggestion[] = [];
  const window = score.evidenceWindow;
  const blocked = labeled.filter((seed) => seed.readiness === 'BLOCKED');
  const ready = labeled.filter((seed) => seed.readiness === 'READY');
  const overextended = blocked.filter((seed) => seed.issue === 'OVEREXTENDED');

  if ((score.rrrOverstrictScore ?? 0) >= 25) {
    const rrrSamples = blocked.filter((seed) =>
      seed.issue === 'RRR_FAIL'
      || seed.issue === 'RRR_WATCH'
      || seed.outcomeLabel === 'GATE3_BLOCKED_OVERSTRICT_RRR',
    );
    suggestions.push(suggestion({
      key: 'RRR_PASS_MIN',
      suggestedValue: Math.min(thresholds.rrrPassMin, 1.8),
      reason: 'RRR_FAIL/RRR_WATCH blocked winners observed; relax pass threshold for operator review.',
      sampleSize: rrrSamples.length,
      evidenceWindow: window,
      thresholds,
    }));
  }

  if ((score.volumeOverstrictScore ?? 0) >= 25) {
    const volumeWeakSamples = blocked.filter((seed) =>
      seed.issue === 'VOLUME_WEAK' || seed.outcomeLabel === 'GATE3_BLOCKED_OVERSTRICT_VOLUME',
    );
    suggestions.push(suggestion({
      key: 'VOLUME_CONFIRMED_RATIO',
      suggestedValue: Math.min(thresholds.volumeConfirmedRatio, 1.3),
      reason: 'VOLUME_WEAK blocked winners observed; consider a lower confirmation ratio.',
      sampleSize: volumeWeakSamples.length,
      evidenceWindow: window,
      thresholds,
    }));
  }

  const readyVolumeConfirmed = ready.filter((seed) => seed.volumeConfirmation === 'CONFIRMED');
  const readyVolumeFailures = readyVolumeConfirmed.filter((seed) =>
    seed.outcomeLabel !== null && READY_FAILURE_LABELS.has(seed.outcomeLabel),
  );
  const readyVolumeFailureRate = rate(readyVolumeFailures.length, readyVolumeConfirmed.length);
  if ((score.readyFailureRate ?? 0) >= 30 && (readyVolumeFailureRate ?? 0) >= 30) {
    suggestions.push(suggestion({
      key: 'VOLUME_CONFIRMED_RATIO',
      suggestedValue: Math.max(thresholds.volumeConfirmedRatio, 1.7),
      reason: 'READY failures remain high even with CONFIRMED volume; strengthen breakout volume confirmation.',
      sampleSize: readyVolumeConfirmed.length,
      evidenceWindow: window,
      thresholds,
    }));
  }

  if ((score.waitMissedBreakoutRate ?? 0) >= 20) {
    suggestions.push(suggestion({
      key: 'NEAR_BREAKOUT_DISTANCE',
      suggestedValue: Math.min(thresholds.nearBreakoutDistance, 0.975),
      reason: 'WAIT missed breakouts are elevated; start near-entry tracking earlier.',
      sampleSize: score.waitSampleSize,
      evidenceWindow: window,
      thresholds,
    }));
  }

  if (rate(d5Winners(overextended).length, overextended.length) !== null && (rate(d5Winners(overextended).length, overextended.length) ?? 0) >= 25) {
    suggestions.push(suggestion({
      key: 'OVEREXTENDED_MA20_PCT',
      suggestedValue: Math.max(thresholds.overextendedMa20Pct, 15),
      reason: 'OVEREXTENDED blocks later followed through; widen MA20 extension ceiling for review.',
      sampleSize: overextended.length,
      evidenceWindow: window,
      thresholds,
    }));
  }

  return suggestions;
}

export function buildGate3EvidenceScore(
  outcomes: readonly Gate3OutcomeSeed[],
  config: BuildGate3EvidenceScoreConfig = {},
): Gate3EvidenceScore {
  const evidenceWindow = config.evidenceWindow ?? 'D5';
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(config.thresholds ?? {}) };
  const labeled = labeledSeeds(outcomes);
  const ready = labeled.filter((seed) => seed.readiness === 'READY');
  const wait = labeled.filter((seed) => seed.readiness === 'WAIT');
  const blocked = labeled.filter((seed) => seed.readiness === 'BLOCKED');
  const dataIncomplete = labeled.filter((seed) => seed.readiness === 'DATA_INCOMPLETE');

  const readyWins = ready.filter((seed) => seed.outcomeLabel !== null && READY_SUCCESS_LABELS.has(seed.outcomeLabel));
  const readyFailures = ready.filter((seed) => seed.outcomeLabel !== null && READY_FAILURE_LABELS.has(seed.outcomeLabel));
  const waitBecameReady = wait.filter((seed) => seed.outcomeLabel === 'GATE3_WAIT_BECAME_READY');
  const waitMissedBreakout = wait.filter((seed) => seed.outcomeLabel === 'GATE3_WAIT_MISSED_BREAKOUT');
  const waitCorrectPatience = wait.filter((seed) => seed.outcomeLabel === 'GATE3_WAIT_CORRECT_PATIENCE');
  const blockedCorrect = blocked.filter((seed) => seed.outcomeLabel === 'GATE3_BLOCKED_CORRECT');
  const blockedFalseNegative = blocked.filter((seed) => seed.outcomeLabel !== null && BLOCKED_FALSE_NEGATIVE_LABELS.has(seed.outcomeLabel));
  const dataResolved = dataIncomplete.filter((seed) => seed.outcomeLabel === 'GATE3_DATA_INCOMPLETE_RESOLVED');
  const dataMissedOpportunity = dataIncomplete.filter((seed) => seed.outcomeLabel === 'GATE3_DATA_INCOMPLETE_MISSED_OPPORTUNITY');
  const readyReturns = ready
    .map((seed) => returnForWindow(seed, evidenceWindow))
    .filter((value): value is number => value !== null);
  const rrrOverstrict = overstrictRate({
    seeds: blocked,
    issueMatches: ['RRR_FAIL', 'RRR_WATCH'],
    labelMatches: ['GATE3_BLOCKED_OVERSTRICT_RRR'],
  });
  const volumeOverstrict = overstrictRate({
    seeds: blocked,
    issueMatches: ['VOLUME_WEAK'],
    labelMatches: ['GATE3_BLOCKED_OVERSTRICT_VOLUME'],
  });
  const priceOverstrict = overstrictRate({
    seeds: blocked,
    issueMatches: ['PRICE_NOT_CONFIRMED'],
    labelMatches: ['GATE3_BLOCKED_OVERSTRICT_PRICE'],
  });

  const scoreWithoutSuggestions: Omit<Gate3EvidenceScore, 'suggestions'> = {
    sampleSize: labeled.length,
    evidenceWindow,
    readySampleSize: ready.length,
    readyWinRate: rate(readyWins.length, ready.length),
    readyAvgReturn: avg(readyReturns),
    readyFailureRate: rate(readyFailures.length, ready.length),
    waitSampleSize: wait.length,
    waitBecameReadyRate: rate(waitBecameReady.length, wait.length),
    waitMissedBreakoutRate: rate(waitMissedBreakout.length, wait.length),
    waitCorrectPatienceRate: rate(waitCorrectPatience.length, wait.length),
    blockedSampleSize: blocked.length,
    blockedCorrectRate: rate(blockedCorrect.length, blocked.length),
    blockedFalseNegativeRate: rate(blockedFalseNegative.length, blocked.length),
    dataIncompleteSampleSize: dataIncomplete.length,
    dataIncompleteResolvedRate: rate(dataResolved.length, dataIncomplete.length),
    dataIncompleteMissedOpportunityRate: rate(dataMissedOpportunity.length, dataIncomplete.length),
    falsePositiveRate: rate(readyFailures.length, ready.length),
    falseNegativeRate: rate(blockedFalseNegative.length, blocked.length),
    missedBreakoutRate: rate(waitMissedBreakout.length, wait.length),
    correctBlockRate: rate(blockedCorrect.length, blocked.length),
    rrrOverstrictScore: rrrOverstrict.score,
    volumeOverstrictScore: volumeOverstrict.score,
    priceOverstrictScore: priceOverstrict.score,
  };

  return {
    ...scoreWithoutSuggestions,
    suggestions: buildSuggestions({
      labeled,
      score: scoreWithoutSuggestions,
      thresholds,
    }),
  };
}

function pctText(value: number | null): string {
  return value === null ? 'N/A' : `${value.toFixed(1)}%`;
}

function signedPctText(value: number | null): string {
  if (value === null) return 'N/A';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function scoreText(value: number | null): string {
  return value === null ? 'N/A' : `${value.toFixed(0)}/100`;
}

function suggestionLine(item: Gate3ThresholdSuggestion): string {
  return [
    `- ${item.key} ${item.currentValue} -> ${item.suggestedValue}`,
    `confidence=${item.confidence}`,
    `sampleSize=${item.sampleSize}`,
    `reason=${item.reason}`,
    `applyMode=${item.applyMode}`,
  ].join(' | ');
}

export function formatGate3ThresholdEvidenceSection(score: Gate3EvidenceScore | null | undefined): string | null {
  if (!score) return null;
  return [
    'Gate3 Threshold Evidence',
    '------------------------',
    `window: ${score.evidenceWindow}`,
    `sampleSize: ${score.sampleSize}`,
    '',
    'READY',
    `winRate: ${pctText(score.readyWinRate)} / avgReturn: ${signedPctText(score.readyAvgReturn)} / failureRate: ${pctText(score.readyFailureRate)}`,
    '',
    'WAIT',
    `becameReady: ${pctText(score.waitBecameReadyRate)} / missedBreakout: ${pctText(score.waitMissedBreakoutRate)} / correctPatience: ${pctText(score.waitCorrectPatienceRate)}`,
    '',
    'BLOCKED',
    `correctBlock: ${pctText(score.blockedCorrectRate)} / falseNegative: ${pctText(score.blockedFalseNegativeRate)}`,
    '',
    'DATA_INCOMPLETE',
    `resolved: ${pctText(score.dataIncompleteResolvedRate)} / missedOpportunity: ${pctText(score.dataIncompleteMissedOpportunityRate)}`,
    '',
    'Overstrict',
    `RRR: ${scoreText(score.rrrOverstrictScore)}`,
    `Volume: ${scoreText(score.volumeOverstrictScore)}`,
    `Price: ${scoreText(score.priceOverstrictScore)}`,
    '',
    'Suggestions',
    ...(score.suggestions.length > 0
      ? score.suggestions.map(suggestionLine)
      : ['N/A - insufficient labeled evidence']),
    'marketSignal=false; providerIssue=false; applyMode=SUGGEST_ONLY',
  ].join('\n');
}

export { DEFAULT_THRESHOLDS as DEFAULT_GATE3_THRESHOLD_CONFIG };
