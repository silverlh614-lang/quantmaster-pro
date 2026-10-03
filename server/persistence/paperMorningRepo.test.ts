// @responsibility Verify durable morning recommendation provenance.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PaperMorningReport, PaperMorningSource } from '../../src/types/paperMorning.js';
import { adaptiveTestSnapshot, matureAdaptiveSamples } from '../trading/paper/paperAdaptiveFixtures.js';
import { selectPaperAdaptiveState } from '../trading/paper/paperAdaptiveSelection.js';
import { buildPaperMorningSelection } from '../trading/paper/paperMorningSelection.js';
import { previousKrxTradingDay } from '../calendar/krxTradingCalendar.js';

let repo: typeof import('./paperMorningRepo.js');
let temporaryRoot: string, testDataDir: string;
beforeAll(async () => {
  temporaryRoot = path.resolve(process.env.PERSIST_DATA_DIR ?? os.tmpdir());
  fs.mkdirSync(temporaryRoot, { recursive: true });
  testDataDir = fs.mkdtempSync(path.join(temporaryRoot, 'paper-morning-'));
  vi.stubEnv('PERSIST_DATA_DIR', testDataDir); vi.resetModules(); repo = await import('./paperMorningRepo.js');
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const name of fs.readdirSync(testDataDir)) {
    const target = path.resolve(testDataDir, name);
    if (path.dirname(target) !== testDataDir) throw new Error('Unexpected test cleanup target');
    fs.rmSync(target, { recursive: true, force: true });
  }
});
afterAll(() => {
  vi.unstubAllEnvs();
  if (testDataDir && path.dirname(path.resolve(testDataDir)) === temporaryRoot) fs.rmSync(testDataDir, { recursive: true, force: true });
});

function source(date = '2026-09-18', time = '08:15:00'): PaperMorningSource {
  const snapshot = adaptiveTestSnapshot();
  snapshot.id = `morning:${date}:${time}`; snapshot.tradingDate = date; snapshot.marketOpen = false;
  snapshot.asOf = new Date(`${date}T${time}+09:00`).toISOString();
  const item = snapshot.observations[0], previous = previousKrxTradingDay(new Date(snapshot.asOf));
  item.observedAt = new Date(Date.parse(snapshot.asOf) - 10_000).toISOString();
  item.features!.asOf = snapshot.asOf; item.features!.technicalDate = previous;
  item.features!.values.turnover20 = 100;
  item.dailyCloses = [{ tradingDate: previous, close: 10000, availableAt: `${previous}T06:30:00Z`,
    open: 9800, high: 10500, low: 9700, volume: 1234 }];
  return { version: 'morning-source-v1', snapshot,
    adaptive: selectPaperAdaptiveState(undefined, matureAdaptiveSamples(), snapshot.asOf), openSymbols: [] };
}
function report(input: PaperMorningSource | null, date = input?.snapshot.tradingDate ?? '2026-09-18'): PaperMorningReport {
  const selection = buildPaperMorningSelection(input, new Date(`${date}T08:30:00+09:00`));
  return { ...selection, message: `아침 추천 ${selection.picks.map(pick => pick.name).join(', ')} · ${selection.reason}` };
}
const reportFile = (date: string) => path.join(repo.PAPER_MORNING_REPORT_DIR, `${date}.json`);

describe('morning source cache', () => {
  it('retains last intraday reasons across restart and rejects after-hours overwrites', async () => {
    const input = source(); repo.savePaperMorningSource(input);
    const saved = repo.savePaperMorningReport(report(input));
    repo.markPaperMorningReportSent(saved.tradingDate, saved.createdAt, 123);
    const before = fs.readFileSync(reportFile(saved.tradingDate), 'utf8');
    const tracking = { reportId: saved.id, tradingDate: saved.tradingDate, asOf: '2026-09-18T01:00:00Z', snapshotId: 'intraday',
      decisions: [{ symbol: saved.picks[0].symbol, action: 'WAIT' as const, reason: '규칙 불일치', decisionAt: '2026-09-18T01:00:00Z' }] };
    repo.savePaperMorningTracking(tracking);
    repo.savePaperMorningTracking({ ...tracking, asOf: '2026-09-18T02:00:00Z', snapshotId: 'missing-symbol', decisions: [] });
    vi.resetModules(); repo = await import('./paperMorningRepo.js');
    expect(repo.loadPaperMorningTracking(saved.tradingDate)?.decisions).toEqual(tracking.decisions);
    expect(() => repo.savePaperMorningTracking({ ...tracking, asOf: '2026-09-18T07:00:00Z' })).toThrow('TRACKING_INVALID');
    expect(fs.readFileSync(reportFile(saved.tradingDate), 'utf8')).toBe(before);
    expect(() => repo.loadPaperMorningTracking('../invalid')).toThrow('DATE_INVALID');
  });
  it('round-trips the full compressed source through restart without stripping provider fields', async () => {
    expect(repo.loadPaperMorningSource()).toBeNull();
    const input = source(), original = structuredClone(input);
    repo.savePaperMorningSource(input);
    const bytes = fs.readFileSync(repo.PAPER_MORNING_SOURCE_FILE);
    expect(JSON.parse(gunzipSync(bytes).toString('utf8'))).toEqual(original);
    expect(input).toEqual(original);
    vi.resetModules(); repo = await import('./paperMorningRepo.js');
    const loaded = repo.loadPaperMorningSource()!;
    expect(loaded).toEqual(original);
    expect(loaded.snapshot.observations[0]).toMatchObject({ market: 'KOSPI', dailyCloses: [{ volume: 1234, high: 10500 }] });
    loaded.openSymbols.push('000660');
    loaded.snapshot.observations[0].dailyCloses[0].volume = 1;
    expect(repo.loadPaperMorningSource()).toEqual(original);
  });

  it('accepts the inclusive morning boundaries while preserving the cache outside the collection window', () => {
    for (const time of ['07:00:00', '08:30:00']) repo.savePaperMorningSource(source('2026-09-18', time));
    const before = fs.readFileSync(repo.PAPER_MORNING_SOURCE_FILE);
    for (const time of ['06:59:59', '08:30:00.001', '15:40:00']) repo.savePaperMorningSource(source('2026-09-18', time));
    expect(fs.readFileSync(repo.PAPER_MORNING_SOURCE_FILE)).toEqual(before);
    expect(repo.loadPaperMorningSource()!.snapshot.asOf).toBe('2026-09-17T23:30:00.000Z');
  });

  it('does not inspect unrelated daytime observations after checking the snapshot timestamp', () => {
    const input = source('2026-09-18', '10:00:00');
    Object.defineProperty(input.snapshot, 'observations', { get: () => { throw new Error('daytime observations accessed'); } });
    expect(() => repo.savePaperMorningSource(input)).not.toThrow();
    expect(repo.loadPaperMorningSource()).toBeNull();
    input.snapshot.asOf = 'not-a-time';
    expect(() => repo.savePaperMorningSource(input)).toThrow('PAPER_MORNING_INVALID');
  });

  it.each(['2026-09-18T01:00:00Z', 'invalid-provider-time'])('isolates a failed quote timestamp (%s) without dropping valid recommendations', observedAt => {
    const input = source();
    const failed = { ...structuredClone(input.snapshot.observations[0]), symbol: '000660', name: '시간 오류 종목',
      price: null, observedAt, issue: 'CURRENT_QUOTE_TIME_INVALID' };
    input.snapshot.observations.push(failed);
    repo.savePaperMorningSource(input);
    const loaded = repo.loadPaperMorningSource()!;
    expect(loaded.snapshot.observations[1]).toEqual(failed);
    const selected = report(loaded);
    expect(selected).toMatchObject({ status: 'READY', consideredCount: 1, picks: [{ symbol: '005930' }] });
    expect(repo.savePaperMorningReport(selected)).toEqual(selected);
    failed.features!.asOf = '2026-09-18T01:00:00Z';
    expect(() => repo.savePaperMorningSource(input)).toThrow('PAPER_MORNING_INVALID');
  });

  it('allows an identical retry but rejects older, same-time or reused-ID replacements', () => {
    const initial = source(); repo.savePaperMorningSource(initial);
    const before = fs.readFileSync(repo.PAPER_MORNING_SOURCE_FILE);
    repo.savePaperMorningSource(structuredClone(initial));
    const changed = structuredClone(initial); changed.openSymbols.push('000660');
    const reusedId = source('2026-09-18', '08:20:00'); reusedId.snapshot.id = initial.snapshot.id;
    for (const invalid of [source('2026-09-18', '08:00:00'), changed, reusedId]) {
      expect(() => repo.savePaperMorningSource(invalid)).toThrow('PAPER_MORNING_SOURCE_CONFLICT');
      expect(fs.readFileSync(repo.PAPER_MORNING_SOURCE_FILE)).toEqual(before);
    }
    const newer = source('2026-09-21'); repo.savePaperMorningSource(newer);
    expect(repo.loadPaperMorningSource()).toEqual(newer);
  });

  const corrupt: Array<[string, (input: PaperMorningSource) => void]> = [
    ['future observation', input => { input.snapshot.observations[0].observedAt = '2026-09-18T01:00:00Z'; }],
    ['future features', input => { input.snapshot.observations[0].features!.asOf = '2026-09-18T01:00:00Z'; }],
    ['future financial facts', input => { input.snapshot.observations[0].features!.financials = {
      symbol: '005930', observedAt: '2026-09-18T01:00:00Z', kis: null, dart: null, issues: [] }; }],
    ['future adaptive evaluation', input => { input.adaptive.evaluatedAt = '2026-09-18T01:00:00Z'; }],
    ['wrong snapshot date', input => { input.snapshot.tradingDate = '2026-09-17'; }],
    ['invalid provider volume', input => { input.snapshot.observations[0].dailyCloses[0].volume = -1; }],
    ['premature daily close', input => { input.snapshot.observations[0].dailyCloses[0].availableAt = '2026-09-17T05:00:00Z'; }],
    ['duplicate held symbols', input => { input.openSymbols = ['005930', '005930']; }],
    ['market-open morning source', input => { input.snapshot.marketOpen = true; }],
  ];
  it.each(corrupt)('rejects %s on external write and read', (_, mutate) => {
    const input = source(); mutate(input);
    expect(() => repo.savePaperMorningSource(input)).toThrow('PAPER_MORNING_INVALID');
    fs.writeFileSync(repo.PAPER_MORNING_SOURCE_FILE, gzipSync(JSON.stringify(input)));
    expect(() => repo.loadPaperMorningSource()).toThrow('PAPER_MORNING_INVALID');
  });

  it('does not overwrite corrupt compressed data or lose an earlier source when atomic writing fails', () => {
    fs.writeFileSync(repo.PAPER_MORNING_SOURCE_FILE, 'damaged gzip');
    expect(() => repo.savePaperMorningSource(source())).toThrow();
    expect(fs.readFileSync(repo.PAPER_MORNING_SOURCE_FILE, 'utf8')).toBe('damaged gzip');
    fs.unlinkSync(repo.PAPER_MORNING_SOURCE_FILE);
    repo.savePaperMorningSource(source());
    const before = fs.readFileSync(repo.PAPER_MORNING_SOURCE_FILE);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    expect(() => repo.savePaperMorningSource(source('2026-09-18', '08:20:00'))).toThrow('disk unavailable');
    expect(fs.readFileSync(repo.PAPER_MORNING_SOURCE_FILE)).toEqual(before);
    expect(fs.readdirSync(testDataDir)).toEqual(['paper-morning-source.json.gz']);
  });
});

describe('immutable morning recommendation archive', () => {
  it('returns independently owned reports without exposing caller or stored nested evidence', () => {
    const input = source(), expected = report(input); repo.savePaperMorningSource(input);
    const created = repo.savePaperMorningReport(expected);
    created.picks[0].referenceClose.volume = 1;
    expect(expected.picks[0].referenceClose.volume).toBe(1234);
    const loaded = repo.loadPaperMorningReport(expected.tradingDate)!;
    expect(loaded).toEqual(expected);
    loaded.picks[0].candidate.training.meanNetReturnPct = 999;
    expect(repo.loadPaperMorningReport(expected.tradingDate)).toEqual(expected);
    const sentAt = '2026-09-17T23:30:05Z';
    const sent = repo.markPaperMorningReportSent(expected.tradingDate, sentAt, 321);
    sent.picks[0].observation.dailyCloses[0].high = 99999;
    expect(repo.loadPaperMorningReport(expected.tradingDate)).toEqual({ ...expected, delivery: { sentAt, messageId: 321 } });
  });

  it('preserves the first full recommendation across restart, retries and a newer source day', async () => {
    const input = source(), expected = report(input); repo.savePaperMorningSource(input);
    expect(expected.status).toBe('READY');
    expect(repo.loadPaperMorningReport(expected.tradingDate)).toBeNull();
    expect(repo.savePaperMorningReport(expected)).toEqual(expected);
    const before = fs.readFileSync(reportFile(expected.tradingDate), 'utf8');
    vi.resetModules(); repo = await import('./paperMorningRepo.js');
    expect(repo.loadPaperMorningReport(expected.tradingDate)).toEqual(expected);
    expect(repo.savePaperMorningReport(structuredClone(expected))).toEqual(expected);
    expect(() => repo.savePaperMorningReport({ ...expected, message: 'changed recommendation' })).toThrow('PAPER_MORNING_REPORT_CONFLICT');
    repo.savePaperMorningSource(source('2026-09-21'));
    expect(repo.loadPaperMorningReport(expected.tradingDate)).toEqual(expected);
    expect(repo.savePaperMorningReport(expected)).toEqual(expected);
    expect(fs.readFileSync(reportFile(expected.tradingDate), 'utf8')).toBe(before);
    expect(expected.picks[0].referenceClose.volume).toBe(1234);
  });

  it('adds only confirmed delivery metadata, preserving the first acknowledgment', async () => {
    const expected = report(null); repo.savePaperMorningReport(expected);
    const sentAt = '2026-09-17T23:30:05Z';
    const sent = repo.markPaperMorningReportSent(expected.tradingDate, sentAt, 321);
    expect(sent).toEqual({ ...expected, delivery: { sentAt, messageId: 321 } });
    vi.resetModules(); repo = await import('./paperMorningRepo.js');
    expect(repo.markPaperMorningReportSent(expected.tradingDate, sentAt, 321)).toEqual(sent);
    expect(repo.savePaperMorningReport(expected)).toEqual(sent);
    const bytes = fs.readFileSync(reportFile(expected.tradingDate), 'utf8');
    expect(() => repo.markPaperMorningReportSent(expected.tradingDate, sentAt, 322)).toThrow('PAPER_MORNING_REPORT_ACK_CONFLICT');
    expect(fs.readFileSync(reportFile(expected.tradingDate), 'utf8')).toBe(bytes);
  });

  it('rejects an acknowledgment before creation, invalid message IDs, missing reports and injected initial ACKs', () => {
    const expected = report(null); repo.savePaperMorningReport(expected);
    expect(() => repo.markPaperMorningReportSent('2026-09-21', '2026-09-20T23:31:00Z', 1)).toThrow('PAPER_MORNING_REPORT_MISSING');
    expect(() => repo.markPaperMorningReportSent(expected.tradingDate, '2026-09-17T23:29:59Z', 1)).toThrow('PAPER_MORNING_INVALID');
    expect(() => repo.markPaperMorningReportSent(expected.tradingDate, expected.createdAt, 0)).toThrow('PAPER_MORNING_INVALID');
    const next = report(null, '2026-09-21'); next.delivery = { sentAt: next.createdAt, messageId: 1 };
    expect(() => repo.savePaperMorningReport(next)).toThrow('PAPER_MORNING_REPORT_ACK_REQUIRED');
  });

  it('archives holiday, missing, stale and insufficient morning evidence without inventing picks', () => {
    for (const expected of [report(null), report(null, '2026-09-19'), report(source('2026-09-18'), '2026-09-21')]) {
      expect(repo.savePaperMorningReport(expected)).toEqual(expected);
    }
    const input = source('2026-09-22'); input.snapshot.observations[0].features!.technicalDate = '2026-09-17';
    repo.savePaperMorningSource(input);
    const unavailable = report(input);
    expect(unavailable).toMatchObject({ status: 'DATA_UNAVAILABLE', picks: [], sourceSnapshotId: input.snapshot.id });
    expect(repo.savePaperMorningReport(unavailable)).toEqual(unavailable);
  });

  it('binds new recommendations to the cached cycle and rejects changed selection counts', () => {
    const input = source(), expected = report(input);
    expect(() => repo.savePaperMorningReport(expected)).toThrow('PAPER_MORNING_REPORT_SOURCE_MISMATCH');
    repo.savePaperMorningSource(input);
    const altered = structuredClone(expected); altered.consideredCount += 1;
    expect(() => repo.savePaperMorningReport(altered)).toThrow('PAPER_MORNING_REPORT_SOURCE_MISMATCH');
    expect(repo.loadPaperMorningReport(expected.tradingDate)).toBeNull();
    repo.savePaperMorningSource(source('2026-09-18', '08:20:00'));
    expect(() => repo.savePaperMorningReport(expected)).toThrow('PAPER_MORNING_REPORT_SOURCE_MISMATCH');
  });

  const alteredReport: Array<[string, (value: PaperMorningReport) => void]> = [
    ['future source', value => { value.sourceAsOf = '2026-09-18T01:00:00Z'; }],
    ['early creation', value => { value.createdAt = '2026-09-17T23:29:59Z'; }],
    ['wrong scheduled time', value => { value.scheduledAt = '2026-09-17T23:29:00Z'; }],
    ['wrong recommendation ID', value => { value.id = 'other'; }],
    ['mismatched quote symbol', value => { value.picks[0].observation.symbol = '000660'; }],
    ['fabricated rule value', value => { value.picks[0].ruleValue = 21; }],
    ['reference bar altered outside the observation', value => { value.picks[0].referenceClose.volume = 9876; }],
    ['future reference bar', value => { value.picks[0].referenceClose.availableAt = '2026-09-18T01:00:00Z'; }],
    ['different technical evidence date', value => { value.picks[0].observation.features!.technicalDate = '2026-09-16'; }],
    ['duplicate ranking', value => { value.picks[0].rank = 2; }],
  ];
  it.each(alteredReport)('rejects %s on archive write and read', (_, mutate) => {
    const input = source(), invalid = report(input); repo.savePaperMorningSource(input); mutate(invalid);
    expect(() => repo.savePaperMorningReport(invalid)).toThrow('PAPER_MORNING_INVALID');
    fs.mkdirSync(repo.PAPER_MORNING_REPORT_DIR, { recursive: true });
    fs.writeFileSync(reportFile(invalid.tradingDate), JSON.stringify(invalid));
    expect(() => repo.loadPaperMorningReport(invalid.tradingDate)).toThrow('PAPER_MORNING_INVALID');
  });

  it('rejects path traversal, impossible dates and a file assigned to the wrong day', () => {
    for (const date of ['../paper-strategy', '2026-02-30', '2026-9-18']) {
      expect(() => repo.loadPaperMorningReport(date)).toThrow('PAPER_MORNING_DATE_INVALID');
    }
    const expected = report(null); repo.savePaperMorningReport(expected);
    fs.copyFileSync(reportFile(expected.tradingDate), reportFile('2026-09-21'));
    expect(() => repo.loadPaperMorningReport('2026-09-21')).toThrow('PAPER_MORNING_REPORT_DATE_MISMATCH');
  });

  it('preserves corrupt archive bytes instead of reconstructing or acknowledging them', () => {
    const expected = report(null); repo.savePaperMorningReport(expected);
    fs.writeFileSync(reportFile(expected.tradingDate), '{broken');
    expect(() => repo.savePaperMorningReport(expected)).toThrow();
    expect(() => repo.markPaperMorningReportSent(expected.tradingDate, expected.createdAt, 1)).toThrow();
    expect(fs.readFileSync(reportFile(expected.tradingDate), 'utf8')).toBe('{broken');
  });
});
