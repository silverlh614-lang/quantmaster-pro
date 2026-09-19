// @responsibility Verify financial cache durability and damaged-file preservation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPaperFinancialCache, savePaperFinancialCache } from './paperFinancialRepo.js';
const directories: string[] = [];
const directory = () => { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-financial-test-')); directories.push(value); return value; };
afterEach(() => { for (const value of directories.splice(0)) fs.rmSync(value, { recursive: true, force: true }); });
describe('financial observation cache', () => {
  it('round-trips independent provider metadata and zero values', () => {
    const dir = directory();
    const cache = loadPaperFinancialCache(dir);
    cache.records['005930'] = { attemptedAt: '2026-09-19T01:00:00Z', facts: {
      symbol: '005930', observedAt: '2026-09-19T01:00:00Z', kis: null,
      dart: { period: '2026Q2', statement: 'CFS', equityRatio: -1, operatingCashFlowSign: 0 }, issues: [] } };
    savePaperFinancialCache(cache, dir);
    expect(loadPaperFinancialCache(dir)).toEqual(cache);
  });
  it('refuses to replace a damaged cache', () => {
    const dir = directory(), file = path.join(dir, 'paper-financials.json');
    fs.writeFileSync(file, 'damaged');
    expect(() => savePaperFinancialCache({ schemaVersion: 1, records: {} }, dir)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('damaged');
  });
});
