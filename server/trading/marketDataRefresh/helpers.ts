// @responsibility ADR-0580 marketDataRefresh pure leaf helpers (extracted for ACMA 1500-line limit; byte-equivalent)

import { enforceRowInvariant } from '../programMarketSnapshot.js';
import { safePctChange } from '../../utils/safePctChange.js';
import type { ProgramMarketRawUnitAssumption } from './types.js';

export function buildProgramMarketSnapshotId(now = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hms = now.toISOString().slice(11, 19).replace(/:/g, '');
  const random6 = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `mpg_${ymd}_${hms}_${random6}`;
}

export function hasSnapshotInvariantViolation(input: {
  kospiLen: number;
  kosdaqLen: number;
  combinedLen: number;
  combinedNonZero: number;
  combinedSource: string;
  rawTopFirstBsopHour?: string | null;
  selectedBsopHour?: string | null;
}): { violated: boolean; reason: string; snapshotMismatch: boolean } {
  const snapshotMismatch = !!(input.rawTopFirstBsopHour && input.selectedBsopHour && input.rawTopFirstBsopHour !== input.selectedBsopHour);
  if (input.combinedNonZero > input.combinedLen) return { violated: true, reason: 'combinedNonZeroRows exceeds combinedOutputLength', snapshotMismatch };
  if (input.combinedLen === 0 && input.combinedNonZero !== 0) return { violated: true, reason: 'combinedOutputLength is 0 but nonZeroRows is non-zero', snapshotMismatch };
  if (input.kospiLen === 0 && input.kosdaqLen === 0 && input.combinedSource === 'KOSPI_PLUS_KOSDAQ') return { violated: true, reason: 'empty split rows cannot be KOSPI_PLUS_KOSDAQ', snapshotMismatch };
  if (input.combinedSource === 'KOSPI_PLUS_KOSDAQ' && input.combinedLen !== (input.kospiLen + input.kosdaqLen)) return { violated: true, reason: 'combined length does not match split sum', snapshotMismatch };
  // snapshotMismatch 는 "동일 스냅샷 불변식 위반"이 아니라
  // "direct probe vs persisted snapshot 시각 차이" 관측치로만 사용한다.
  // (raw diagnostic 용 probe 와 macroState snapshot 분리 정책)
  return { violated: false, reason: 'NONE', snapshotMismatch };
}

export function formatEokAmount(value: number | null, unitAssumption: ProgramMarketRawUnitAssumption): string {
  if (value === null || !Number.isFinite(value)) return 'N/A';
  const divisor = unitAssumption === 'KRW_1K' ? 100_000 : unitAssumption === 'KRW_1M' ? 100 : 100_000_000;
  const displayEok = value / divisor;
  if (value === 0) return '0억원';
  if (Math.abs(displayEok) < 0.01) return value < 0 ? '-0.01억원 미만' : '0.01억원 미만';
  const sign = displayEok > 0 ? '+' : '';
  return `${sign}${displayEok.toFixed(2)}억원`;
}

export function buildUnitCandidates(rawValue: number | null): { KRW: string; KRW_1K: string; KRW_1M: string } {
  return {
    KRW: formatEokAmount(rawValue, 'UNVERIFIED'),
    KRW_1K: formatEokAmount(rawValue === null ? null : rawValue * 1000, 'UNVERIFIED'),
    KRW_1M: formatEokAmount(rawValue === null ? null : rawValue * 1_000_000, 'UNVERIFIED'),
  };
}

export function parseKisNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[,\s]/g, '').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function selectLatestByBsopHour(rows: Array<Record<string, unknown>>): Record<string, unknown> | null {
  if (!rows.length) return null;
  return rows.reduce<Record<string, unknown> | null>((best, row) => {
    const cur = String(row.bsop_hour ?? '');
    if (!best) return row;
    const prev = String(best.bsop_hour ?? '');
    return cur >= prev ? row : best;
  }, null);
}

export function normalizeMarketProgramLeg(leg: {
  rows: Array<Record<string, unknown>>;
  selectedRow?: Record<string, unknown> | null;
}): {
  rows: Array<Record<string, unknown>>;
  unitCandidates: { KRW: string; KRW_1K: string; KRW_1M: string } | null;
  outputLength: number;
  nonZeroRows: number;
  selectedRow: Record<string, unknown> | null;
  selectedBsopHour: string | null;
  rawWholeNetBuy: number | null;
  rawArbitrageNetBuy: number | null;
  rawNonArbitrageNetBuy: number | null;
  displayWholeNetBuy: string;
  invariantViolated: boolean;
  invariantReason: string | null;
} {
  const rows = Array.isArray(leg.rows) ? leg.rows : [];
  const outputLength = rows.length;
  const nonZeroRows = rows.filter((r) => (parseKisNumber(r.whol_smtn_ntby_tr_pbmn) ?? 0) !== 0).length;
  if (rows.length === 0) {
    return {
      rows,
      selectedRow: null,
      outputLength: 0,
      nonZeroRows: 0,
      selectedBsopHour: null,
      rawWholeNetBuy: null,
      rawArbitrageNetBuy: null,
      rawNonArbitrageNetBuy: null,
      displayWholeNetBuy: 'N/A',
      unitCandidates: null,
      invariantViolated: false,
      invariantReason: null,
    };
  }
  const selectedRow = selectLatestByBsopHour(rows);
  const rawWholeNetBuy = parseKisNumber(selectedRow?.whol_smtn_ntby_tr_pbmn);
  const rawArbitrageNetBuy = parseKisNumber(selectedRow?.arbt_smtn_ntby_tr_pbmn);
  const rawNonArbitrageNetBuy = parseKisNumber(selectedRow?.nabt_smtn_ntby_tr_pbmn);
  return {
    rows,
    selectedRow,
    outputLength,
    nonZeroRows: enforceRowInvariant(outputLength, nonZeroRows),
    selectedBsopHour: selectedRow ? String(selectedRow.bsop_hour ?? '') : null,
    rawWholeNetBuy,
    rawArbitrageNetBuy,
    rawNonArbitrageNetBuy,
    displayWholeNetBuy: formatEokAmount(rawWholeNetBuy, 'UNVERIFIED'),
    unitCandidates: buildUnitCandidates(rawWholeNetBuy),
    invariantViolated: false,
    invariantReason: null,
  };
}

export function sumNullablePair(left: number | null, right: number | null): number | null {
  if (left === null && right === null) return null;
  return (left ?? 0) + (right ?? 0);
}

/** 필드값(문자열·숫자) → 백분율. 실패 시 null. */
export function parsePct(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 이동평균 계산 */
export function sma(prices: number[], n: number): number {
  const slice = prices.slice(-n);
  if (slice.length < n) return prices[prices.length - 1] ?? 0;
  return slice.reduce((a, b) => a + b, 0) / n;
}

/**
 * N일 수익률 (%). ADR-0028 — stale base / sanity bound 위반 시 0 반환 (KOSPI 매크로
 * 지표가 망가져 레짐 분류가 왜곡되는 것을 차단하기 위해 0% 안전값으로 fallback).
 *
 * 기존 구현은 base ≤ 0 가드만 있어 Yahoo OTC 가 수년 전 stale 종가를 반환하면
 * -90% 같은 비현실 값이 macroState 에 그대로 영속화될 수 있었다.
 */
export function nDayReturn(prices: number[], n: number, label?: string): number {
  if (prices.length < n + 1) return 0;
  const past    = prices[prices.length - 1 - n];
  const current = prices[prices.length - 1];
  const result = safePctChange(current, past, { label: label ?? `nDayReturn:${n}d` });
  return result ?? 0;
}
