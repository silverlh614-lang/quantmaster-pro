// @responsibility ADR-0619 shadow 진입 개방(Gate1 점수·Gate3 타이밍 완화) per-scan aggregate 관측 ledger. scanDateKey upsert·FIFO·atomic write·손상 fallback. flag ON 만 append, executionImpact NONE 관측 전용.

import fs from 'fs';
import {
  SHADOW_ENTRY_LIBERALIZATION_LEDGER_FILE,
  ensureDataDir,
} from '../../persistence/paths.js';

// ── 정책 상수 ────────────────────────────────────────────────────────────────
/** rolling FIFO — 보관 scan row 수(가장 오래된 scanDateKey 제거). */
export const SHADOW_ENTRY_LIBERALIZATION_WINDOW = 90;

// ── 타입 ─────────────────────────────────────────────────────────────────────

/** bypass 가능/유지 차단 SKIP 사유 분포 (관측 전용 — 유지 차단도 카운트하여 효과 baseline 제공). */
export interface ShadowEntrySkipCauseDist {
  bandMiss: number;       // BAND_MISS (Gate3 완화 가능)
  mtasWeak: number;       // MTAS_WEAK (Gate3 완화 가능)
  vixBlocked: number;     // VIX_CONSERVATIVE (유지 차단 — 관측만)
  consecutiveLossHold: number; // CONSECUTIVE_LOSS_HOLD (유지 차단 — 관측만)
  unknown: number;        // UNKNOWN/미상 (보수 차단 — 관측만)
}

/** 스캔당 1행 — 완화로 추가된 shadow 진입 집계. observationOnly·executionImpact NONE literal 강제. */
export interface ShadowEntryLiberalizationLedgerRow {
  scanDateKey: string;          // 'YYYY-MM-DD' KST 스캔일
  liberalizedEntryCount: number; // 완화(Gate1 점수 또는 Gate3 타이밍)로 추가된 shadow 진입 총수
  gate1RelaxedCount: number;     // REGIME_AWARE_SHADOW (점수 완화) 진입수
  gate3RelaxedCount: number;     // PREBREAKOUT_SHADOW (타이밍 완화) 진입수
  skipCauseDist: ShadowEntrySkipCauseDist;
  recordedAt: string;            // ISO
  executionImpact: 'NONE';       // literal 강제
  observationOnly: true;         // literal 강제
}

type LedgerShape = ShadowEntryLiberalizationLedgerRow[];

// ── 순수 집계 입력 (per-scan, 호출자가 누적한 카운터) ──────────────────────────

export interface ShadowEntryLiberalizationAggregateInput {
  scanDateKey: string;
  gate1RelaxedCount: number;
  gate3RelaxedCount: number;
  skipCauseDist: ShadowEntrySkipCauseDist;
  now?: Date;
}

/** 빈 분포 — 카운터 초기화 헬퍼(호출자 누적용). */
export function emptySkipCauseDist(): ShadowEntrySkipCauseDist {
  return { bandMiss: 0, mtasWeak: 0, vixBlocked: 0, consecutiveLossHold: 0, unknown: 0 };
}

/**
 * 정규화된 skipCause enum → 분포 카운터 키 누적(호출자가 per-stock 1회 호출). 미상/undefined → unknown.
 * 순수 mutation — IO 0. 관측 전용(매수 흐름 무영향).
 */
export function tallySkipCause(
  dist: ShadowEntrySkipCauseDist,
  skipCause: 'BAND_MISS' | 'MTAS_WEAK' | 'VIX_CONSERVATIVE' | 'CONSECUTIVE_LOSS_HOLD' | 'UNKNOWN' | undefined,
): void {
  switch (skipCause) {
    case 'BAND_MISS': dist.bandMiss += 1; break;
    case 'MTAS_WEAK': dist.mtasWeak += 1; break;
    case 'VIX_CONSERVATIVE': dist.vixBlocked += 1; break;
    case 'CONSECUTIVE_LOSS_HOLD': dist.consecutiveLossHold += 1; break;
    default: dist.unknown += 1; break;
  }
}

/** per-scan aggregate → ledger row 순수 산출 (provider/IO 0). liberalizedEntryCount = gate1+gate3. */
export function buildShadowEntryLiberalizationRow(
  input: ShadowEntryLiberalizationAggregateInput,
): ShadowEntryLiberalizationLedgerRow {
  return {
    scanDateKey: input.scanDateKey,
    liberalizedEntryCount: input.gate1RelaxedCount + input.gate3RelaxedCount,
    gate1RelaxedCount: input.gate1RelaxedCount,
    gate3RelaxedCount: input.gate3RelaxedCount,
    skipCauseDist: { ...input.skipCauseDist },
    recordedAt: (input.now ?? new Date()).toISOString(),
    executionImpact: 'NONE',
    observationOnly: true,
  };
}

// ── 검증/영속 (ADR-0614 패턴 차용) ─────────────────────────────────────────────

function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidRow(row: unknown): row is ShadowEntryLiberalizationLedgerRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return isValidDateKey(r.scanDateKey)
    && isFiniteNumber(r.liberalizedEntryCount)
    && isFiniteNumber(r.gate1RelaxedCount)
    && isFiniteNumber(r.gate3RelaxedCount);
}

export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function loadAll(filePath = SHADOW_ENTRY_LIBERALIZATION_LEDGER_FILE): LedgerShape {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValidRow);
    valid.sort((a, b) => a.scanDateKey.localeCompare(b.scanDateKey));
    return valid;
  } catch {
    // 손상 JSON → 빈 배열 fallback (시스템 무중단, 불변식 #1).
    return [];
  }
}

function saveAll(ledger: LedgerShape, filePath = SHADOW_ENTRY_LIBERALIZATION_LEDGER_FILE): void {
  ensureDataDir();
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
    fs.renameSync(tmp, filePath);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* SDS-ignore: tmp cleanup best-effort, idempotent */ }
  }
}

/**
 * per-scan aggregate row append (scanDateKey upsert last-write-wins, rolling FIFO).
 *
 * - 동일 scanDateKey 재스캔/재시작 안전 — Map upsert(byDate)로 last-write-wins.
 * - FIFO: WINDOW 초과 시 가장 오래된 scanDateKey 제거.
 * - atomic tmp→rename. 손상 파일 → 빈 배열 fallback 후 본 row 로 복구.
 * - 호출자는 flag ON 일 때만 호출(call-site gate). try/catch 격리는 call-site 책임(불변식 #1).
 *
 * @returns append 된 row.
 */
export function appendShadowEntryLiberalizationObservation(
  input: ShadowEntryLiberalizationAggregateInput,
  filePath = SHADOW_ENTRY_LIBERALIZATION_LEDGER_FILE,
): ShadowEntryLiberalizationLedgerRow {
  const row = buildShadowEntryLiberalizationRow(input);
  const ledger = loadAll(filePath);
  const byDate = new Map<string, ShadowEntryLiberalizationLedgerRow>();
  for (const existing of ledger) byDate.set(existing.scanDateKey, existing);
  byDate.set(row.scanDateKey, row);
  const merged = [...byDate.values()].sort((a, b) => a.scanDateKey.localeCompare(b.scanDateKey));
  const trimmed = merged.slice(Math.max(0, merged.length - SHADOW_ENTRY_LIBERALIZATION_WINDOW));
  saveAll(trimmed, filePath);
  return row;
}

// ── 조회 ───────────────────────────────────────────────────────────────────────

export function loadShadowEntryLiberalizationLedger(
  filePath = SHADOW_ENTRY_LIBERALIZATION_LEDGER_FILE,
): ShadowEntryLiberalizationLedgerRow[] {
  return loadAll(filePath);
}

/** 테스트 전용 — ledger 파일 초기화. */
export function __resetShadowEntryLiberalizationLedgerForTests(
  filePath = SHADOW_ENTRY_LIBERALIZATION_LEDGER_FILE,
): void {
  try { fs.unlinkSync(filePath); } catch { /* SDS-ignore: 미존재 파일 idempotent */ }
}
