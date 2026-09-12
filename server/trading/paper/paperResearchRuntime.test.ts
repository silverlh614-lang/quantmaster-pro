// @responsibility Verify local-only archived research preserves source files and fails visibly on damaged archives.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPaperResearchSources } from './paperResearchSources.js';
import { loadResearchArchive, runArchivedPaperResearch } from './paperResearchRuntime.js';

const directories: string[] = [];
const temporary = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmp-research-')); directories.push(dir); return dir; };
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('research persistence', () => {
  it('archives valid daily points and news, reports inventory, and leaves every source byte unchanged', () => {
    const dir = temporary();
    const body = JSON.stringify({ chart: { result: [{ timestamp: [1770000000, 1770086400], indicators: { quote: [{ close: [100, null] }] } }] } });
    const chart = JSON.stringify({ version: 1, entries: [{ key: '005930.KS:1y:1d', entry: { body, fetchedAt: Date.parse('2026-09-01') } }] });
    const news = JSON.stringify([{ id: 'old', koreanStockCodes: ['005930.KS'], detectedAt: '2026-02-02T01:00:00Z', newsHeadline: '공시' }]);
    fs.writeFileSync(path.join(dir, 'offhours-snapshot.json'), chart);
    fs.writeFileSync(path.join(dir, 'news-supply-log.json'), news);
    const first = runArchivedPaperResearch(dir, '2026-09-12T00:00:00Z');
    expect(first.view.seriesCount).toBe(1);
    expect(first.view.newsCount).toBe(1);
    expect(loadResearchArchive(dir).series[0].closes).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, 'offhours-snapshot.json'), 'utf8')).toBe(chart);
    expect(fs.readFileSync(path.join(dir, 'news-supply-log.json'), 'utf8')).toBe(news);
    fs.writeFileSync(path.join(dir, 'news-supply-log.json'), '[]');
    expect(runArchivedPaperResearch(dir, '2026-09-13T00:00:00Z').view.newsCount).toBe(1);
    expect(fs.existsSync(path.join(dir, 'paper-research-report.json'))).toBe(true);
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
