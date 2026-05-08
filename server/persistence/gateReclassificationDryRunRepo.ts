/**
 * @responsibility ADR-458 Gate Reclassification Dry-Run Ledger — shadow-only diagnostic persistence.
 *
 * APPROVED 재분류 항목의 dry-run 결과만 저장한다. 외부 API/KIS 주문 API 호출 없이
 * atomic write, 손상 JSON fallback, FIFO trim 을 제공한다.
 */
import fs from 'fs';
import { ensureDataDir, GATE_RECLASSIFICATION_DRY_RUN_FILE } from './paths.js';
import type {
  GateReclassificationDryRunDecision,
  GateReclassificationDryRunResult,
} from '../learning/gateReclassificationDryRun.js';

export const GATE_RECLASSIFICATION_DRY_RUN_MAX_RECORDS = 2_000;

export interface GateReclassificationDryRunRecord extends GateReclassificationDryRunResult {
  id: string;
  observedAt: string;
  observedDateKst: string;
  status: 'RECORDED' | 'OUTCOME_PENDING' | 'OUTCOME_EVALUATED';
}

export function buildGateReclassificationDryRunId(
  code: string,
  observedDateKst: string,
  dryRunDecision: GateReclassificationDryRunDecision,
): string {
  const safeCode = code.replace(/[^0-9A-Za-z_-]/g, '_');
  return `${safeCode}__${observedDateKst}__${dryRunDecision}`;
}

export function loadGateReclassificationDryRunRecords(): GateReclassificationDryRunRecord[] {
  ensureDataDir();
  if (!fs.existsSync(GATE_RECLASSIFICATION_DRY_RUN_FILE)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(GATE_RECLASSIFICATION_DRY_RUN_FILE, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as GateReclassificationDryRunRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveGateReclassificationDryRunRecords(records: GateReclassificationDryRunRecord[]): void {
  ensureDataDir();
  const trimmed = records.slice(-GATE_RECLASSIFICATION_DRY_RUN_MAX_RECORDS);
  const tmp = `${GATE_RECLASSIFICATION_DRY_RUN_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2));
  fs.renameSync(tmp, GATE_RECLASSIFICATION_DRY_RUN_FILE);
}

export function upsertGateReclassificationDryRunRecord(record: GateReclassificationDryRunRecord): void {
  const records = loadGateReclassificationDryRunRecords();
  const key = `${record.code}|${record.observedDateKst}|${record.dryRunDecision}`;
  const index = records.findIndex((item) => `${item.code}|${item.observedDateKst}|${item.dryRunDecision}` === key);

  if (index >= 0) records[index] = record;
  else records.push(record);

  saveGateReclassificationDryRunRecords(records);
}
