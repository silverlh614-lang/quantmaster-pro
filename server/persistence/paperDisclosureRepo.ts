// @responsibility Preserve first-observed disclosure records for Shadow research.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from './paths.js';
import type { DartDisclosureRow } from '../clients/dartDisclosureClient.js';
import type { PaperDisclosureStatus } from '../../src/types/paperNewsFacts.js';

export interface PaperDisclosureRecord extends DartDisclosureRow { symbol: string | null; linkedAt: string | null; linkMethod: string }
export interface PaperDisclosureLedger { schemaVersion: 1; records: PaperDisclosureRecord[]; status: PaperDisclosureStatus | null }
const target = (directory: string) => path.join(directory, 'paper-disclosures.json');
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function loadPaperDisclosures(directory = DATA_DIR): PaperDisclosureLedger {
  if (!fs.existsSync(target(directory))) return { schemaVersion: 1, records: [], status: null };
  const value = JSON.parse(fs.readFileSync(target(directory), 'utf8')) as PaperDisclosureLedger;
  if (value?.schemaVersion !== 1 || !Array.isArray(value.records) || value.records.some(item => !item
    || !/^\d{14}$/.test(item.receiptNo) || !Number.isFinite(Date.parse(item.firstSeenAt))
    || !['Y', 'K'].includes(item.market) || typeof item.title !== 'string' || !item.title.trim() || !validDate(item.filedDate)
    || !/^\d{8}$/.test(item.corpCode) || typeof item.corpName !== 'string' || !item.corpName.trim()
    || typeof item.stockCode !== 'string' || typeof item.linkMethod !== 'string'
    || item.symbol !== null && (!/^\d{6}$/.test(item.symbol) || item.symbol === '000000')
    || (item.symbol === null) !== (item.linkedAt === null)
    || item.linkedAt !== null && !(Date.parse(item.linkedAt) >= Date.parse(item.firstSeenAt))
    || Date.parse(`${item.filedDate}T00:00:00+09:00`) > Date.parse(item.firstSeenAt))
    || new Set(value.records.map(item => item.receiptNo)).size !== value.records.length
    || value.status !== null && (!value.status || !['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(value.status.state)
      || !Number.isFinite(Date.parse(value.status.checkedAt)) || !validDate(value.status.fromDate) || !validDate(value.status.toDate)
      || ![value.status.pages, value.status.fetchedCount, value.status.linkedCount, value.status.unlinkedCount].every(n => Number.isSafeInteger(n) && n >= 0))) {
    throw new Error('공시 관측 원장 형식 오류');
  }
  return value;
}
export function savePaperDisclosures(ledger: PaperDisclosureLedger, directory = DATA_DIR): void {
  loadPaperDisclosures(directory); // Preserve a damaged original for diagnosis.
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${target(directory)}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(ledger), { flag: 'wx' });
    fs.renameSync(temporary, target(directory));
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
