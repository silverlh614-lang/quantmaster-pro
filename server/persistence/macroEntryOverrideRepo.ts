// @responsibility macroEntryOverrideRepo module
// @responsibility: persistent operator override for macro no-new-entry gates (R6/VIX/FOMC).

import fs from 'fs';
import path from 'path';
import { MACRO_ENTRY_OVERRIDE_FILE, ensureDataDir } from './paths.js';

export const PERSISTENT_MACRO_ENTRY_OVERRIDE_TARGETS = [
  'R6_DEFENSE',
  'VIX_BLOCK',
  'FOMC_BLOCK',
] as const;

export type PersistentMacroEntryOverrideTarget = typeof PERSISTENT_MACRO_ENTRY_OVERRIDE_TARGETS[number];

export interface PersistentMacroEntryOverrideRecord {
  active: true;
  targets: PersistentMacroEntryOverrideTarget[];
  reason: string;
  setBy: string;
  createdAt: string;
  expiresAt: string;
  ttlMinutes: number;
  kellyFloor: number;
  maxPositionsFloor: number;
}

const TARGET_SET = new Set<PersistentMacroEntryOverrideTarget>(PERSISTENT_MACRO_ENTRY_OVERRIDE_TARGETS);

function isTarget(value: unknown): value is PersistentMacroEntryOverrideTarget {
  return typeof value === 'string' && TARGET_SET.has(value as PersistentMacroEntryOverrideTarget);
}

function normalizeTargets(value: unknown): PersistentMacroEntryOverrideTarget[] {
  if (!Array.isArray(value)) return [...PERSISTENT_MACRO_ENTRY_OVERRIDE_TARGETS];
  const targets = [...new Set(value.filter(isTarget))];
  return targets.length > 0 ? targets : [...PERSISTENT_MACRO_ENTRY_OVERRIDE_TARGETS];
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function loadPersistentMacroEntryOverride(): PersistentMacroEntryOverrideRecord | null {
  if (!fs.existsSync(MACRO_ENTRY_OVERRIDE_FILE)) return null;
  try {
    const raw = fs.readFileSync(MACRO_ENTRY_OVERRIDE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.active !== true) return null;
    if (typeof obj.createdAt !== 'string' || typeof obj.expiresAt !== 'string') return null;

    return {
      active: true,
      targets: normalizeTargets(obj.targets),
      reason: typeof obj.reason === 'string' && obj.reason.trim()
        ? obj.reason
        : 'operator macro entry override',
      setBy: typeof obj.setBy === 'string' && obj.setBy.trim() ? obj.setBy : 'operator',
      createdAt: obj.createdAt,
      expiresAt: obj.expiresAt,
      ttlMinutes: Math.max(1, Math.floor(finiteNumber(obj.ttlMinutes, 60))),
      kellyFloor: Math.max(0.05, Math.min(1.0, finiteNumber(obj.kellyFloor, 0.3))),
      maxPositionsFloor: Math.max(1, Math.min(3, Math.floor(finiteNumber(obj.maxPositionsFloor, 1)))),
    };
  } catch {
    return null;
  }
}

export function savePersistentMacroEntryOverride(record: PersistentMacroEntryOverrideRecord): void {
  ensureDir();
  const tmp = `${MACRO_ENTRY_OVERRIDE_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8');
  fs.renameSync(tmp, MACRO_ENTRY_OVERRIDE_FILE);
}

export function clearPersistentMacroEntryOverride(): void {
  try {
    fs.unlinkSync(MACRO_ENTRY_OVERRIDE_FILE);
  } catch {
    // idempotent
  }
}

export function __resetPersistentMacroEntryOverrideForTests(): void {
  clearPersistentMacroEntryOverride();
}

function ensureDir(): void {
  try {
    ensureDataDir();
    fs.mkdirSync(path.dirname(MACRO_ENTRY_OVERRIDE_FILE), { recursive: true });
  } catch {
    // idempotent
  }
}
