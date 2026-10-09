// @responsibility Access independent Shadow experiment endpoints.
import { apiFetch } from './client';
import type { PaperExperimentView, PaperOverviewView, PaperScanResult } from '../types/paperExperiment';
import type { PaperStrategyScreenView, PaperStrategyTrade } from '../types/paperStrategy';
import type { PaperResearchView } from '../types/paperResearch';
import type { PaperMorningReview } from '../types/paperMorning';
import type { PaperAccountConfig, PaperAccountView } from '../types/paperAccount';

export const PAPER_EXPERIMENT_QUERY_KEY = ['paper-experiments'] as const;

export const paperExperimentApi = {
  getAccount: () => apiFetch<PaperAccountView>('/api/shadow/virtual-account'),
  startAccount: (config: PaperAccountConfig) => apiFetch<PaperAccountView>('/api/shadow/virtual-account', { method: 'POST', json: config }),
  pauseAccountBuys: (input: { id: string; paused: boolean }) => apiFetch<PaperAccountView>('/api/shadow/virtual-account/buys', { method: 'PATCH', json: input }),
  changeAccountWeight: (input: { id: string; maxPositionPct: number }) => apiFetch<PaperAccountView>('/api/shadow/virtual-account/weight', { method: 'PATCH', json: input }),
  getMorningReview: (date: string) => apiFetch<PaperMorningReview>('/api/shadow/morning-recommendation', { query: { date } }),
  getOverview: () => apiFetch<PaperOverviewView>('/api/shadow/experiments', { query: { section: 'overview' } }),
  getObservations: () => apiFetch<PaperExperimentView>('/api/shadow/experiments', { query: { section: 'observations' } }),
  getStrategy: () => apiFetch<PaperStrategyScreenView | null>('/api/shadow/experiments', { query: { section: 'strategy' } }),
  getStrategyTrades: (ids: string[]) => apiFetch<PaperStrategyTrade[]>('/api/shadow/strategy-trades', { query: { ids: ids.join(',') } }),
  getResearch: () => apiFetch<PaperResearchView | null>('/api/shadow/experiments', { query: { section: 'research' } }),
  getView: () => apiFetch<PaperExperimentView>('/api/shadow/experiments'),
  scan: () => apiFetch<PaperScanResult>('/api/shadow/experiments/scan', { method: 'POST' }),
};
