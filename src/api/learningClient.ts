/**
 * @responsibility Nightly Reflection 학습 API 클라이언트 — /api/learning/status read-only (ADR-0047 PR-Z5)
 */

/** 서버 LearningStatusSnapshot 동기 사본 (절대 규칙 #3 — 서버↔클라 직접 import 금지). */
export type DailyVerdict = 'GOOD_DAY' | 'MIXED' | 'BAD_DAY' | 'SILENT';
export type ReflectionMode =
  | 'FULL' | 'REDUCED_EOD' | 'REDUCED_MWF' | 'TEMPLATE_ONLY' | 'SILENCE_MONDAY';

export interface LearningReflectionSummary {
  date: string;
  generatedAt: string;
  mode: ReflectionMode | null;
  dailyVerdict: DailyVerdict;
  narrativeLength: number;
  narrativePreview: string;
  keyLessonsCount: number;
  questionableDecisionsCount: number;
  tomorrowAdjustmentsCount: number;
  fiveWhyCount: number;
  personaReviewStressed: boolean | null;
  integrityRemovedCount: number;
  integrityParseFailed: boolean;
}

export interface LearningBudgetState {
  mode: ReflectionMode;
  monthly?: { used?: number; limit?: number };
  daily?: { used?: number; limit?: number };
}

export interface LearningExperimentProposal {
  id: string;
  state: string;
  hypothesis?: string;
  startedAt?: string;
}

export interface LearningBiasEntry {
  bias: string;
  avg?: number;
  recentScores?: number[];
}

export interface LearningStatusSnapshot {
  lastReflection: LearningReflectionSummary | null;
  consecutiveMissingDays: number;
  reflectionBudget: LearningBudgetState;
  biasHeatmapToday: { bias: string; score: number }[] | null;
  biasHeatmap7dAvg: LearningBiasEntry[];
  experimentProposalsActive: LearningExperimentProposal[];
  experimentProposalsCompletedRecent: LearningExperimentProposal[];
  tomorrowPriming: unknown;
  ghostPortfolioOpenCount: number;
  suggestAlerts7d: {
    counterfactual: number;
    ledger: number;
    kellySurface: number;
    regimeCoverage: number;
    total: number;
  };
  diagnostics: {
    healthy: boolean;
    warnings: string[];
  };
}

/** GET /api/learning/status */
export async function fetchLearningStatus(): Promise<LearningStatusSnapshot> {
  const res = await fetch('/api/learning/status');
  if (!res.ok) {
    throw new Error(`fetch /api/learning/status failed: ${res.status}`);
  }
  return (await res.json()) as LearningStatusSnapshot;
}
