// @responsibility Manage the archived research lifecycle.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaperObservation } from '../../../src/types/paperExperiment.js';
import type { PaperResearchView, ResearchArchive, ResearchBar, ResearchInventory, ResearchSeries } from '../../../src/types/paperResearch.js';
import { DATA_DIR } from '../../persistence/paths.js';
import { getStockByCode } from '../../persistence/krxStockMasterRepo.js';
import { capturePaperCostModel, type ArchivedBarCheck } from './paperExperimentPolicy.js';
import { buildPaperResearch } from './paperResearch.js';
import { readPaperResearchSources, seriesFromObservations, paperResearchSourceFiles } from './paperResearchSources.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { getPaperIndexSeries } from './paperIndexCollection.js';

const archivePath = (directory: string) => path.join(directory, 'paper-research-archive.json');
const empty = (): ResearchArchive => ({ schemaVersion: 1, series: [], news: [], inventory: [] });
let cached: PaperResearchView | null = null;
// KIS stock bars confirmed in the last successfully written archive; entry copies of them may be trimmed.
let archivedBars: Set<string> | null = null;
const barKey = (symbol: string, date: string, close: number) => `${symbol}|${date}|${close}`;
let lastAttempt = 0;
let lastInputs: string | null = null;

function inputStamp(now: number): string {
  const files = [...paperResearchSourceFiles(DATA_DIR), 'paper-research-archive.json'];
  return JSON.stringify([toKstDateKey(new Date(now)), getPaperIndexSeries(), files.map(file => {
    const target = path.join(DATA_DIR, file);
    if (!fs.existsSync(target)) return [file, null];
    const stat = fs.statSync(target, { bigint: true });
    return [file, `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`];
  })]);
}

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

/**
 * Daily snapshots repeat most of a symbol's history. Same-source series of one symbol are merged when every
 * overlapping close agrees; a re-based (adjusted) or unverifiable history stays a separate series. Empty series are dropped.
 */
export function mergeResearchSeries(items: ResearchSeries[]): ResearchSeries[] {
  const groups = new Map<string, ResearchSeries[]>();
  for (const item of items) {
    // An empty series carries no price and only grows the archive.
    if (!item.closes.length) continue;
    const key = `${item.id.split(':')[0]}:${item.symbol}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const merged: ResearchSeries[] = [];
  for (const [key, members] of groups) {
    const bases: Array<{ item: ResearchSeries; bars: Map<string, ResearchBar> }> = [];
    const ordered = [...members].sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt)
      || b.closes.length - a.closes.length || a.id.localeCompare(b.id));
    for (const item of ordered) {
      const own = new Map<string, ResearchBar>();
      let selfConflict = false;
      for (const bar of item.closes) {
        if (own.has(bar.date) && own.get(bar.date)!.close !== bar.close) selfConflict = true;
        own.set(bar.date, bar);
      }
      // A series that disagrees with itself is kept verbatim so the reader still rejects those dates.
      if (selfConflict) { merged.push(item.id === key ? { ...item, id: `${key}:${item.retrievedAt}` } : item); continue; }
      const target = bases.find((base) => {
        let overlap = 0;
        for (const [date, bar] of own) {
          const known = base.bars.get(date);
          if (!known) continue;
          if (known.close !== bar.close) return false;
          overlap++;
        }
        return overlap > 0;
      });
      if (!target) { bases.push({ item, bars: own }); continue; }
      for (const [date, bar] of own) if (!target.bars.has(date)) target.bars.set(date, bar);
      if (!target.item.market && item.market) target.item = { ...target.item, market: item.market };
    }
    bases.forEach(({ item, bars }, index) => merged.push({ ...item,
      id: index === 0 ? key : item.id === key ? `${key}:${item.retrievedAt}` : item.id,
      closes: [...bars.values()].sort((a, b) => a.date.localeCompare(b.date)) }));
  }
  return merged;
}

export function runArchivedPaperResearch(directory = DATA_DIR, asOf = new Date().toISOString(), observations: PaperObservation[] = [],
  index: { series: ResearchSeries[]; inventory: ResearchInventory | null } = { series: [], inventory: null }) {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error('연구 기준 시각을 확인할 수 없습니다.');
  const previous = loadResearchArchive(directory);
  const inputs = readPaperResearchSources(directory, asOf);
  if (index.inventory) inputs.inventory.push(index.inventory);
  const series = new Map(previous.series.map((item) => [item.id, item]));
  const indexSeries = index.series.filter((item) => Date.parse(item.retrievedAt) <= Date.parse(asOf));
  for (const item of [...inputs.series, ...seriesFromObservations(observations, asOf), ...indexSeries]) {
    const stored = series.get(item.id);
    if (!stored || item.retrievedAt > stored.retrievedAt) series.set(item.id, item);
  }
  const news = new Map(previous.news.map((item) => [`${item.symbol}:${item.id}:${item.observedAt}`, item]));
  for (const item of inputs.news) news.set(`${item.symbol}:${item.id}:${item.observedAt}`, item);
  const archive: ResearchArchive = { schemaVersion: 1, series: mergeResearchSeries([...series.values()]), news: [...news.values()], inventory: inputs.inventory };
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
  const archived = new Set(archive.series.filter((item) => item.source === 'KIS_SNAPSHOT' && /^\d{6}$/.test(item.symbol))
    .flatMap((item) => item.closes.map((bar) => barKey(item.symbol, bar.date, bar.close))));
  // Derived, reviewable results contain no broker balances or credentials.
  const reportPath = path.join(directory, 'paper-research-report.json');
  const reportTemp = `${reportPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(reportTemp, JSON.stringify(result.view, null, 2), { flag: 'wx' });
    fs.renameSync(reportTemp, reportPath);
  } finally {
    if (fs.existsSync(reportTemp)) fs.unlinkSync(reportTemp);
  }
  return { ...result, archivedBars: archived };
}

export function refreshPaperResearch(observations: PaperObservation[] = [], force = false): void {
  const now = Date.now();
  if (!force && now - lastAttempt < (cached?.error ? 60_000 : 3_600_000)) return;
  lastAttempt = now;
  try {
    const inputs = inputStamp(now);
    if (!force && !observations.length && cached && !cached.error && inputs === lastInputs) return;
    const result = runArchivedPaperResearch(DATA_DIR, new Date(now).toISOString(), observations, getPaperIndexSeries());
    cached = result.view;
    archivedBars = result.archivedBars;
    lastInputs = inputStamp(now);
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PaperResearch]', message);
    const view = cached ?? buildPaperResearch(empty(), new Date(now).toISOString(), () => capturePaperCostModel('KOSPI')).view;
    cached = { ...view, error: message };
  }
}

/** Null until an archive write succeeds in this process, so nothing is trimmed on unverified data. */
export function getArchivedPaperBarCheck(): ArchivedBarCheck | null {
  const bars = archivedBars;
  return bars ? (symbol, date, close) => bars.has(barKey(symbol, date, close)) : null;
}

export function getPaperResearchView(): PaperResearchView | undefined { return cached ?? undefined; }
