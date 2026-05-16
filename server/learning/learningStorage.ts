// @responsibility Learning Flow Unclog Patch v1 append-only local storage helpers for diagnostics/proposals/runs
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';

function file(name: string): string { ensureDataDir(); return path.join(DATA_DIR, name); }
export function readJson<T>(name: string, fallback: T): T {
  try { const f = file(name); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) as T : fallback; } catch { return fallback; }
}
export function writeJson<T>(name: string, value: T): void { fs.writeFileSync(file(name), JSON.stringify(value, null, 2)); }
export function appendJson<T>(name: string, entry: T, max = 500): T[] {
  const arr = readJson<T[]>(name, []);
  arr.push(entry);
  const out = arr.slice(-max);
  writeJson(name, out);
  return out;
}
export const LEARNING_REPAIR_RUNS_FILE = 'learning_repair_runs.json';
export const LEARNING_INTEGRITY_EVENTS_FILE = 'learning_integrity_events.json';
export const ATTRIBUTION_BACKFILL_RUNS_FILE = 'attribution_backfill_runs.json';
export const SUGGEST_DIAGNOSTIC_PROPOSALS_FILE = 'suggest_diagnostic_proposals.json';
export const GEMINI_LEARNING_RUNS_FILE = 'gemini_learning_runs.json';
export const GHOST_CLOSE_RUNS_FILE = 'ghost_close_runs.json';
export const LEARNING_COHORT_BACKFILL_RUNS_FILE = 'learning_cohort_backfill_runs.json';
export const COUNTERFACTUAL_RESOLVE_SCHEDULER_FILE = 'counterfactual_resolve_scheduler.json';
