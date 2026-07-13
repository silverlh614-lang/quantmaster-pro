// @responsibility DART 선행공시 스캐너 설정값 제공
import type { DartPreNewsStage } from './dartPreNewsTypes.js';

export interface DartPreNewsConfig {
  lookbackDays: number;
  maxDisclosuresPerRun: number;
  fetchBody: boolean;
  enableAiInterpretation: boolean;
  maxCandidatesForAiInterpretation: number;
  allowedStages: DartPreNewsStage[];
  includeRiskDisclosures: boolean;
  includePositiveDisclosures: boolean;
  minCatalystScoreForAdvisory: number;
  minRiskScoreForRiskAlert: number;
}

const DEFAULT_DART_PRE_NEWS_CONFIG: DartPreNewsConfig = {
  lookbackDays: 3,
  maxDisclosuresPerRun: 100,
  fetchBody: true,
  enableAiInterpretation: false,
  maxCandidatesForAiInterpretation: 20,
  allowedStages: ['OBSERVE', 'SHADOW_SCORE', 'ADVISORY'],
  includeRiskDisclosures: true,
  includePositiveDisclosures: true,
  minCatalystScoreForAdvisory: 60,
  minRiskScoreForRiskAlert: 60,
};

export function normalizeDartPreNewsConfig(input: Partial<DartPreNewsConfig> = {}): DartPreNewsConfig {
  const cfg = { ...DEFAULT_DART_PRE_NEWS_CONFIG, ...input };
  const allowed = cfg.allowedStages.filter((s) => s === 'OBSERVE' || s === 'SHADOW_SCORE' || s === 'ADVISORY');
  return {
    ...cfg,
    lookbackDays: Math.max(1, Math.min(30, Math.floor(cfg.lookbackDays))),
    maxDisclosuresPerRun: Math.max(1, Math.min(500, Math.floor(cfg.maxDisclosuresPerRun))),
    maxCandidatesForAiInterpretation: Math.max(0, Math.min(50, Math.floor(cfg.maxCandidatesForAiInterpretation))),
    allowedStages: allowed.length > 0 ? allowed : DEFAULT_DART_PRE_NEWS_CONFIG.allowedStages,
    minCatalystScoreForAdvisory: Math.max(0, Math.min(100, cfg.minCatalystScoreForAdvisory)),
    minRiskScoreForRiskAlert: Math.max(0, Math.min(100, cfg.minRiskScoreForRiskAlert)),
  };
}

export function getDartApiKey(): string | null {
  return process.env.DART_API_KEY || process.env.OPENDART_API_KEY || null;
}
