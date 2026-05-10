// @responsibility counterfactualUniverseLearningRepo — ADR-0433 영속 SSOT (universe-level).
//
// ADR-0433:
// SELL_ONLY / HARD_BLOCK may stop execution before candidate-level learning lanes
// are reached. Universe-level counterfactual learning preserves the scan context
// at preflight abort time without opening execution, paper, normal shadow,
// provisional shadow, or virtual-account paths.
//
// 핵심 불변식 (사용자 명시 §"절대 하지 말 것" 정합):
//   1. shadow-trades.json 와 분리 — 일반 shadow buy 와 섞이지 않음
//   2. provisional-shadow-ledger.json 와 분리 — ADR-0427 후보별 entry 와 섞이지 않음
//   3. counterfactual-shadow-learning-ledger.json 와 분리 — ADR-0430 후보별 record 와 섞이지 않음
//   4. virtual account holdings/cash 무관 — metadata 만
//   5. dedup key 동일 scan/stage 내 중복 차단 (`${scanId}:ADR-0433:${preflightStage}`)
//   6. KIS 주문 함수 import 0건 (정적 grep 가드)
//   7. autoTradeEngine / orderExecutor / trancheExecutor / shadowTradeRepo import 0건
//   8. LIVE 매매 본체 무수정
//   9. eventType:'COUNTERFACTUAL_UNIVERSE_LEARNING_SNAPSHOT' literal — 분리 마커
//  10. 외부 fetch / axios 호출 0건 (정적 grep 가드)

import * as fs from 'fs';
import * as path from 'path';
import { COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE } from './paths.js';

/** FIFO trim 한계 — ADR-0430 ledger 와 동일 (분리 영속이라 격리 카운트). */
export const COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_MAX = 2000;

/** Snapshot 저장 시 후보 summary 최대 개수 — 사용자 §B 명시 (Top N ≤ 50). */
export const UNIVERSE_LEARNING_MAX_CANDIDATE_SUMMARIES = 50;

/**
 * preflight abort 사유 union — 사용자 §B 명시 (절대 변경 금지).
 *
 * `LEARNING_ONLY` / `UNKNOWN` 은 호출자가 reason 합성 실패 시 사용하는 fallback marker.
 */
export type CounterfactualUniverseLearningReason =
  | 'SELL_ONLY_PREFLIGHT'
  | 'HARD_BLOCK_PREFLIGHT'
  | 'R6_DEFENSE_PREFLIGHT'
  | 'EMERGENCY_STOP_PREFLIGHT'
  | 'VIX_BLOCK_PREFLIGHT'
  | 'FOMC_BLOCK_PREFLIGHT'
  | 'MANUAL_BUY_BLOCK_PREFLIGHT'
  | 'SCAN_ABORTED_BEFORE_GATE'
  | 'CANDIDATE_EVALUATION_SKIPPED'
  | 'LEARNING_ONLY'
  | 'UNKNOWN';

/**
 * preflight abort 가 발생한 단계 — 사용자 §B 명시.
 *
 * 후보 컨텍스트의 풍부도를 결정 (BEFORE_UNIVERSE_BUILD 일 때 candidates 0건,
 * BEFORE_BUYLIST_LOOP 일 때 candidates Top N 50개).
 */
export type CounterfactualUniversePreflightStage =
  | 'BEFORE_UNIVERSE_BUILD'
  | 'AFTER_UNIVERSE_BUILD'
  | 'AFTER_CANDIDATE_SCAN'
  | 'BEFORE_BUYLIST_LOOP'
  | 'UNKNOWN';

/**
 * lightweight candidate summary — 사용자 §E 명시 (raw payload 절대 저장 금지).
 *
 * 모든 필드 옵셔널 — 후보별 정보가 없어도 빈 entry 절대 생성 금지 (호출자 측에서
 * candidates 자체를 빈 배열로 전달).
 */
export interface CounterfactualUniverseCandidateSummary {
  symbol: string;
  name?: string;
  lastPrice?: number;
  changePct?: number;
  volume?: number;
  turnover?: number;
  sector?: string;
  source?: string;
  rank?: number;
}

/**
 * universe-level learning snapshot schema — 사용자 §B 명시.
 *
 * literal markers (`learningOnly:true` / `executionShadow:false` /
 * `virtualAccountImpact:'NONE'` / `liveAllowed:false` / `paperAllowed:false` /
 * `executionShadowAllowed:false`) 모두 TypeScript 강제 — 호출자 invariant 위반 시
 * 컴파일 에러.
 */
export interface CounterfactualUniverseLearningSnapshot {
  id: string;
  eventType: 'COUNTERFACTUAL_UNIVERSE_LEARNING_SNAPSHOT';
  source: 'ADR-0433';
  learningOnly: true;
  executionShadow: false;
  virtualAccountImpact: 'NONE';
  liveAllowed: false;
  paperAllowed: false;
  executionShadowAllowed: false;

  scanId?: string;
  createdAtKst: string;
  regime?: string;
  routerSeverity?: string;
  routerLabel?: string;
  blockedBy: string[];
  reasons: CounterfactualUniverseLearningReason[];

  universeSize?: number;
  candidateCount?: number;
  candidateSummaryCount?: number;
  candidates?: CounterfactualUniverseCandidateSummary[];

  preflightStage: CounterfactualUniversePreflightStage;

  marketSnapshot?: {
    riskMode?: string;
    sellOnly?: boolean;
    r6Defense?: boolean;
    emergencyStop?: boolean;
    regime?: string;
    vkospiLevel?: number;
    marketHealth?: string;
  };

  notes?: string[];
}

/** dedup key SSOT — 사용자 §C 명시 패턴. */
export function buildCounterfactualUniverseLearningDedupKey(
  scanId: string | undefined,
  preflightStage: CounterfactualUniversePreflightStage,
  fallbackKstMinute: string,
): string {
  const idKey = scanId && scanId.trim().length > 0 ? scanId : fallbackKstMinute;
  return `${idKey}:ADR-0433:${preflightStage}`;
}

interface LedgerFile {
  version: 1;
  entries: CounterfactualUniverseLearningSnapshot[];
}

function readLedgerFile(): LedgerFile {
  try {
    if (!fs.existsSync(COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE)) {
      return { version: 1, entries: [] };
    }
    const raw = fs.readFileSync(COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as LedgerFile).entries)) {
      return { version: 1, entries: [] };
    }
    return parsed as LedgerFile;
  } catch (e) {
    console.warn('[CounterfactualUniverseLearningRepo] read 실패 — 빈 ledger fallback', e);
    return { version: 1, entries: [] };
  }
}

function atomicWrite(file: LedgerFile): void {
  const dir = path.dirname(COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf-8');
  fs.renameSync(tmp, COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE);
}

/** Read-only loader — UI 진단·텔레그램 명령에서 사용. */
export function loadCounterfactualUniverseLearningLedger(): CounterfactualUniverseLearningSnapshot[] {
  return readLedgerFile().entries;
}

/**
 * dedup 검사 — 동일 scanId+stage snapshot 이 이미 영속됐는지 확인.
 * 호출자 측 결정 트리 (사용자 §I — 후보별 entry 가 동일 scan 에 이미 record 되었으면
 * universe snapshot record 안 함) 의 입력.
 */
export function hasExistingUniverseSnapshot(
  scanId: string | undefined,
  preflightStage: CounterfactualUniversePreflightStage,
): boolean {
  if (!scanId || scanId.trim().length === 0) return false;
  const ledger = readLedgerFile();
  return ledger.entries.some(
    (e) => e.scanId === scanId && e.preflightStage === preflightStage,
  );
}

/**
 * append SSOT — universe-level learning snapshot 영속.
 *
 * - dedup: 동일 dedup key snapshot 이 이미 있으면 no-op (사용자 §J #5).
 * - FIFO trim: COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_MAX 초과 시 oldest 제거.
 * - atomic write: tmp → rename, 손상된 JSON 부분 write 차단.
 *
 * 절대 invariant:
 *   - shadow-trades / provisional-shadow / counterfactual-shadow-learning ledger 무관
 *   - virtual account 무관 (snapshot.metadata 도 holdings/cash 미포함)
 *   - record 실패는 throw 가 아니라 console.warn — 호출자 abort 흐름 보호 (사용자 §J #15)
 */
export function appendCounterfactualUniverseLearningSnapshot(
  snapshot: CounterfactualUniverseLearningSnapshot,
): { recorded: boolean; reason?: string } {
  try {
    const ledger = readLedgerFile();
    const dupKey = `${snapshot.scanId ?? '__NO_SCAN__'}:${snapshot.preflightStage}`;
    const isDup = ledger.entries.some(
      (e) => `${e.scanId ?? '__NO_SCAN__'}:${e.preflightStage}` === dupKey && e.scanId === snapshot.scanId,
    );
    if (isDup) {
      return { recorded: false, reason: 'duplicate' };
    }
    ledger.entries.push(snapshot);
    if (ledger.entries.length > COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_MAX) {
      ledger.entries.splice(0, ledger.entries.length - COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_MAX);
    }
    atomicWrite(ledger);
    return { recorded: true };
  } catch (e) {
    console.warn('[CounterfactualUniverseLearningRepo] append 실패 — 격리 (호출자 흐름 보호)', e);
    return { recorded: false, reason: 'write-failed' };
  }
}

/**
 * 진단 summary — 운영자 텔레그램 명령에서 사용.
 *
 * blockedByBreakdown / preflightStageBreakdown 자동 계산 + 최근 snapshot 요약.
 */
export interface CounterfactualUniverseLearningSummary {
  totalSnapshots: number;
  todaySnapshots: number;
  blockedByBreakdown: Record<string, number>;
  preflightStageBreakdown: Record<string, number>;
  reasonBreakdown: Record<string, number>;
  latestSnapshot?: CounterfactualUniverseLearningSnapshot;
}

export function summarizeCounterfactualUniverseLearningLedger(
  nowKst?: string,
): CounterfactualUniverseLearningSummary {
  const entries = loadCounterfactualUniverseLearningLedger();
  const todayKst =
    nowKst ??
    new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const blockedByBreakdown: Record<string, number> = {};
  const preflightStageBreakdown: Record<string, number> = {};
  const reasonBreakdown: Record<string, number> = {};
  let todaySnapshots = 0;
  for (const e of entries) {
    if (e.createdAtKst.slice(0, 10) === todayKst) todaySnapshots++;
    for (const b of e.blockedBy) {
      blockedByBreakdown[b] = (blockedByBreakdown[b] ?? 0) + 1;
    }
    preflightStageBreakdown[e.preflightStage] =
      (preflightStageBreakdown[e.preflightStage] ?? 0) + 1;
    for (const r of e.reasons) {
      reasonBreakdown[r] = (reasonBreakdown[r] ?? 0) + 1;
    }
  }
  const latestSnapshot = entries.length > 0 ? entries[entries.length - 1] : undefined;
  return {
    totalSnapshots: entries.length,
    todaySnapshots,
    blockedByBreakdown,
    preflightStageBreakdown,
    reasonBreakdown,
    latestSnapshot,
  };
}

/**
 * /scan_blockers learning status 요약 — 사용자 PATCH-C 명세.
 *
 * 직전 1건 snapshot 만 표시 (텔레그램 길이 제한). 영속 ledger 가 비어 있으면 null.
 * 기존 `Counterfactual Universe Learning` 섹션을 운영자가 먼저 보는 `Learning Status`로
 * 승격하되, live/paper/order path 와는 무관한 read-only formatter 이다.
 */
export function formatCounterfactualUniverseLearningSummarySection(
  summary: CounterfactualUniverseLearningSummary,
): string | null {
  if (summary.totalSnapshots === 0) return null;
  const latest = summary.latestSnapshot;
  if (!latest) return null;
  const lines: string[] = [];
  const topBlockedReason = latest.blockedBy[0] ?? latest.reasons[0] ?? 'UNKNOWN';
  const universeSnapshotStatus = latest.preflightStage === 'UNKNOWN' ? 'RECORDED_PARTIAL' : 'RECORDED';

  lines.push('🧠 <b>Learning Status</b>');
  lines.push(`• Real execution: ${latest.liveAllowed ? 'ALLOWED' : 'BLOCKED'}`);
  lines.push(`• Shadow learning: RECORDED`);
  lines.push(`• Universe snapshot: ${universeSnapshotStatus}`);
  lines.push(`• executionImpact: NONE`);
  lines.push(`• topBlockedReason: ${topBlockedReason}`);
  lines.push(`• today: ${summary.todaySnapshots}건 / total: ${summary.totalSnapshots}건`);
  lines.push('');
  lines.push('🧠 <b>Counterfactual Universe Learning (ADR-0433)</b>');
  lines.push(`• learningOnly: ✅`);
  lines.push(`• latest stage: ${latest.preflightStage}`);
  if (latest.blockedBy.length > 0) {
    lines.push(`• blockedBy: ${latest.blockedBy.join(', ')}`);
  }
  if (latest.candidateSummaryCount && latest.candidateSummaryCount > 0) {
    lines.push(`• candidateSummaryCount: ${latest.candidateSummaryCount}`);
  }
  lines.push(
    `<i>preflight 차단으로 buyListLoop 까지 가지 못한 universe 를 학습 snapshot 으로 보존.</i>`,
  );
  return lines.join('\n');
}

/** Test isolation 헬퍼 — 본 ledger 격리. test 외 호출자 0건. */
export function __resetCounterfactualUniverseLearningLedgerForTests(): void {
  try {
    if (fs.existsSync(COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE)) {
      fs.unlinkSync(COUNTERFACTUAL_UNIVERSE_LEARNING_LEDGER_FILE);
    }
  } catch {
    /* ignore */
  }
}
