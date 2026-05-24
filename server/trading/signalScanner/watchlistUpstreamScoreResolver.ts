// @responsibility Gate1/Gate2 diagnostic resolver for upstream watchlist score propagation.

export type WatchlistScoreConfidence = 'VERIFIED' | 'MISSING' | 'UNKNOWN';
export type WatchlistScoreScaleHint = '0_10' | '0_27' | '0_100';

export type WatchlistScoreSourceField =
  | 'stage2Score'
  | 'watchlistScore'
  | 'upstreamCandidateScore'
  | 'watchlistRank'
  | 'totalGateScore'
  | 'gateScore'
  | 'stage1Score'
  | 'priorityScore'
  | 'watchlistPriorityScore'
  | 'qualScore'
  | 'score'
  | 'watchlistUpstreamScore'
  | 'upstreamScore';

export interface ResolvedWatchlistUpstreamScore {
  sourceField?: WatchlistScoreSourceField;
  rawScore?: number;
  normalized100: number;
  normalizedScore?: number | null;
  scoreScale?: '0~10' | '0~27' | '0~100' | 'rank' | 'unknown';
  scaleHint?: WatchlistScoreScaleHint | null;
  confidence: WatchlistScoreConfidence;
  reason?: 'WATCHLIST_SCORE_MISSING' | 'WATCHLIST_SCORE_UNKNOWN_SCALE';
  message: string;
  sourcePath?: string;
  fallbackReason?: string;
  legacyPathUsed?: boolean;
  scoreMissing?: boolean;
  scoreScaleFixed?: boolean;
  promotionScoreCopied?: boolean;
}

const SOURCE_FIELDS: WatchlistScoreSourceField[] = [
  'stage2Score',
  'watchlistScore',
  'upstreamCandidateScore',
  'watchlistUpstreamScore',
  'upstreamScore',
  'watchlistRank',
  'totalGateScore',
  'gateScore',
  'stage1Score',
  'priorityScore',
  'watchlistPriorityScore',
  'qualScore',
  'score',
];

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeScaleHint(value: unknown): WatchlistScoreScaleHint | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase().replace(/[~-]/g, '_');
  if (normalized === '0_10' || normalized === 'SCALE_0_10') return '0_10';
  if (normalized === '0_27' || normalized === 'SCALE_0_27' || normalized === 'TOTAL_GATE_SCORE_27') return '0_27';
  if (normalized === '0_100' || normalized === 'SCALE_0_100') return '0_100';
  return undefined;
}

function scaleHintFromRecord(input: unknown): WatchlistScoreScaleHint | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  return normalizeScaleHint(record.scaleHint)
    ?? normalizeScaleHint(record.scoreScaleHint)
    ?? normalizeScaleHint(record.watchlistScoreScaleHint)
    ?? normalizeScaleHint(record.watchlistScoreScale)
    ?? normalizeScaleHint(record.scoreScale);
}

function resolveScaleHint(input: Record<string, unknown>): WatchlistScoreScaleHint | undefined {
  const gateScoreInputSnapshot = input.gateScoreInputSnapshot;
  if (gateScoreInputSnapshot && typeof gateScoreInputSnapshot === 'object') {
    const watchlist = (gateScoreInputSnapshot as Record<string, unknown>).watchlist;
    const hint = scaleHintFromRecord(watchlist);
    if (hint) return hint;
  }
  const featurePack = input.featurePack;
  if (featurePack && typeof featurePack === 'object') {
    const hint = scaleHintFromRecord(featurePack) ?? scaleHintFromRecord((featurePack as Record<string, unknown>).watchlist);
    if (hint) return hint;
  }
  const featureContext = input.featureContext;
  if (featureContext && typeof featureContext === 'object') {
    const watchlistFeature = (featureContext as Record<string, unknown>).WATCHLIST_UPSTREAM_SCORE;
    const hint = scaleHintFromRecord(watchlistFeature);
    if (hint) return hint;
  }
  const directHint = scaleHintFromRecord(input);
  if (directHint) return directHint;
  const features = input.symbolFeatures;
  return scaleHintFromRecord(features);
}

function pickRaw(input: Record<string, unknown>): { field: WatchlistScoreSourceField; raw: number } | undefined {
  const gateScoreInputSnapshot = input.gateScoreInputSnapshot;
  if (gateScoreInputSnapshot && typeof gateScoreInputSnapshot === 'object') {
    const watchlist = (gateScoreInputSnapshot as Record<string, unknown>).watchlist;
    if (watchlist && typeof watchlist === 'object') {
      const watchlistScore = numeric((watchlist as Record<string, unknown>).watchlistScore);
      if (watchlistScore !== undefined) return { field: 'watchlistScore', raw: watchlistScore };
      const stage2Score = numeric((watchlist as Record<string, unknown>).stage2Score);
      if (stage2Score !== undefined) return { field: 'stage2Score', raw: stage2Score };
      const upstream = numeric((watchlist as Record<string, unknown>).upstreamScore);
      if (upstream !== undefined) return { field: 'upstreamScore', raw: upstream };
    }
  }
  const featurePack = input.featurePack;
  if (featurePack && typeof featurePack === 'object') {
    const watchlistScore = numeric((featurePack as Record<string, unknown>).watchlistScore);
    if (watchlistScore !== undefined) return { field: 'watchlistScore', raw: watchlistScore };
    const watchlist = (featurePack as Record<string, unknown>).watchlist;
    if (watchlist && typeof watchlist === 'object') {
      const upstream = numeric((watchlist as Record<string, unknown>).upstreamScore);
      if (upstream !== undefined) return { field: 'upstreamScore', raw: upstream };
    }
  }
  const featureContext = input.featureContext;
  if (featureContext && typeof featureContext === 'object') {
    const watchlistFeature = (featureContext as Record<string, unknown>).WATCHLIST_UPSTREAM_SCORE;
    if (watchlistFeature && typeof watchlistFeature === 'object') {
      const projected = watchlistFeature as Record<string, unknown>;
      const featureValue = numeric(projected.value);
      if (featureValue !== undefined) return { field: 'watchlistUpstreamScore', raw: featureValue };
    }
  }
  for (const field of SOURCE_FIELDS) {
    const direct = numeric(input[field]);
    if (direct !== undefined) return { field, raw: direct };
  }
  const features = input.symbolFeatures;
  if (features && typeof features === 'object') {
    const featureRecord = features as Record<string, unknown>;
    for (const field of SOURCE_FIELDS) {
      const value = numeric(featureRecord[field]);
      if (value !== undefined) return { field, raw: value };
    }
  }
  return undefined;
}

function normalizeByField(
  field: WatchlistScoreSourceField,
  raw: number,
  scaleHint?: WatchlistScoreScaleHint,
): { normalized100: number; scoreScale: ResolvedWatchlistUpstreamScore['scoreScale']; message: string; scoreScaleFixed: boolean } {
  if (raw <= 0) {
    return { normalized100: 0, scoreScale: '0~100', message: `watchlist ${field} verified as explicit zero score`, scoreScaleFixed: false };
  }
  if (scaleHint === '0_10') {
    return {
      normalized100: round1(clamp(raw, 0, 10) * 10),
      scoreScale: '0~10',
      message: `watchlist ${field} normalized from explicit 0~10 scale hint`,
      scoreScaleFixed: raw !== round1(clamp(raw, 0, 10) * 10),
    };
  }
  if (scaleHint === '0_27') {
    return {
      normalized100: round1((clamp(raw, 0, 27) / 27) * 100),
      scoreScale: '0~27',
      message: `watchlist ${field} normalized from explicit 0~27 scale hint`,
      scoreScaleFixed: raw !== round1((clamp(raw, 0, 27) / 27) * 100),
    };
  }
  if (scaleHint === '0_100') {
    const normalized100 = round1(clamp(raw, 0, 100));
    return {
      normalized100,
      scoreScale: '0~100',
      message: `watchlist ${field} treated as explicit 0~100 scale`,
      scoreScaleFixed: raw !== normalized100,
    };
  }
  if (raw <= 27) {
    return {
      normalized100: round1((raw / 27) * 100),
      scoreScale: '0~27',
      message: `watchlist ${field} normalized from 0~27 scale`,
      scoreScaleFixed: raw !== round1((raw / 27) * 100),
    };
  }
  const normalized100 = round1(clamp(raw, 0, 100));
  return {
    normalized100,
    scoreScale: '0~100',
    message: raw > 100
      ? `watchlist ${field} treated as 0~100 scale and capped`
      : `watchlist ${field} treated as 0~100 scale`,
    scoreScaleFixed: raw !== normalized100,
  };
}

export function resolveWatchlistUpstreamScore(input: unknown): ResolvedWatchlistUpstreamScore {
  if (!input || typeof input !== 'object') {
    return {
      normalized100: 0,
      normalizedScore: null,
      confidence: 'MISSING',
      reason: 'WATCHLIST_SCORE_MISSING',
      message: 'WATCHLIST_SCORE_MISSING',
      scoreMissing: true,
      scoreScaleFixed: false,
      promotionScoreCopied: false,
    };
  }
  const picked = pickRaw(input as Record<string, unknown>);
  if (!picked) {
    return {
      normalized100: 0,
      normalizedScore: null,
      confidence: 'MISSING',
      reason: 'WATCHLIST_SCORE_MISSING',
      message: 'WATCHLIST_SCORE_MISSING',
      scoreMissing: true,
      scoreScaleFixed: false,
      promotionScoreCopied: false,
    };
  }
  const scaleHint = resolveScaleHint(input as Record<string, unknown>);
  const normalized = normalizeByField(picked.field, picked.raw, scaleHint);
  const sourcePath = picked.field === 'watchlistScore' || picked.field === 'stage2Score' || picked.field === 'upstreamScore'
    ? 'gateScoreInputSnapshot.watchlist'
    : 'legacy';
  const promotionScoreCopied = picked.field === 'upstreamCandidateScore'
    || picked.field === 'watchlistUpstreamScore'
    || picked.field === 'upstreamScore';
  return {
    sourceField: picked.field,
    rawScore: picked.raw,
    normalized100: normalized.normalized100,
    normalizedScore: normalized.normalized100,
    scoreScale: normalized.scoreScale,
    scaleHint: scaleHint ?? null,
    confidence: 'VERIFIED',
    message: normalized.message,
    sourcePath,
    legacyPathUsed: sourcePath === 'legacy',
    scoreMissing: false,
    scoreScaleFixed: normalized.scoreScaleFixed,
    promotionScoreCopied,
  };
}

export function summarizeWatchlistScoreSources(
  scores: readonly ResolvedWatchlistUpstreamScore[],
): {
  verified: number;
  missing: number;
  avgNormalized100: number;
  sourceFieldDistribution: Record<string, number>;
  scoreScaleDistribution: Record<string, number>;
} {
  const verifiedScores = scores.filter((score) => score.confidence === 'VERIFIED');
  const sourceFieldDistribution: Record<string, number> = {};
  const scoreScaleDistribution: Record<string, number> = {};
  for (const score of scores) {
    const key = score.sourceField ?? 'none';
    sourceFieldDistribution[key] = (sourceFieldDistribution[key] ?? 0) + 1;
    const scale = score.scoreScale ?? 'none';
    scoreScaleDistribution[scale] = (scoreScaleDistribution[scale] ?? 0) + 1;
  }
  const avgNormalized100 = verifiedScores.length === 0
    ? 0
    : round1(verifiedScores.reduce((sum, score) => sum + score.normalized100, 0) / verifiedScores.length);
  return {
    verified: verifiedScores.length,
    missing: scores.length - verifiedScores.length,
    avgNormalized100,
    sourceFieldDistribution,
    scoreScaleDistribution,
  };
}
