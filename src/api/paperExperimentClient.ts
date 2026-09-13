// @responsibility Access independent Shadow experiment endpoints.
import { apiFetch } from './client';
import type { PaperExperimentView, PaperOverviewView, PaperScanResult } from '../types/paperExperiment';
import type { PaperStrategyView } from '../types/paperStrategy';
import type { PaperResearchView } from '../types/paperResearch';

export const PAPER_EXPERIMENT_QUERY_KEY = ['paper-experiments'] as const;

export const paperExperimentApi = {
  getOverview: () => apiFetch<PaperOverviewView>('/api/shadow/experiments', { query: { section: 'overview' } }),
  getObservations: () => apiFetch<PaperExperimentView>('/api/shadow/experiments', { query: { section: 'observations' } }),
  getStrategy: () => apiFetch<PaperStrategyView | null>('/api/shadow/experiments', { query: { section: 'strategy' } }),
  getResearch: () => apiFetch<PaperResearchView | null>('/api/shadow/experiments', { query: { section: 'research' } }),
  getView: () => apiFetch<PaperExperimentView>('/api/shadow/experiments'),
  scan: () => apiFetch<PaperScanResult>('/api/shadow/experiments/scan', { method: 'POST' }),
};
