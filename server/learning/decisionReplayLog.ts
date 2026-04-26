/**
 * @responsibility 매수/매도 결정 입력 스냅샷을 JSONL 로 영속하고 같은 입력으로 결과를 재계산해 비결정성을 탐지한다.
 *
 * 결정성 패치 Tier 2 #4 — 같은 입력에 다른 결정이 나오면 silent regression.
 * AI 호출이 끼어드는 경로는 `aiInvolved=true` 로 마킹해 비결정 영역을 분리.
 *
 * 본 PR 은 모듈 + replay API 만 제공. signalScanner/exitEngine 호출 wiring 은 후속 PR.
 */

import fs from 'fs';
import { decisionReplayFile, ensureDataDir } from '../persistence/paths.js';

/** 결정 종류 — buy 진입, sell 청산. */
export type DecisionKind = 'BUY' | 'SELL';

/**
 * 결정 입력 스냅샷 — 같은 입력으로 결과를 재계산하기 위한 최소 정보.
 *
 * - `gateScores`/`weights`/`macro` 는 결정 시점의 SSOT 캡처.
 * - `aiInvolved=true` 면 비결정 영역(Gemini 호출) 으로 마킹 — replay 시 결과 차이가
 *   비결정성 알람의 false-positive 가 되지 않도록 분리한다.
 */
export interface DecisionSnapshot {
  /** 식별자 — `{kind}:{symbol}:{ISO_at}:{nonce}` 권장. replayDecision 에서 lookup 키. */
  id: string;
  at: string;
  kind: DecisionKind;
  symbol: string;
  /** 결정 직전 가격 (원). */
  price: number;
  /** Gate 점수(예: G0/G1/G2/G3) — 키 자유. */
  gateScores: Record<string, number>;
  /** 조건 가중치 스냅샷. */
  weights: Record<string, number>;
  /** 매크로 상태 스냅샷 (regime/VIX 등 결정에 영향을 주는 외부 변수). */
  macro: Record<string, string | number | boolean>;
  /** 결정의 원본 결과 — replay 시 비교 대상. */
  outcome: {
    action: 'EXECUTE' | 'SKIP' | 'DEFER';
    reason?: string;
    /** 결정자가 산정한 quantity (BUY) 또는 partial ratio (SELL). */
    qty?: number;
  };
  /** AI(Gemini) 호출이 결정 경로에 포함됐는지. true 면 replay mismatch 는 비결정 영역. */
  aiInvolved: boolean;
  /** 선택 컨텍스트 (regime/leaderTag 등). */
  context?: Record<string, string | number | boolean>;
}

/** Replay 결과 — `evaluator` 가 같은 입력으로 재계산한 결과. */
export interface ReplayDecisionInput {
  /** 같은 입력에 같은 산출을 보장하는 평가 함수 (signalScanner 의 결정 로직 등). */
  evaluator: (snapshot: DecisionSnapshot) => DecisionSnapshot['outcome'];
}

export interface ReplayResult {
  found: true;
  match: boolean;
  original: DecisionSnapshot['outcome'];
  recomputed: DecisionSnapshot['outcome'];
  aiInvolved: boolean;
}

export interface ReplayNotFound {
  found: false;
  id: string;
}

function yyyymmdd(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * 결정 직전에 호출 — JSONL 한 줄 append. 본 함수는 throw 하지 않는다.
 * @returns 기록한 스냅샷 (timestamp 보강 포함). 기록 자체 실패 시 객체 그대로 반환.
 */
export function recordDecision(snapshot: DecisionSnapshot): DecisionSnapshot {
  try {
    ensureDataDir();
    const file = decisionReplayFile(yyyymmdd(new Date(snapshot.at)));
    fs.appendFileSync(file, JSON.stringify(snapshot) + '\n');
  } catch (e) {
    try { console.error('[decisionReplayLog] append 실패:', e instanceof Error ? e.message : e); } catch { /* noop */ }
  }
  return snapshot;
}

/** 일자 KST 기준 모든 스냅샷 — 최신순으로 반환. */
export function listDecisions(yyyymmddOrDate: string | Date): DecisionSnapshot[] {
  const key = typeof yyyymmddOrDate === 'string' ? yyyymmddOrDate : yyyymmdd(yyyymmddOrDate);
  const file = decisionReplayFile(key);
  if (!fs.existsSync(file)) return [];
  let raw: string;
  try { raw = fs.readFileSync(file, 'utf-8'); } catch { return []; }
  const lines = raw.split('\n').filter(Boolean);
  const out: DecisionSnapshot[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      out.push(JSON.parse(lines[i]) as DecisionSnapshot);
    } catch { /* 잘린 라인 무시 */ }
  }
  return out;
}

/** id 로 스냅샷 검색 — 오늘부터 최대 7일 과거까지 스캔. */
export function findDecision(id: string, now: Date = new Date()): DecisionSnapshot | null {
  for (let i = 0; i < 7; i++) {
    const probe = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const found = listDecisions(probe).find((d) => d.id === id);
    if (found) return found;
  }
  return null;
}

/**
 * Replay — 저장된 스냅샷을 같은 evaluator 로 재계산하고 결과 비교.
 *
 * `aiInvolved=true` 인 결정은 mismatch 가 발생해도 "비결정 영역" 으로 명시 분류 —
 * 호출자가 알람을 띄울지 말지 정책 분기 가능.
 */
export function replayDecision(id: string, input: ReplayDecisionInput): ReplayResult | ReplayNotFound {
  const snap = findDecision(id);
  if (!snap) return { found: false, id };
  const recomputed = input.evaluator(snap);
  const match =
    recomputed.action === snap.outcome.action &&
    (recomputed.reason ?? '') === (snap.outcome.reason ?? '') &&
    (recomputed.qty ?? null) === (snap.outcome.qty ?? null);
  return {
    found: true,
    match,
    original: snap.outcome,
    recomputed,
    aiInvolved: snap.aiInvolved,
  };
}

/** 일별 재계산 일괄 — `evaluator` 로 모든 스냅샷 replay 후 mismatch 통계 반환. */
export function replayDay(yyyymmddOrDate: string | Date, input: ReplayDecisionInput): {
  total: number;
  matched: number;
  mismatched: number;
  aiInvolvedMismatched: number;
  deterministicMismatched: number;
  examples: Array<{ id: string; original: DecisionSnapshot['outcome']; recomputed: DecisionSnapshot['outcome']; aiInvolved: boolean }>;
} {
  const list = listDecisions(yyyymmddOrDate);
  let matched = 0, mismatched = 0, aiInvolvedMismatched = 0, deterministicMismatched = 0;
  const examples: Array<{ id: string; original: DecisionSnapshot['outcome']; recomputed: DecisionSnapshot['outcome']; aiInvolved: boolean }> = [];
  for (const snap of list) {
    const recomputed = input.evaluator(snap);
    const ok =
      recomputed.action === snap.outcome.action &&
      (recomputed.reason ?? '') === (snap.outcome.reason ?? '') &&
      (recomputed.qty ?? null) === (snap.outcome.qty ?? null);
    if (ok) {
      matched++;
    } else {
      mismatched++;
      if (snap.aiInvolved) aiInvolvedMismatched++;
      else deterministicMismatched++;
      if (examples.length < 5) examples.push({ id: snap.id, original: snap.outcome, recomputed, aiInvolved: snap.aiInvolved });
    }
  }
  return { total: list.length, matched, mismatched, aiInvolvedMismatched, deterministicMismatched, examples };
}
