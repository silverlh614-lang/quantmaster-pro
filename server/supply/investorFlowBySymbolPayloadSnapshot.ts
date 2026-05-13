// @responsibility Diagnostic-only sanitized by-symbol investor-flow payload snapshot cache; no live scoring/order impact.
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';

export type SanitizedInvestorFlowRow = Record<string, unknown>;
export type SupplyBySymbolProviderScope = 'SYMBOL_LEVEL' | 'MARKET_LEVEL' | 'SECTOR_LEVEL' | 'UNKNOWN';

export interface SupplyBySymbolPayloadSnapshotEntry {
  symbol: string;
  providerScope: SupplyBySymbolProviderScope;
  actualInvestorFlowRows?: SanitizedInvestorFlowRow[];
  actualInvestorRow?: Record<string, unknown>;
  normalizedInvestorRow?: Record<string, unknown>;
  semanticInvestorRow?: Record<string, unknown>;
  supplySemanticRow?: Record<string, unknown>;
  actualInvestorFlowRowCount?: number;
  actualInvestorFlowFieldKeys?: string[];
  actualInvestorFlowNumericKeys?: string[];
  actualInvestorFlowNumericStringKeys?: string[];
  materialized?: boolean;
  usableForRouter?: boolean;
  usableForGate?: false;
  usableForLive?: false;
  usableForShadow?: true;
  executionImpact: 'NONE';
}

export interface SupplyBySymbolPayloadSnapshot {
  tradeDate: string;
  capturedAt: string;
  selectedProvider: string;
  bySymbol: Record<string, SupplyBySymbolPayloadSnapshotEntry>;
}

export interface SupplyBySymbolPayloadLookupResult {
  payload: SupplyBySymbolPayloadSnapshotEntry | null;
  snapshot: SupplyBySymbolPayloadSnapshot | null;
  stale: boolean;
  diagnosticAvailable: boolean;
  scoreUsage: 'SHADOW_ONLY';
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  reason: 'FOUND' | 'STALE' | 'MISSING';
}

const STORE_FILE = path.join(DATA_DIR, 'supply-by-symbol-payload-snapshots.json');
const DEFAULT_MAX_SNAPSHOTS = 20;
const DEFAULT_MAX_AGE_MINUTES = 240;
const SECRET_KEY_PATTERN = /(token|secret|account|acct|authorization|auth|cookie|appkey|appsecret|password|passwd|api[_-]?key|private)/i;
let memorySnapshots: SupplyBySymbolPayloadSnapshot[] = [];

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value);
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? digits.slice(-6) : digits || raw.trim() || null;
}

function kstTradeDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  return new Date(ms + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

function sanitizeScalar(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

function sanitizeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    const scalar = sanitizeScalar(raw);
    if (scalar !== undefined) out[key] = scalar;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === 'string' && !SECRET_KEY_PATTERN.test(item)).slice(0, 80);
  return out.length > 0 ? Array.from(new Set(out)) : undefined;
}

function providerScope(value: unknown): SupplyBySymbolProviderScope {
  return value === 'SYMBOL_LEVEL' || value === 'MARKET_LEVEL' || value === 'SECTOR_LEVEL' || value === 'UNKNOWN' ? value : 'UNKNOWN';
}

function sanitizeEntry(symbol: string, raw: Record<string, unknown>): SupplyBySymbolPayloadSnapshotEntry | null {
  const actualRows = Array.isArray(raw.actualInvestorFlowRows)
    ? raw.actualInvestorFlowRows.map(sanitizeRecord).filter((row): row is Record<string, unknown> => Boolean(row)).slice(0, 10)
    : [];
  const actualInvestorRow = sanitizeRecord(raw.actualInvestorRow) ?? actualRows[0];
  const normalizedInvestorRow = sanitizeRecord(raw.normalizedInvestorRow);
  const semanticInvestorRow = sanitizeRecord(raw.semanticInvestorRow);
  const supplySemanticRow = sanitizeRecord(raw.supplySemanticRow);
  const entry: SupplyBySymbolPayloadSnapshotEntry = {
    symbol,
    providerScope: providerScope(raw.providerScope),
    ...(actualRows.length > 0 ? { actualInvestorFlowRows: actualRows } : {}),
    ...(actualInvestorRow ? { actualInvestorRow } : {}),
    ...(normalizedInvestorRow ? { normalizedInvestorRow } : {}),
    ...(semanticInvestorRow ? { semanticInvestorRow } : {}),
    ...(supplySemanticRow ? { supplySemanticRow } : {}),
    ...(typeof raw.actualInvestorFlowRowCount === 'number' ? { actualInvestorFlowRowCount: raw.actualInvestorFlowRowCount } : actualRows.length > 0 ? { actualInvestorFlowRowCount: actualRows.length } : {}),
    ...(stringArray(raw.actualInvestorFlowFieldKeys) ? { actualInvestorFlowFieldKeys: stringArray(raw.actualInvestorFlowFieldKeys) } : {}),
    ...(stringArray(raw.actualInvestorFlowNumericKeys) ? { actualInvestorFlowNumericKeys: stringArray(raw.actualInvestorFlowNumericKeys) } : {}),
    ...(stringArray(raw.actualInvestorFlowNumericStringKeys) ? { actualInvestorFlowNumericStringKeys: stringArray(raw.actualInvestorFlowNumericStringKeys) } : {}),
    ...(typeof raw.materialized === 'boolean' ? { materialized: raw.materialized } : {}),
    ...(typeof raw.usableForRouter === 'boolean' ? { usableForRouter: raw.usableForRouter } : {}),
    usableForGate: false,
    usableForLive: false,
    usableForShadow: true,
    executionImpact: 'NONE',
  };
  return actualRows.length > 0 || actualInvestorRow || normalizedInvestorRow || semanticInvestorRow || supplySemanticRow ? entry : null;
}

function readStore(): SupplyBySymbolPayloadSnapshot[] {
  if (memorySnapshots.length > 0) return memorySnapshots;
  try {
    if (!fs.existsSync(STORE_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    memorySnapshots = parsed.filter((item): item is SupplyBySymbolPayloadSnapshot => Boolean(item && typeof item === 'object' && (item as SupplyBySymbolPayloadSnapshot).bySymbol));
    return memorySnapshots;
  } catch {
    return [];
  }
}

function writeStore(snapshots: SupplyBySymbolPayloadSnapshot[]): void {
  memorySnapshots = snapshots;
  ensureDataDir();
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshots, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

export function clearSupplyBySymbolPayloadSnapshotsForTest(): void {
  memorySnapshots = [];
  try { if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE); } catch { /* test cleanup best effort */ }
}

export function buildSupplyBySymbolPayloadSnapshot(input: {
  routeResult?: { selectedProvider?: string; bySymbol?: Record<string, Record<string, unknown>> } | null;
  tradeDate?: string;
  capturedAt?: string;
}): SupplyBySymbolPayloadSnapshot | null {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const bySymbolRaw = input.routeResult?.bySymbol;
  if (!bySymbolRaw || typeof bySymbolRaw !== 'object') return null;
  const bySymbol: Record<string, SupplyBySymbolPayloadSnapshotEntry> = {};
  for (const [key, raw] of Object.entries(bySymbolRaw)) {
    if (!raw || typeof raw !== 'object') continue;
    const symbol = normalizeSymbol((raw as Record<string, unknown>).symbol ?? (raw as Record<string, unknown>).code ?? key);
    if (!symbol) continue;
    const entry = sanitizeEntry(symbol, raw as Record<string, unknown>);
    if (entry) bySymbol[symbol] = entry;
  }
  if (Object.keys(bySymbol).length === 0) return null;
  return {
    tradeDate: input.tradeDate ?? kstTradeDate(capturedAt),
    capturedAt,
    selectedProvider: input.routeResult?.selectedProvider ?? 'UNKNOWN',
    bySymbol,
  };
}

export function rememberSupplyBySymbolPayloadSnapshot(input: {
  routeResult?: { selectedProvider?: string; bySymbol?: Record<string, Record<string, unknown>> } | null;
  tradeDate?: string;
  capturedAt?: string;
  maxSnapshots?: number;
}): SupplyBySymbolPayloadSnapshot | null {
  const snapshot = buildSupplyBySymbolPayloadSnapshot(input);
  if (!snapshot) return null;
  const maxSnapshots = input.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
  const retained = [...readStore(), snapshot]
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .slice(-maxSnapshots);
  writeStore(retained);
  return snapshot;
}

export function lookupSupplyBySymbolPayloadSnapshot(input: {
  symbol: string;
  tradeDate?: string;
  now?: string;
  maxAgeMinutes?: number;
}): SupplyBySymbolPayloadLookupResult {
  const symbol = normalizeSymbol(input.symbol);
  const snapshots = readStore().sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const sameDate = input.tradeDate ? snapshots.filter((snapshot) => snapshot.tradeDate === input.tradeDate) : snapshots;
  const candidates = [...sameDate, ...snapshots.filter((snapshot) => !sameDate.includes(snapshot))];
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const maxAgeMs = (input.maxAgeMinutes ?? DEFAULT_MAX_AGE_MINUTES) * 60_000;
  for (const snapshot of candidates) {
    const payload = symbol ? snapshot.bySymbol[symbol] : undefined;
    if (!payload) continue;
    const ageMs = nowMs - Date.parse(snapshot.capturedAt);
    const stale = (input.tradeDate !== undefined && snapshot.tradeDate !== input.tradeDate) || !Number.isFinite(ageMs) || ageMs > maxAgeMs;
    return { payload, snapshot, stale, diagnosticAvailable: true, scoreUsage: 'SHADOW_ONLY', executionImpact: 'NONE', liveExecutionAllowed: false, reason: stale ? 'STALE' : 'FOUND' };
  }
  return { payload: null, snapshot: null, stale: false, diagnosticAvailable: false, scoreUsage: 'SHADOW_ONLY', executionImpact: 'NONE', liveExecutionAllowed: false, reason: 'MISSING' };
}
