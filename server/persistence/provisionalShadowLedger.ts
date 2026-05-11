// @responsibility provisionalShadowLedger — ADR-0426 candidates 영속 SSOT.
//
// ADR-0427:
// Wires ADR-0426 R3_EARLY provisional shadow candidates into the scanner
// and shadow/provisional ledger.
//
// This records learning samples only. It must never open LIVE trading, import
// KIS order paths, lower gate thresholds, or bypass HARD_BLOCK states.
//
// HARD_BLOCK remains absolute. SOFT_DEGRADE/WATCH_ONLY may be preserved as
// labeled provisional shadow entries for later performance analysis.
//
// 핵심 불변식 (사용자 명시 §"절대 하지 말 것" 정합):
//   1. 일반 shadow-trades.json 분리 영속 (PROVISIONAL_SHADOW_LEDGER_FILE)
//   2. virtual account holdings/cash 무관 — metadata 만
//   3. dedup key 동일 scan 내 중복 차단 (`${scanId}:${symbol}:ADR-0426`)
//   4. KIS 주문 함수 import 0건
//   5. LIVE 매매 본체 무수정
//   6. 사용자 §D `eventType: 'PROVISIONAL_SHADOW_ENTRY'` literal — 분리 마커

import * as fs from 'fs';
import * as path from 'path';
import { PROVISIONAL_SHADOW_LEDGER_FILE } from './paths.js';
import type {
  ProvisionalShadowCandidate,
  ProvisionalShadowLabel,
  ProvisionalShadowReason,
} from '../trading/signalScanner/provisionalShadowLane.js';

/** FIFO trim 한계 (사용자 §D 정합 — 별도 ledger 라 일반 shadow 와 격리). */
export const PROVISIONAL_SHADOW_LEDGER_MAX = 2000;

/**
 * 영속 entry schema (사용자 §D 정합, 절대 변경 금지).
 *
 * `eventType: 'PROVISIONAL_SHADOW_ENTRY'` literal — 일반 shadow buy 와 분리 마커.
 * `provisional: true` literal + `liveAllowed: false` literal — 정적 가드.
 */
export interface ProvisionalShadowLedgerEntry {
  eventType: 'PROVISIONAL_SHADOW_ENTRY';
  provisional: true;
  source: 'ADR-0426';
  symbol: string;
  name?: string;
  scanId?: string;
  scannedAtKst?: string;
  createdAtKst: string;
  label: ProvisionalShadowLabel;
  reasons: ProvisionalShadowReason[];
  regime: 'R3_EARLY';
  gate1Passed: boolean;
  gate2Passed: boolean;
  liveAllowed: false;
  shadowAllowed: true;
  routerSeverity?: string;
  /** ADR-0427 §C — provisional 진단 메타 (sectorEnergy/conditions/router). */
  lastSeenAt?: string;
  lastReason?: ProvisionalShadowReason;
  latestGateSnapshot?: { gate1Passed: boolean; gate2Passed: boolean; routerSeverity?: string };
  latestLaneLabel?: ProvisionalShadowLabel;
  duplicateSeenCount?: number;
  providerDegradedReason?: string;
  gate2NotConfirmedReason?: string;
  metadata?: {
    sectorEnergyDataQuality?: string;
    sectorEnergyConfidence?: number;
    sectorEnergyIndexCodeCoverage?: number;
    sectorEnergyRepairStatus?: string;
    unavailableConditions?: string[];
    failedTechnicalConditions?: string[];
    routerReasons?: string[];
  };
}

interface LedgerFile {
  version: 1;
  entries: ProvisionalShadowLedgerEntry[];
}

function readLedgerFile(): LedgerFile {
  try {
    if (!fs.existsSync(PROVISIONAL_SHADOW_LEDGER_FILE)) {
      return { version: 1, entries: [] };
    }
    const raw = fs.readFileSync(PROVISIONAL_SHADOW_LEDGER_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return parsed as LedgerFile;
  } catch (e) {
    console.warn('[ProvisionalShadowLedger] read 실패 — 빈 ledger fallback', e);
    return { version: 1, entries: [] };
  }
}

function atomicWrite(file: LedgerFile): void {
  const dir = path.dirname(PROVISIONAL_SHADOW_LEDGER_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${PROVISIONAL_SHADOW_LEDGER_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf-8');
  fs.renameSync(tmp, PROVISIONAL_SHADOW_LEDGER_FILE);
}

/**
 * dedup key SSOT (사용자 §E 정합).
 *
 * 같은 scanId 내 동일 symbol 중복 차단. scanId 부재 시 KST `YYYYMMDDHHmm` fallback.
 */
export function buildDedupKey(scanId: string | undefined, symbol: string, nowKst?: string): string {
  if (scanId) return `${scanId}:${symbol}:ADR-0426`;
  // fallback — KST minute granularity (다음 분 entry 와 충돌 가능, scanId 권장)
  const ts = nowKst ?? new Date().toISOString();
  const yyyymmddhhmm = ts.replace(/[^0-9]/g, '').slice(0, 12);
  return `${yyyymmddhhmm}:${symbol}:ADR-0426`;
}

/**
 * 동일 scan 내 중복 entry 검사. (사용자 §E 정합)
 */
export function hasExistingEntry(scanId: string | undefined, symbol: string): boolean {
  const file = readLedgerFile();
  const key = buildDedupKey(scanId, symbol);
  for (const e of file.entries) {
    if (buildDedupKey(e.scanId, e.symbol) === key) return true;
  }
  return false;
}

/**
 * 영속 read-only API — 진단·테스트 용도.
 */
export function loadProvisionalShadowLedger(): ProvisionalShadowLedgerEntry[] {
  return readLedgerFile().entries;
}

/**
 * 영속 reset — 테스트 격리.
 */
export function __resetProvisionalShadowLedgerForTests(): void {
  if (fs.existsSync(PROVISIONAL_SHADOW_LEDGER_FILE)) {
    fs.unlinkSync(PROVISIONAL_SHADOW_LEDGER_FILE);
  }
}

/** ENV `PROVISIONAL_SHADOW_LEDGER_DISABLED=true` 시 영속 차단 (회귀 1줄 롤백, ADR-0157). */
export function isProvisionalShadowLedgerDisabled(): boolean {
  return process.env.PROVISIONAL_SHADOW_LEDGER_DISABLED === 'true';
}

export interface RecordProvisionalShadowInput {
  candidate: ProvisionalShadowCandidate;
  scanId?: string;
  scannedAtKst?: string;
  metadata?: ProvisionalShadowLedgerEntry['metadata'];
}

export type RecordProvisionalShadowResult =
  | { recorded: true; entry: ProvisionalShadowLedgerEntry }
  | { recorded: false; updated: true; reason: 'DUPLICATE'; entry: ProvisionalShadowLedgerEntry }
  | { recorded: false; reason: 'ENV_DISABLED' | 'PERSIST_ERROR' };

/**
 * R3 provisional shadow 후보 영속 기록 SSOT (사용자 §C 정합).
 *
 * 멱등 (동일 scanId+symbol 중복 차단). 영속 throw 안전 fallback.
 *
 * 안전 invariant:
 *   - 일반 shadow-trades.json 무수정 (별도 파일 PROVISIONAL_SHADOW_LEDGER_FILE)
 *   - virtual account holdings/cash 무영향
 *   - `eventType: 'PROVISIONAL_SHADOW_ENTRY'` literal 영구 분리 마커
 */
export function recordR3ProvisionalShadowCandidate(
  input: RecordProvisionalShadowInput,
): RecordProvisionalShadowResult {
  if (isProvisionalShadowLedgerDisabled()) {
    return { recorded: false, reason: 'ENV_DISABLED' };
  }

  const nowIso = new Date().toISOString();
  try {
    const file = readLedgerFile();
    const key = buildDedupKey(input.scanId, input.candidate.symbol);
    const existing = file.entries.find((e) => buildDedupKey(e.scanId, e.symbol) === key);
    if (existing) {
      existing.lastSeenAt = input.scannedAtKst ?? nowIso;
      existing.lastReason = input.candidate.reasons[input.candidate.reasons.length - 1];
      existing.latestGateSnapshot = {
        gate1Passed: input.candidate.gate1Passed,
        gate2Passed: input.candidate.gate2Passed,
        ...(input.candidate.routerSeverity !== undefined ? { routerSeverity: input.candidate.routerSeverity } : {}),
      };
      existing.latestLaneLabel = input.candidate.label;
      existing.duplicateSeenCount = (existing.duplicateSeenCount ?? 0) + 1;
      existing.providerDegradedReason = input.metadata?.unavailableConditions?.join(',') ?? existing.providerDegradedReason;
      existing.gate2NotConfirmedReason = input.candidate.reasons.includes('PRE_BREAKOUT_WAIT')
        ? 'PRE_BREAKOUT_WAIT'
        : input.candidate.reasons.includes('DATA_UNAVAILABLE')
          ? 'DATA_UNAVAILABLE'
          : 'GATE2_NOT_CONFIRMED';
      existing.metadata = { ...(existing.metadata ?? {}), ...(input.metadata ?? {}) };
      atomicWrite(file);
      return { recorded: false, updated: true, reason: 'DUPLICATE', entry: existing };
    }
  } catch (e) {
    console.warn('[ProvisionalShadowLedger] duplicate update 실패 — 매수 흐름 무영향', e);
    return { recorded: false, reason: 'PERSIST_ERROR' };
  }

  const entry: ProvisionalShadowLedgerEntry = {
    eventType: 'PROVISIONAL_SHADOW_ENTRY',
    provisional: true,
    source: 'ADR-0426',
    symbol: input.candidate.symbol,
    ...(input.candidate.name !== undefined ? { name: input.candidate.name } : {}),
    ...(input.scanId !== undefined ? { scanId: input.scanId } : {}),
    ...(input.scannedAtKst !== undefined ? { scannedAtKst: input.scannedAtKst } : {}),
    createdAtKst: input.candidate.createdAtKst ?? nowIso,
    label: input.candidate.label,
    reasons: input.candidate.reasons,
    regime: 'R3_EARLY',
    gate1Passed: input.candidate.gate1Passed,
    gate2Passed: input.candidate.gate2Passed,
    liveAllowed: false,
    shadowAllowed: true,
    ...(input.candidate.routerSeverity !== undefined
      ? { routerSeverity: input.candidate.routerSeverity }
      : {}),
    lastSeenAt: input.scannedAtKst ?? nowIso,
    lastReason: input.candidate.reasons[input.candidate.reasons.length - 1],
    latestGateSnapshot: {
      gate1Passed: input.candidate.gate1Passed,
      gate2Passed: input.candidate.gate2Passed,
      ...(input.candidate.routerSeverity !== undefined ? { routerSeverity: input.candidate.routerSeverity } : {}),
    },
    latestLaneLabel: input.candidate.label,
    duplicateSeenCount: 0,
    providerDegradedReason: input.metadata?.unavailableConditions?.join(','),
    gate2NotConfirmedReason: input.candidate.reasons.includes('PRE_BREAKOUT_WAIT')
      ? 'PRE_BREAKOUT_WAIT'
      : input.candidate.reasons.includes('DATA_UNAVAILABLE')
        ? 'DATA_UNAVAILABLE'
        : 'GATE2_NOT_CONFIRMED',
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  };

  try {
    const file = readLedgerFile();
    file.entries.push(entry);
    if (file.entries.length > PROVISIONAL_SHADOW_LEDGER_MAX) {
      file.entries.splice(0, file.entries.length - PROVISIONAL_SHADOW_LEDGER_MAX);
    }
    atomicWrite(file);
    return { recorded: true, entry };
  } catch (e) {
    console.warn('[ProvisionalShadowLedger] write 실패 — 매수 흐름 무영향', e);
    return { recorded: false, reason: 'PERSIST_ERROR' };
  }
}
