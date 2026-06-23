// @responsibility ADR-0650 눌림목 레인 forward-return 관측 row 영속 repo + 비교 aggregate 빌더 — atomic write, RESOLVED 불변성, 주문/provider 호출 0.
/**
 * pullbackLaneObservationRepo.ts — ADR-0650 §D1 관측 row 영속 SSOT (engine-dev 본문).
 *
 * 스캔-시점 per-candidate 눌림목 레인 stamp 를 forward-return 성숙 대상 row 로 굳힌다.
 * 본체 영속 ledger 와 *물리 분리*된 별도 파일 (ADR-0445 분리 원칙·ADR-0625 동형).
 *
 * 안전 invariant (ADR-0625 패턴 계승):
 *   - atomic write (tmp → rename) — race 안전, 손상 부분쓰기 차단.
 *   - load 시 손상 JSON → 빈 배열 `[]` fallback (시스템 무중단, 불변식 #1).
 *   - upsertObservation: 멱등 키 `scanId:symbol` last-write-wins. 단 *이미 RESOLVED* 행은
 *     재기입 skip (불변성 — ADR-0650 §D1 멱등).
 *   - KIS 주문 함수 import 0건 — 학습 관측 전용 (정적 grep 가드).
 *
 * 빌더(§D4): RESOLVED 행을 눌림목(레인 B) vs 추격(레인 C)으로 분류해 forward 1D/3D/5D·
 * 진입 RRR 평균 + verdict(N≥30 && 눌림목 avg5D ≥ 추격 avg5D → HOLD) 산출. 순수 함수(부수효과 0).
 */

import fs from 'fs';
import { PULLBACK_LANE_OBSERVATION_LEDGER_FILE, ensureDataDir } from './paths.js';
import type {
  PullbackLaneObservationRow,
  PullbackLaneForwardAggregate,
  PullbackVsChaseForwardComparison,
} from '../learning/pullbackLaneObservationTypes.js';
import {
  pullbackLaneObservationKey,
  PULLBACK_VERDICT_MIN_SAMPLE,
} from '../learning/pullbackLaneObservationTypes.js';

interface PullbackLaneObservationLedgerFile {
  version: 1;
  rows: PullbackLaneObservationRow[];
}

// 일일 스캔×후보 수 대비 10거래일(≈14달력일) 성숙 커버 + 여유.
const MAX_PULLBACK_OBSERVATION_ROWS = 12_000;

function isLedgerFile(value: unknown): value is PullbackLaneObservationLedgerFile {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray((value as PullbackLaneObservationLedgerFile).rows),
  );
}

function readLedger(filePath = PULLBACK_LANE_OBSERVATION_LEDGER_FILE): PullbackLaneObservationLedgerFile {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return { version: 1, rows: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return isLedgerFile(parsed) ? parsed : { version: 1, rows: [] };
  } catch {
    // 손상 JSON → 빈 배열 fallback (시스템 무중단, 불변식 #1).
    return { version: 1, rows: [] };
  }
}

function writeLedger(
  file: PullbackLaneObservationLedgerFile,
  filePath = PULLBACK_LANE_OBSERVATION_LEDGER_FILE,
): void {
  ensureDataDir();
  // FIFO trim — 가장 오래된 행부터 evict (성숙 cron 빈도상 충분).
  const rows =
    file.rows.length > MAX_PULLBACK_OBSERVATION_ROWS
      ? file.rows.slice(file.rows.length - MAX_PULLBACK_OBSERVATION_ROWS)
      : file.rows;
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1 as const, rows }));
  fs.renameSync(tmp, filePath);
}

/** 전체 관측 row read — 손상 시 `[]`. /gate_audit 비교(§D4)·성숙 cron(§D2) 입력. */
export function loadObservations(
  filePath = PULLBACK_LANE_OBSERVATION_LEDGER_FILE,
): PullbackLaneObservationRow[] {
  return readLedger(filePath).rows;
}

/**
 * 미성숙(PENDING) 행만 — 성숙 cron(§D2) 이 forward-return 채울 대상.
 * RESOLVED 행은 불변성으로 재방문 불필요 → 제외.
 */
export function loadPendingObservations(
  filePath = PULLBACK_LANE_OBSERVATION_LEDGER_FILE,
): PullbackLaneObservationRow[] {
  return readLedger(filePath).rows.filter((r) => r.maturity === 'PENDING');
}

/** 성숙(RESOLVED) 행만 — /gate_audit 비교(§D4) 집계 입력. */
export function loadMaturedObservations(
  filePath = PULLBACK_LANE_OBSERVATION_LEDGER_FILE,
): PullbackLaneObservationRow[] {
  return readLedger(filePath).rows.filter((r) => r.maturity === 'RESOLVED');
}

/** §D1 seam 입력 — 스캔-시점 stamp 의 영속 필드(pullbackLaneShadowObservationAdr0648 산출분). */
export interface PullbackLaneObservationStampInput {
  pullbackLaneHypotheticalFired: boolean;
  breakoutChaseLaneFired: boolean;
  overheatGuardTriggered: boolean;
  pullbackLanePosVsHigh20d: number | null;
  pullbackLaneVolRatio: number | null;
  pullbackLaneAboveMa20: boolean;
}

/** §D1 seam — 진입시점 메타 carry (가용 시·없으면 undefined). */
export interface PullbackLaneObservationEntryMeta {
  scanId: string;
  symbol: string;
  asOf: string;
  entryLane?: 'PULLBACK';
  entryRrr?: number;
}

/**
 * ADR-0650 §D1 — stamp + entry 메타 → 영속 row 정규화 (순수 함수·테스트 대상).
 * maturity='PENDING'·observationOnly=true 계약 고정. forwardReturn* 은 성숙 cron 사후 채움.
 */
export function buildObservationRowFromStamp(
  stamp: PullbackLaneObservationStampInput,
  meta: PullbackLaneObservationEntryMeta,
): PullbackLaneObservationRow {
  return {
    scanId: meta.scanId,
    symbol: meta.symbol,
    asOf: meta.asOf,
    pullbackLaneHypotheticalFired: stamp.pullbackLaneHypotheticalFired,
    breakoutChaseLaneFired: stamp.breakoutChaseLaneFired,
    overheatGuardTriggered: stamp.overheatGuardTriggered,
    posVsHigh20d: stamp.pullbackLanePosVsHigh20d,
    volRatio: stamp.pullbackLaneVolRatio,
    aboveMa20: stamp.pullbackLaneAboveMa20,
    entryRrr: meta.entryRrr,
    entryLane: meta.entryLane,
    maturity: 'PENDING',
    observationOnly: true,
  };
}

export interface PullbackObservationUpsertResult {
  created: boolean;
  updated: boolean;
  /** 이미 RESOLVED 행 재기입 차단 (불변성). */
  resolvedSkipped: boolean;
  row: PullbackLaneObservationRow;
}

/**
 * 멱등 키 `scanId:symbol` upsert — last-write-wins.
 * 불변성: 기존 행이 `maturity==='RESOLVED'` 이면 재기입 skip (ADR-0650 §D1).
 * marketSignal/observationOnly 계약은 호출자(정규화)가 보장 — 본 repo 는 영속만.
 */
export function upsertObservation(
  row: PullbackLaneObservationRow,
  filePath = PULLBACK_LANE_OBSERVATION_LEDGER_FILE,
): PullbackObservationUpsertResult {
  const file = readLedger(filePath);
  const key = pullbackLaneObservationKey(row);
  const index = file.rows.findIndex((r) => pullbackLaneObservationKey(r) === key);
  if (index < 0) {
    file.rows.push(row);
    writeLedger(file, filePath);
    return { created: true, updated: false, resolvedSkipped: false, row };
  }
  const existing = file.rows[index];
  if (existing.maturity === 'RESOLVED') {
    // 불변성 — RESOLVED 행은 절대 재기입하지 않는다.
    return { created: false, updated: false, resolvedSkipped: true, row: existing };
  }
  file.rows[index] = row;
  writeLedger(file, filePath);
  return { created: false, updated: true, resolvedSkipped: false, row };
}

// ── §D4 비교 aggregate 빌더 (순수 함수·부수효과 0·테스트 대상) ──────────────────

/** number[] 평균 — 빈 배열 null (graceful, 불변식 #6). */
function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** 한 레인 표본 → forward-return·진입 RRR 평균 집계 (RESOLVED 행 기준). */
function aggregateLane(rows: PullbackLaneObservationRow[]): PullbackLaneForwardAggregate {
  const d1 = rows.map((r) => r.forwardReturn1d).filter((v): v is number => typeof v === 'number');
  const d3 = rows.map((r) => r.forwardReturn3d).filter((v): v is number => typeof v === 'number');
  const d5 = rows.map((r) => r.forwardReturn5d).filter((v): v is number => typeof v === 'number');
  const rrr = rows.map((r) => r.entryRrr).filter((v): v is number => typeof v === 'number');
  return {
    nD1: d1.length,
    nD3: d3.length,
    nD5: d5.length,
    avgForwardReturn1d: avg(d1),
    avgForwardReturn3d: avg(d3),
    avgForwardReturn5d: avg(d5),
    avgEntryRrr: avg(rrr),
  };
}

/** 눌림목 레인 표본 식별 (entryLane='PULLBACK' 또는 force-ON 가정 FIRED). */
function isPullbackSample(row: PullbackLaneObservationRow): boolean {
  return row.entryLane === 'PULLBACK' || row.pullbackLaneHypotheticalFired;
}

/**
 * ADR-0650 §D4 — RESOLVED 행을 눌림목 vs 추격으로 분류해 비교 산출.
 * verdict: D5 표본 N≥30 && 눌림목 avg5D ≥ 추격 avg5D → 'HOLD'(유지) / else 'INSUFFICIENT_OR_ROLLBACK'.
 * avg 동률(>=)은 눌림목 우월로 HOLD. avg null(표본 0) 은 자동 INSUFFICIENT.
 */
export function buildPullbackVsChaseComparison(
  rows: PullbackLaneObservationRow[],
): PullbackVsChaseForwardComparison {
  const resolved = rows.filter((r) => r.maturity === 'RESOLVED');
  const pullbackRows = resolved.filter((r) => isPullbackSample(r));
  const chaseRows = resolved.filter((r) => r.breakoutChaseLaneFired);

  const pullback = aggregateLane(pullbackRows);
  const chase = aggregateLane(chaseRows);

  const sampleMet = pullback.nD5 >= PULLBACK_VERDICT_MIN_SAMPLE;
  const pullbackSuperior =
    pullback.avgForwardReturn5d !== null &&
    chase.avgForwardReturn5d !== null &&
    pullback.avgForwardReturn5d >= chase.avgForwardReturn5d;

  const verdict: PullbackVsChaseForwardComparison['verdict'] =
    sampleMet && pullbackSuperior ? 'HOLD' : 'INSUFFICIENT_OR_ROLLBACK';

  const verdictHint =
    verdict === 'HOLD'
      ? `유지(눌림목 우월 확인·N=${pullback.nD5}≥${PULLBACK_VERDICT_MIN_SAMPLE})`
      : !sampleMet
        ? `데이터 부족(눌림목 D5 N=${pullback.nD5}<${PULLBACK_VERDICT_MIN_SAMPLE})`
        : '추격 우월 — 롤백 검토';

  return { pullback, chase, verdict, verdictHint };
}

/** 테스트 전용 — ledger 파일 삭제. */
export function __resetPullbackLaneObservationLedgerForTests(
  filePath = PULLBACK_LANE_OBSERVATION_LEDGER_FILE,
): void {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
