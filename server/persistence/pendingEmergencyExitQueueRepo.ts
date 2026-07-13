// @responsibility Pending R6 emergency exit queue persistence for off-session LIVE-only rechecks
import fs from 'fs';
import {
  PENDING_EMERGENCY_EXIT_FILE,
  ensureDataDir,
} from './paths.js';

export interface PendingEmergencyExit {
  id: string;
  tradeId: string;
  stockCode: string;
  stockName: string;
  qty: number;
  currentPrice: number;
  returnPct: number;
  regime: string;
  reason: 'SESSION_GUARDED_R6_EMERGENCY_EXIT';
  guardReason: string;
  marketSessionState: string;
  isKrxTradingOpen: boolean;
  kisOrderAllowed: boolean;
  liveOrderAllowed: boolean;
  scheduledForNextOpen: true;
  liveOrderSent: false;
  executionImpact: 'NONE';
  createdAt: string;
}

function readQueue(): PendingEmergencyExit[] {
  try {
    if (!fs.existsSync(PENDING_EMERGENCY_EXIT_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(PENDING_EMERGENCY_EXIT_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed as PendingEmergencyExit[] : [];
  } catch (err) {
    console.warn('[PendingEmergencyExitQueue] read failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

function writeQueue(rows: PendingEmergencyExit[]): void {
  ensureDataDir();
  fs.writeFileSync(PENDING_EMERGENCY_EXIT_FILE, JSON.stringify(rows, null, 2));
}

export function appendPendingEmergencyExit(
  input: Omit<PendingEmergencyExit, 'id' | 'createdAt' | 'scheduledForNextOpen' | 'liveOrderSent' | 'executionImpact'> & {
    createdAt?: string;
  },
): PendingEmergencyExit {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const id = `${input.tradeId}:${input.stockCode}:R6_EMERGENCY_EXIT:${createdAt}`;
  const row: PendingEmergencyExit = {
    ...input,
    id,
    createdAt,
    scheduledForNextOpen: true,
    liveOrderSent: false,
    executionImpact: 'NONE',
  };

  const rows = readQueue();
  const duplicate = rows.some(existing =>
    existing.tradeId === row.tradeId &&
    existing.stockCode === row.stockCode &&
    existing.reason === row.reason &&
    existing.scheduledForNextOpen
  );
  if (!duplicate) {
    rows.push(row);
    writeQueue(rows);
  }
  return row;
}
