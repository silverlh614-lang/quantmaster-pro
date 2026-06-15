// @responsibility ADR-0605 — Gate2 SOX dry-run 관측 누적 ledger 영속(진단 전용, 주문/KIS/provider 호출 0, FIFO trim).

import fs from 'node:fs';
import {
  GATE2_SOX_OBSERVATION_LEDGER_FILE,
  ensureDataDir,
} from '../../../persistence/paths.js';
import type { Gate2SoxSemiAxisObservationAdr0605 } from './gate2SoxSemiAxisAdr0605.js';

/** 다른 진단 ledger 와 물리 분리. raw payload·민감정보 0 (sanitized metadata only). */
export interface Gate2SoxObservationLedgerRow {
  forDate: string;               // KST YYYY-MM-DD
  scanId?: string;
  semiconductorCandidates: number;
  sectorCycleMissingCandidates: number;
  dryRunEvaluable: number;
  bucket62: number;
  bucket50: number;
  avgScore: number;
  maxScore: number;
  coverageRatio: number;
  soxAvailable: boolean;
  executionImpact: 'NONE';
}

const MAX_ROWS = 2000;           // FIFO 단순 trim (관측 로그 — maturity 개념 없음).

function kstDateKey(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function loadGate2SoxObservationRows(
  filePath = GATE2_SOX_OBSERVATION_LEDGER_FILE,
): Gate2SoxObservationLedgerRow[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // 손상 JSON → 빈 배열 fallback (영속 손상이 엔진을 멈추지 않는다, 불변식 #1).
    return [];
  }
}

/**
 * 관측 1행 append + atomic write(tmp→rename) + FIFO trim. flag 와 독립적으로 매 스캔 1행.
 * 호출부(persistScanResults)는 본 함수를 try/catch 로 격리해야 한다 — ledger 쓰기 실패가
 * 트레이딩 엔진을 멈추지 않는다(불변식 #1). executionImpact: 'NONE'.
 */
export function appendGate2SoxObservation(input: {
  observation: Gate2SoxSemiAxisObservationAdr0605;
  scanId?: string;
  now?: Date;
  filePath?: string;
}): Gate2SoxObservationLedgerRow {
  const filePath = input.filePath ?? GATE2_SOX_OBSERVATION_LEDGER_FILE;
  const o = input.observation;
  const row: Gate2SoxObservationLedgerRow = {
    forDate: kstDateKey(input.now),
    ...(input.scanId ? { scanId: input.scanId } : {}),
    semiconductorCandidates: o.semiconductorCandidates,
    sectorCycleMissingCandidates: o.sectorCycleMissingCandidates,
    dryRunEvaluable: o.dryRunEvaluable,
    bucket62: o.scoreDelta.bucket62,
    bucket50: o.scoreDelta.bucket50,
    avgScore: o.scoreDelta.avgScore,
    maxScore: o.scoreDelta.maxScore,
    coverageRatio: o.coverageRatio,
    soxAvailable: o.sox20dReturn !== null,
    executionImpact: 'NONE',
  };
  ensureDataDir();
  const rows = loadGate2SoxObservationRows(filePath);
  rows.push(row);
  const trimmed = rows.slice(-MAX_ROWS);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(trimmed));
  fs.renameSync(tmp, filePath);
  return row;
}

export function __resetGate2SoxObservationLedgerForTests(
  filePath = GATE2_SOX_OBSERVATION_LEDGER_FILE,
): void {
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}
