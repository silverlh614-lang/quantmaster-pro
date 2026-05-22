// @responsibility Gate1/Gate2 diagnostic resolver for upstream watchlist score propagation.

export type WatchlistScoreConfidence = 'VERIFIED' | 'MISSING' | 'UNKNOWN';

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
  scoreScale?: '0~10' | '0~27' | '0~100' | 'rank' | 'unknown';
  confidence: WatchlistScoreConfidence;
  reason?: 'WATCHLIST_SCORE_MISSING' | 'WATCHLIST_SCORE_UNKNOWN_SCALE';
  message: string;
  sourcePath?: string;
  fallbackReason?: string;
  legacyPathUsed?: boolean;
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

function normalizeByField(field: WatchlistScoreSourceField, raw: number): { normalized100: number; scoreScale: ResolvedWatchlistUpstreamScore['scoreScale']; message: string } {
  if (raw <= 0) {
    return { normalized100: 0, scoreScale: '0~100', message: `watchlist ${field} verified as explicit zero score` };
  }
  if (field === 'totalGateScore' || field === 'gateScore') {
    if (raw <= 27) {
      return {
        normalized100: round1((raw / 27) * 100),
        scoreScale: '0~27',
        message: `watchlist ${field} normalized from 0~27 scale`,
      };
    }
    return {
      normalized100: round1(clamp(raw, 0, 100)),
      scoreScale: '0~100',
      message: `watchlist ${field} treated as 0~100 scale and capped`,
    };
  }
  if (raw <= 10) {
    return {
      normalized100: round1(raw * 10),
      scoreScale: '0~10',
      message: `watchlist ${field} normalized from 0~10 scale`,
    };
  }
  if (raw <= 27 && (field === 'watchlistPriorityScore' || field === 'priorityScore')) {
    return {
      normalized100: round1((raw / 27) * 100),
      scoreScale: '0~27',
      message: `watchlist ${field} normalized from 0~27 priority scale`,
    };
  }
  return {
    normalized100: round1(clamp(raw, 0, 100)),
    scoreScale: '0~100',
    message: raw > 100
      ? `watchlist ${field} treated as 0~100 scale and capped`
      : `watchlist ${field} treated as 0~100 scale`,
  };
}

export function resolveWatchlistUpstreamScore(input: unknown): ResolvedWatchlistUpstreamScore {
  if (!input || typeof input !== 'object') {
    return {
      normalized100: 0,
      confidence: 'MISSING',
      reason: 'WATCHLIST_SCORE_MISSING',
      message: 'WATCHLIST_SCORE_MISSING',
    };
  }
  const picked = pickRaw(input as Record<string, unknown>);
  if (!picked) {
    return {
      normalized100: 0,
      confidence: 'MISSING',
      reason: 'WATCHLIST_SCORE_MISSING',
      message: 'WATCHLIST_SCORE_MISSING',
    };
  }
  const normalized = normalizeByField(picked.field, picked.raw);
  const sourcePath = picked.field === 'watchlistScore' || picked.field === 'stage2Score' || picked.field === 'upstreamScore'
    ? 'gateScoreInputSnapshot.watchlist'
    : 'legacy';
  return {
    sourceField: picked.field,
    rawScore: picked.raw,
    normalized100: normalized.normalized100,
    scoreScale: normalized.scoreScale,
    confidence: 'VERIFIED',
    message: normalized.message,
    sourcePath,
    legacyPathUsed: sourcePath === 'legacy',
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
