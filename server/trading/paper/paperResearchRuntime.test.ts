// @responsibility Verify local-only archived research preserves source files and fails visibly on damaged archives.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPaperResearchSources } from './paperResearchSources.js';
import { loadResearchArchive, mergeResearchSeries, runArchivedPaperResearch } from './paperResearchRuntime.js';

const directories: string[] = [];
const temporary = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmp-research-')); directories.push(dir); return dir; };
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('research persistence', () => {
  it('archives valid daily points and news, reports inventory, and leaves every source byte unchanged', () => {
    const dir = temporary();
    const body = JSON.stringify({ chart: { result: [{ timestamp: [1770000000, 1770086400], indicators: { quote: [{ close: [100, null], high: [110, 120], low: [90, 95], volume: [0, 1000] }] } }] } });
    const chart = JSON.stringify({ version: 1, entries: [{ key: '005930.KS:1y:1d', entry: { body, fetchedAt: Date.parse('2026-09-01') } }] });
    const news = JSON.stringify([{ id: 'old', koreanStockCodes: ['005930.KS'], detectedAt: '2026-02-02T01:00:00Z', newsHeadline: '공시' }]);
    fs.writeFileSync(path.join(dir, 'offhours-snapshot.json'), chart);
    fs.writeFileSync(path.join(dir, 'news-supply-log.json'), news);
    const first = runArchivedPaperResearch(dir, '2026-09-12T00:00:00Z');
    expect(first.view.seriesCount).toBe(1);
    expect(first.view.newsCount).toBe(1);
    expect(loadResearchArchive(dir).series[0].closes).toHaveLength(1);
    expect(loadResearchArchive(dir).series[0]).toMatchObject({ market: 'KOSPI', closes: [{ close: 100, high: 110, low: 90, volume: 0 }] });
    expect(fs.readFileSync(path.join(dir, 'offhours-snapshot.json'), 'utf8')).toBe(chart);
    expect(fs.readFileSync(path.join(dir, 'news-supply-log.json'), 'utf8')).toBe(news);
    fs.writeFileSync(path.join(dir, 'news-supply-log.json'), '[]');
    expect(runArchivedPaperResearch(dir, '2026-09-13T00:00:00Z').view.newsCount).toBe(1);
    expect(fs.existsSync(path.join(dir, 'paper-research-report.json'))).toBe(true);
  });

  it('archives KIS index benchmarks retrieved before the research cutoff and reports their status', () => {
    const dir = temporary();
    const inventory = { file: 'KIS 지수 일봉(KOSPI·KOSDAQ)', records: 1, status: 'FOUND' as const };
    const series = (retrievedAt: string, close: number) => [{ id: 'kis-index:^KS11', symbol: '^KS11', market: 'KOSPI' as const,
      source: 'KIS_SNAPSHOT' as const, retrievedAt, closes: [{ date: '2026-09-11', close }] }];
    const first = runArchivedPaperResearch(dir, '2026-09-12T00:00:00Z', [], { series: series('2026-09-11T07:00:00Z', 3000), inventory });
    expect(first.view.benchmarkSeriesCount).toBe(1);
    expect(first.view.inventory).toContainEqual(inventory);
    runArchivedPaperResearch(dir, '2026-09-12T01:00:00Z', [], { series: series('2026-09-13T07:00:00Z', 1), inventory });
    expect(loadResearchArchive(dir).series.find((item) => item.symbol === '^KS11')?.closes[0].close).toBe(3000);
  });

  it('merges a symbol\'s overlapping snapshots once and keeps a re-based history separate', () => {
    const bar = (date: string, close: number) => ({ date, close });
    const snapshot = (id: string, retrievedAt: string, closes: Array<{ date: string; close: number }>, market?: 'KOSPI') =>
      ({ id, symbol: '005930', source: 'KIS_SNAPSHOT' as const, retrievedAt, closes, ...(market ? { market } : {}) });
    const older = snapshot('kis:005930:a', '2026-09-10T00:00:00Z', [bar('2026-09-07', 100), bar('2026-09-08', 101)], 'KOSPI');
    const newer = snapshot('kis:005930:b', '2026-09-11T00:00:00Z', [bar('2026-09-08', 101), bar('2026-09-09', 102)]);
    const rebased = snapshot('kis:005930:c', '2026-09-09T00:00:00Z', [bar('2026-09-07', 50), bar('2026-09-06', 49)]);
    const other = { ...snapshot('chart:005930:d', '2026-09-11T00:00:00Z', [bar('2026-09-08', 101)]), source: 'ARCHIVED_CHART' as const };
    const merged = mergeResearchSeries([older, newer, rebased, other, snapshot('kis:005930:e', '2026-09-12T00:00:00Z', [])]);
    expect(merged.map((item) => [item.id, item.retrievedAt, item.market, item.closes.map((value) => value.close)])).toEqual([
      ['kis:005930', '2026-09-11T00:00:00Z', 'KOSPI', [100, 101, 102]],
      ['kis:005930:c', '2026-09-09T00:00:00Z', undefined, [49, 50]],
      ['chart:005930', '2026-09-11T00:00:00Z', undefined, [101]],
    ]);
    // Idempotent: a merged archive plus the same inputs does not grow.
    expect(mergeResearchSeries([...merged, older, newer])).toEqual(merged);
  });

  it('stores one merged series per symbol in the persisted archive', () => {
    const dir = temporary();
    const bars = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({
      tradingDate: `2026-08-${String(from + i).padStart(2, '0')}`, close: 100 + from + i, availableAt: '2026-08-28T00:00:00Z' }));
    const experiment = (day: number, closes: ReturnType<typeof bars>) => ({ id: `e${day}`, symbol: '005930', entryAt: `2026-08-${day}T01:00:00Z`,
      entryObservation: { symbol: '005930', market: 'KOSPI', source: 'KIS_REST_REQUEST_OBSERVED', dailyCloses: closes } });
    // Completed experiments are read from their monthly file as well as the open file (ADR-0681).
    fs.writeFileSync(path.join(dir, 'paper-experiments.json'), JSON.stringify({ schemaVersion: 1, lastRun: null,
      experiments: [experiment(31, bars(5, 20))] }));
    fs.writeFileSync(path.join(dir, 'paper-experiments-completed-2026-08.json'), JSON.stringify({ schemaVersion: 1, month: '2026-08',
      experiments: [experiment(29, bars(3, 20)), experiment(30, bars(4, 20))] }));
    const { archivedBars } = runArchivedPaperResearch(dir, '2026-09-12T00:00:00Z');
    expect(archivedBars.has('005930|2026-08-03|103')).toBe(true);
    expect(archivedBars.has('005930|2026-08-03|104')).toBe(false);
    const series = loadResearchArchive(dir).series.filter((item) => item.symbol === '005930');
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ id: 'kis:005930', market: 'KOSPI' });
    expect(series[0].closes).toHaveLength(22);
    runArchivedPaperResearch(dir, '2026-09-13T00:00:00Z');
    expect(loadResearchArchive(dir).series.filter((item) => item.symbol === '005930')).toHaveLength(1);
  });

  it('reports missing and malformed source files without inventing successful samples', () => {
    const dir = temporary();
    fs.writeFileSync(path.join(dir, 'offhours-snapshot.json'), '{broken');
    const inputs = readPaperResearchSources(dir, '2026-09-13T00:00:00Z');
    expect(inputs.inventory.find((item) => item.file === 'offhours-snapshot.json')?.status).toBe('ERROR');
    expect(runArchivedPaperResearch(dir).view.sampleCount).toBe(0);
  });

  it('refuses to replace a damaged archive with an empty reconstruction', () => {
    const dir = temporary(); const file = path.join(dir, 'paper-research-archive.json');
    fs.writeFileSync(file, '{damaged');
    expect(() => runArchivedPaperResearch(dir)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('{damaged');
  });
});
