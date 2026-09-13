// @responsibility Manage the archived research lifecycle.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaperObservation } from '../../../src/types/paperExperiment.js';
import type { HistoricalPaperSample, PaperResearchView, ResearchArchive } from '../../../src/types/paperResearch.js';
import { DATA_DIR } from '../../persistence/paths.js';
import { getStockByCode } from '../../persistence/krxStockMasterRepo.js';
import { capturePaperCostModel } from './paperExperimentPolicy.js';
import { buildPaperResearch } from './paperResearch.js';
import { readPaperResearchSources, seriesFromObservations } from './paperResearchSources.js';

const archivePath = (directory: string) => path.join(directory, 'paper-research-archive.json');
const empty = (): ResearchArchive => ({ schemaVersion: 1, series: [], news: [], inventory: [] });
let cached: { samples: HistoricalPaperSample[]; view: PaperResearchView } | null = null;
let lastAttempt = 0;

export function loadResearchArchive(directory: string): ResearchArchive {
  const file = archivePath(directory);
  if (!fs.existsSync(file)) return empty();
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as ResearchArchive;
  if (value?.schemaVersion !== 1 || !Array.isArray(value.series) || !Array.isArray(value.news) || !Array.isArray(value.inventory)
    || value.series.some((item) => !item || typeof item.id !== 'string' || typeof item.symbol !== 'string'
      || !['KIS_SNAPSHOT', 'ARCHIVED_CHART'].includes(item.source) || typeof item.retrievedAt !== 'string'
      || item.market !== undefined && !['KOSPI', 'KOSDAQ'].includes(item.market)
      || !Array.isArray(item.closes) || item.closes.some((bar) => !bar || typeof bar.date !== 'string' || !Number.isFinite(bar.close)
        || ['open', 'high', 'low', 'volume'].some((key) => {
          const field = bar[key as 'open' | 'high' | 'low' | 'volume'];
          return field !== undefined && (!Number.isFinite(field) || (key === 'volume' ? field < 0 : field <= 0));
        })))
    || value.news.some((item) => !item || typeof item.id !== 'string' || typeof item.symbol !== 'string'
      || typeof item.observedAt !== 'string' || typeof item.headline !== 'string')) {
    throw new Error('과거 연구 원장 형식이 올바르지 않습니다. 원본을 보존했습니다.');
  }
  return value;
}

export function runArchivedPaperResearch(directory = DATA_DIR, asOf = new Date().toISOString(), observations: PaperObservation[] = []) {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error('연구 기준 시각을 확인할 수 없습니다.');
  const previous = loadResearchArchive(directory);
  const inputs = readPaperResearchSources(directory, asOf);
  const series = new Map(previous.series.map((item) => [item.id, item]));
  for (const item of [...inputs.series, ...seriesFromObservations(observations, asOf)]) {
    const stored = series.get(item.id);
    if (!stored || item.retrievedAt > stored.retrievedAt) series.set(item.id, item);
  }
  const news = new Map(previous.news.map((item) => [`${item.symbol}:${item.id}:${item.observedAt}`, item]));
  for (const item of inputs.news) news.set(`${item.symbol}:${item.id}:${item.observedAt}`, item);
  const archive: ResearchArchive = { schemaVersion: 1, series: [...series.values()], news: [...news.values()], inventory: inputs.inventory };
  const result = buildPaperResearch(archive, asOf, (symbol) =>
    capturePaperCostModel(getStockByCode(symbol)?.market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI'));
  fs.mkdirSync(directory, { recursive: true });
  const target = archivePath(directory);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(archive)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  // Derived, reviewable results contain no broker balances or credentials.
  const reportPath = path.join(directory, 'paper-research-report.json');
  const reportTemp = `${reportPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(reportTemp, JSON.stringify(result.view, null, 2), { flag: 'wx' });
    fs.renameSync(reportTemp, reportPath);
  } finally {
    if (fs.existsSync(reportTemp)) fs.unlinkSync(reportTemp);
  }
  return result;
}

export function refreshPaperResearch(observations: PaperObservation[] = [], force = false): void {
  const now = Date.now();
  if (!force && now - lastAttempt < (cached?.view.error ? 60_000 : 3_600_000)) return;
  lastAttempt = now;
  try { cached = runArchivedPaperResearch(DATA_DIR, new Date(now).toISOString(), observations); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PaperResearch]', message);
    const result = cached ?? buildPaperResearch(empty(), new Date(now).toISOString(), () => capturePaperCostModel('KOSPI'));
    cached = { samples: result.samples, view: { ...result.view, error: message } };
  }
}

export function getHistoricalPaperSamples(): HistoricalPaperSample[] { return cached?.view.error ? [] : cached?.samples ?? []; }
export function getPaperResearchView(): PaperResearchView | undefined { return cached?.view; }
