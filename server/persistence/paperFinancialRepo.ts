// @responsibility Persist bounded financial enrichment independently of observation ledgers.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from './paths.js';
import type { PaperFinancialFacts } from '../../src/types/paperObservationFeatures.js';

export interface PaperFinancialCache {
  schemaVersion: 1;
  records: Record<string, { attemptedAt: string; facts: PaperFinancialFacts }>;
}
const target = (directory: string) => path.join(directory, 'paper-financials.json');
export function loadPaperFinancialCache(directory = DATA_DIR): PaperFinancialCache {
  if (!fs.existsSync(target(directory))) return { schemaVersion: 1, records: {} };
  const value = JSON.parse(fs.readFileSync(target(directory), 'utf8')) as PaperFinancialCache;
  if (value?.schemaVersion !== 1 || !value.records || Array.isArray(value.records)
    || Object.entries(value.records).some(([symbol, row]) => !/^\d{6}$/.test(symbol)
      || !row?.facts || row.facts.symbol !== symbol || !Number.isFinite(Date.parse(row.attemptedAt))
      || !Number.isFinite(Date.parse(row.facts.observedAt)) || !Array.isArray(row.facts.issues))) {
    throw new Error('재무 관측 캐시 형식 오류');
  }
  return value;
}
export function savePaperFinancialCache(cache: PaperFinancialCache, directory = DATA_DIR): void {
  loadPaperFinancialCache(directory);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${target(directory)}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(cache), { flag: 'wx' });
    fs.renameSync(temporary, target(directory));
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
