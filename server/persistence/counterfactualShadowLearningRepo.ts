// @responsibility counterfactualShadowLearningRepo — ADR-0430 영속 SSOT.
//
// ADR-0430:
// SELL_ONLY and HARD_BLOCK stop execution, not learning.
// Counterfactual shadow learning records "what if we had bought?" samples
// in a separate learning-only ledger without touching live orders, paper
// execution, normal shadow trades, or virtual account balances.
//
// 핵심 불변식 (사용자 명시 §"절대 하지 말 것" 정합):
//   1. 일반 shadow-trades.json 분리 영속 (COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE)
//   2. ADR-0427 provisional-shadow-ledger.json 분리 영속
//   3. virtual account holdings/cash 무관 — metadata 만
//   4. dedup key 동일 scan 내 중복 차단 (`${scanId}:${symbol}:ADR-0430`)
//   5. KIS 주문 함수 import 0건
//   6. LIVE 매매 본체 무수정
//   7. eventType:'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY' literal — 분리 마커

import * as fs from 'fs';
import * as path from 'path';
import { COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE } from './paths.js';
import type {
  CounterfactualShadowLearningCandidate,
} from '../trading/signalScanner/counterfactualShadowLearningLane.js';

/** FIFO trim 한계 — ADR-0427 PROVISIONAL_SHADOW_LEDGER_MAX 와 동일 (분리 영속이라 격리). */
export const COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_MAX = 2000;

/**
 * 영속 entry schema — Candidate 본체 그대로 영속.
 *
 * `eventType`/`source`/`learningOnly`/`provisional`/`liveAllowed`/`paperAllowed`/
 * `executionShadowAllowed`/`virtualAccountImpact` 모두 literal types — TypeScript 강제.
 */
export type CounterfactualShadowLearningLedgerEntry =
  CounterfactualShadowLearningCandidate;

interface LedgerFile {
  version: 1;
  entries: CounterfactualShadowLearningLedgerEntry[];
}

function readLedgerFile(): LedgerFile {
  try {
    if (!fs.existsSync(COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE)) {
      return { version: 1, entries: [] };
    }
    const raw = fs.readFileSync(COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return parsed as LedgerFile;
  } catch (e) {
    console.warn('[CounterfactualShadowLearningRepo] read 실패 — 빈 ledger fallback', e);
    return { version: 1, entries: [] };
  }
}

function atomicWrite(file: LedgerFile): void {
  const dir = path.dirname(COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf-8');
  fs.renameSync(tmp, COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE);
}

/**
 * dedup key SSOT (사용자 §F 정합).
 *
 * 같은 scanId 내 동일 symbol 중복 차단. scanId 부재 시 KST `YYYYMMDDHHmm` fallback.
 */
export function buildCounterfactualShadowLearningDedupKey(
  scanId: string | undefined,
  symbol: string,
  nowKst?: string,
): string {
  if (scanId) return `${scanId}:${symbol}:ADR-0430`;
  const ts = nowKst ?? new Date().toISOString();
  const yyyymmddhhmm = ts.replace(/[^0-9]/g, '').slice(0, 12);
  return `${yyyymmddhhmm}:${symbol}:ADR-0430`;
}

/** 동일 scan 내 중복 entry 검사 (dedup). */
export function hasExistingCounterfactualShadowLearningEntry(
  scanId: string | undefined,
  symbol: string,
): boolean {
  const file = readLedgerFile();
  const key = buildCounterfactualShadowLearningDedupKey(scanId, symbol);
  for (const e of file.entries) {
    if (buildCounterfactualShadowLearningDedupKey(e.scanId, e.symbol) === key) return true;
  }
  return false;
}

/** 영속 read-only API — 진단·테스트 용도. */
export function loadCounterfactualShadowLearningLedger(): CounterfactualShadowLearningLedgerEntry[] {
  return readLedgerFile().entries;
}

/** 영속 reset — 테스트 격리 전용. */
export function __resetCounterfactualShadowLearningLedgerForTests(): void {
  if (fs.existsSync(COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE)) {
    fs.unlinkSync(COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE);
  }
}

export interface AppendCounterfactualShadowLearningInput {
  candidate: CounterfactualShadowLearningCandidate;
  scanId?: string;
  scannedAtKst?: string;
}

export type AppendCounterfactualShadowLearningResult =
  | { recorded: true; entry: CounterfactualShadowLearningLedgerEntry }
  | { recorded: false; reason: 'DUPLICATE' | 'PERSIST_ERROR' };

/**
 * Counterfactual Shadow Learning 후보 영속 기록 SSOT (사용자 §C 정합).
 *
 * 멱등 (동일 scanId+symbol 중복 차단). 영속 throw 안전 fallback.
 *
 * 안전 invariant:
 *   - 일반 shadow-trades.json 무수정 (별도 파일 COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_FILE)
 *   - ADR-0427 provisional-shadow-ledger.json 무수정 (분리 영속)
 *   - virtual account holdings/cash 무영향
 *   - eventType:'COUNTERFACTUAL_SHADOW_LEARNING_ENTRY' literal 영구 분리 마커
 */
export function appendCounterfactualShadowLearningEntry(
  input: AppendCounterfactualShadowLearningInput,
): AppendCounterfactualShadowLearningResult {
  const scanId = input.scanId ?? input.candidate.scanId;
  if (hasExistingCounterfactualShadowLearningEntry(scanId, input.candidate.symbol)) {
    return { recorded: false, reason: 'DUPLICATE' };
  }

  // candidate scanId 보존 — 호출자가 input.scanId 만 전달했을 경우 candidate 에 미반영.
  const entry: CounterfactualShadowLearningLedgerEntry = {
    ...input.candidate,
    ...(scanId !== undefined ? { scanId } : {}),
  };

  try {
    const file = readLedgerFile();
    file.entries.push(entry);
    if (file.entries.length > COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_MAX) {
      file.entries.splice(0, file.entries.length - COUNTERFACTUAL_SHADOW_LEARNING_LEDGER_MAX);
    }
    atomicWrite(file);
    return { recorded: true, entry };
  } catch (e) {
    console.warn(
      '[CounterfactualShadowLearningRepo] write 실패 — 매수 흐름 무영향',
      e,
    );
    return { recorded: false, reason: 'PERSIST_ERROR' };
  }
}

export interface CounterfactualShadowLearningSummary {
  totalEntries: number;
  todayEntries: number;
  topBlockedBy: Array<{ blocker: string; count: number }>;
  topLabels: Array<{ label: string; count: number }>;
  latestEntries: CounterfactualShadowLearningLedgerEntry[];
}

/** 진단·리포트용 합성 헬퍼 (사용자 §I 정합). */
export function summarizeCounterfactualShadowLearningLedger(
  entries?: CounterfactualShadowLearningLedgerEntry[],
  nowKst?: string,
): CounterfactualShadowLearningSummary {
  const all = entries ?? readLedgerFile().entries;
  const todayKey = (nowKst ?? new Date().toISOString()).slice(0, 10);
  const todayEntries = all.filter((e) => (e.createdAtKst ?? '').slice(0, 10) === todayKey).length;

  const blockedFreq = new Map<string, number>();
  const labelFreq = new Map<string, number>();
  for (const e of all) {
    for (const b of e.blockedBy ?? []) {
      blockedFreq.set(b, (blockedFreq.get(b) ?? 0) + 1);
    }
    if (e.label) labelFreq.set(e.label, (labelFreq.get(e.label) ?? 0) + 1);
  }

  return {
    totalEntries: all.length,
    todayEntries,
    topBlockedBy: Array.from(blockedFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([blocker, count]) => ({ blocker, count })),
    topLabels: Array.from(labelFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count })),
    latestEntries: all.slice(-10).reverse(),
  };
}
