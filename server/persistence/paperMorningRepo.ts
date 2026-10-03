// @responsibility Persist immutable morning recommendations with source snapshots.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { PaperMorningReport, PaperMorningSource, PaperMorningTracking } from '../../src/types/paperMorning.js';
import { DATA_DIR } from './paths.js';
import { assertPaperMorningReport, assertPaperMorningSource, isPaperMorningSourceTime,
  paperMorningDateSchema, paperMorningTimestampSchema } from '../trading/paper/paperMorningValidation.js';
import { buildPaperMorningSelection } from '../trading/paper/paperMorningSelection.js';

export const PAPER_MORNING_SOURCE_FILE = path.join(DATA_DIR, 'paper-morning-source.json.gz');
export const PAPER_MORNING_REPORT_DIR = path.join(DATA_DIR, 'paper-morning-recommendations');

function atomicWrite(filename: string, bytes: string | Buffer, createOnly = false): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
    if (createOnly) fs.linkSync(temporary, filename);
    else fs.renameSync(temporary, filename);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function reportFile(date: string): string {
  if (!paperMorningDateSchema.safeParse(date).success) throw new Error('PAPER_MORNING_DATE_INVALID');
  return path.join(PAPER_MORNING_REPORT_DIR, `${date}.json`);
}

export function loadPaperMorningSource(): PaperMorningSource | null {
  if (!fs.existsSync(PAPER_MORNING_SOURCE_FILE)) return null;
  const source: unknown = JSON.parse(gunzipSync(fs.readFileSync(PAPER_MORNING_SOURCE_FILE)).toString('utf8'));
  assertPaperMorningSource(source);
  return source;
}

export function savePaperMorningSource(source: PaperMorningSource): void {
  if (!paperMorningTimestampSchema.safeParse(source?.snapshot?.asOf).success) throw new Error('PAPER_MORNING_INVALID: invalid snapshot time');
  if (!isPaperMorningSourceTime(source.snapshot.asOf)) return;
  assertPaperMorningSource(source);
  const serialized = JSON.stringify(source);
  const current = loadPaperMorningSource();
  if (current && (Date.parse(source.snapshot.asOf) <= Date.parse(current.snapshot.asOf) || source.snapshot.id === current.snapshot.id)) {
    if (isDeepStrictEqual(JSON.parse(serialized), current)) return;
    throw new Error('PAPER_MORNING_SOURCE_CONFLICT');
  }
  atomicWrite(PAPER_MORNING_SOURCE_FILE, gzipSync(serialized));
}

export function loadPaperMorningReport(date: string): PaperMorningReport | null {
  const filename = reportFile(date);
  if (!fs.existsSync(filename)) return null;
  const report: unknown = JSON.parse(fs.readFileSync(filename, 'utf8'));
  assertPaperMorningReport(report);
  if (report.tradingDate !== date) throw new Error('PAPER_MORNING_REPORT_DATE_MISMATCH');
  return report;
}

const content = ({ delivery: _delivery, ...report }: PaperMorningReport) => report;
function sameStoredReport(report: PaperMorningReport, stored: PaperMorningReport): PaperMorningReport {
  if (!isDeepStrictEqual(content(report), content(stored))
    || (report.delivery && !isDeepStrictEqual(report.delivery, stored.delivery))) throw new Error('PAPER_MORNING_REPORT_CONFLICT');
  return stored;
}

export function savePaperMorningReport(report: PaperMorningReport): PaperMorningReport {
  assertPaperMorningReport(report);
  const serialized = JSON.stringify(report);
  report = JSON.parse(serialized) as PaperMorningReport;
  const stored = loadPaperMorningReport(report.tradingDate);
  if (stored) return sameStoredReport(report, stored);
  if (report.delivery) throw new Error('PAPER_MORNING_REPORT_ACK_REQUIRED');
  const source = report.sourceSnapshotId === null ? null : loadPaperMorningSource();
  if (report.sourceSnapshotId !== null && source?.snapshot.id !== report.sourceSnapshotId) throw new Error('PAPER_MORNING_REPORT_SOURCE_MISMATCH');
  const { message: _message, delivery: _delivery, ...selection } = report;
  const expected = buildPaperMorningSelection(source, new Date(report.createdAt));
  // An unavailable source can have a more specific diagnostic than a missing cache.
  if (report.sourceSnapshotId === null) expected.reason = selection.reason;
  if (!isDeepStrictEqual(selection, expected)) {
    throw new Error('PAPER_MORNING_REPORT_SOURCE_MISMATCH');
  }
  try {
    atomicWrite(reportFile(report.tradingDate), serialized, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const raced = loadPaperMorningReport(report.tradingDate);
    if (!raced) throw error;
    return sameStoredReport(report, raced);
  }
  return report;
}

export function markPaperMorningReportSent(date: string, sentAt: string, messageId: number): PaperMorningReport {
  const report = loadPaperMorningReport(date);
  if (!report) throw new Error('PAPER_MORNING_REPORT_MISSING');
  const updated: PaperMorningReport = { ...report, delivery: { sentAt, messageId } };
  assertPaperMorningReport(updated);
  if (report.delivery) {
    if (!isDeepStrictEqual(report.delivery, updated.delivery)) throw new Error('PAPER_MORNING_REPORT_ACK_CONFLICT');
    return report;
  }
  atomicWrite(reportFile(date), JSON.stringify(updated));
  return updated;
}

const trackingSchema = z.object({ reportId: z.string().min(1), tradingDate: paperMorningDateSchema,
  asOf: paperMorningTimestampSchema, snapshotId: z.string().min(1), decisions: z.array(z.object({
    symbol: z.string().regex(/^\d{6}$/), action: z.enum(['BUY', 'WAIT', 'HOLD', 'EXIT']),
    reason: z.string().min(1).max(2000), decisionAt: paperMorningTimestampSchema,
  })).max(3) });
const trackingFile = (date: string) => reportFile(date).replace(/\.json$/, '.tracking.json');

export function loadPaperMorningTracking(date: string): PaperMorningTracking | null {
  const file = trackingFile(date);
  if (!fs.existsSync(file)) return null;
  const value = trackingSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  const report = loadPaperMorningReport(date);
  const open = Date.parse(`${date}T09:00:00+09:00`), close = Date.parse(`${date}T15:30:00+09:00`);
  if (value.tradingDate !== date || new Set(value.decisions.map(item => item.symbol)).size !== value.decisions.length
    || !report?.delivery || value.reportId !== report.id || Date.parse(value.asOf) < open || Date.parse(value.asOf) >= close
    || value.decisions.some(item => Date.parse(item.decisionAt) > Date.parse(value.asOf) || Date.parse(item.decisionAt) < open
      || Date.parse(item.decisionAt) < Date.parse(report.delivery!.sentAt) || Date.parse(item.decisionAt) < Date.parse(report.createdAt)
      || !report.picks.some(pick => pick.symbol === item.symbol))) throw new Error('PAPER_MORNING_TRACKING_INVALID');
  return value;
}

/** Only same-day intraday decisions after confirmed recommendation delivery become persistent follow-up evidence. */
export function savePaperMorningTracking(value: PaperMorningTracking): void {
  value = trackingSchema.parse(value);
  const report = loadPaperMorningReport(value.tradingDate);
  const at = Date.parse(value.asOf), open = Date.parse(`${value.tradingDate}T09:00:00+09:00`);
  const close = Date.parse(`${value.tradingDate}T15:30:00+09:00`);
  if (!report?.delivery || report.id !== value.reportId || at < open || at >= close
    || at < Date.parse(report.delivery.sentAt) || at < Date.parse(report.createdAt)
    || new Set(value.decisions.map(item => item.symbol)).size !== value.decisions.length
    || value.decisions.some(item => item.decisionAt !== value.asOf || !report.picks.some(pick => pick.symbol === item.symbol))) {
    throw new Error('PAPER_MORNING_TRACKING_INVALID');
  }
  const previous = loadPaperMorningTracking(value.tradingDate);
  if (previous && Date.parse(previous.asOf) >= at) {
    if (Date.parse(previous.asOf) === at && !isDeepStrictEqual(previous, value)) throw new Error('PAPER_MORNING_TRACKING_CONFLICT');
    return;
  }
  if (previous?.reportId === value.reportId) value.decisions = [...new Map([
    ...previous.decisions, ...value.decisions,
  ].map(item => [item.symbol, item])).values()];
  atomicWrite(trackingFile(value.tradingDate), JSON.stringify(value));
}
