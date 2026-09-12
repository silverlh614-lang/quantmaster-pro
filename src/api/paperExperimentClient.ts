// @responsibility Access independent Shadow experiment endpoints.
import { apiFetch } from './client';
import type { PaperExperimentView, PaperScanResult } from '../types/paperExperiment';

export const PAPER_EXPERIMENT_QUERY_KEY = ['paper-experiments'] as const;

export const paperExperimentApi = {
  getView: () => apiFetch<PaperExperimentView>('/api/shadow/experiments'),
  scan: () => apiFetch<PaperScanResult>('/api/shadow/experiments/scan', { method: 'POST' }),
};
