/**
 * @responsibility TradeSignalStatus 상태머신 영속·전이 SSOT (AI 추천→자동매매)
 *
 * ADR-0077 — AI 추천이 자동매매 큐에 진입하기까지 7단계 게이트를 통과하는 과정을
 * 명시적 6 상태 전이로 영속한다. 본 모듈은 *상태 기록 레이어* — 차단·통과 결정은
 * 기존 게이트 본체(EntryGate Phase B / RevalidationStep / SizingDecider / buyApproval)
 * 가 그대로 담당, 본 모듈은 결과만 기록한다.
 *
 * 영속 정책:
 * - atomic write (tmp → rename, 영속 race 시 이전 정상 본 보존)
 * - FIFO trim 1000건 (createdAt 내림차순, 최근 우선)
 * - transitions 배열 max 32 (안전망 — 정상 시나리오는 6 이하)
 * - 손상 JSON / 빈 파일 / null / array 가 아닌 직렬화 → 빈 배열 fallback
 * - 모든 mutating API 동기 (Promise X), fs.writeFileSync 사용
 * - canTransition false 시 silent skip (return current record), throw 안 함
 * - 잘못된 입력 (id 빈 문자열, 미등록 BlockGate 등) → null 반환, 영속 변경 없음
 *
 * 외부 의존성: fs/path + paths.ts 만. KIS/KRX/orchestrator import 0건 (절대 규칙
 * #2/#3/#4 자동 준수).
 */

import fs from 'fs';
import path from 'path';
import { TRADE_SIGNAL_STATUS_FILE, ensureDataDir } from './paths.js';

// ─── 타입 export ─────────────────────────────────────────────────────────────

export type TradeSignalStatus =
  | 'AI_CANDIDATE'
  | 'DATA_VERIFIED'
  | 'RISK_APPROVED'
  | 'USER_APPROVED'
  | 'AUTO_TRADE_READY'
  | 'BLOCKED';

export type TradeSignalBlockGate =
  | 'DATA'
  | 'GATE_0'
  | 'GATE_1'
  | 'GATE_2'
  | 'GATE_3'
  | 'RISK_BUDGET'
  | 'SECTOR'
  | 'PORTFOLIO'
  | 'ENEMY'
  | 'USER_REJECT'
  | 'AUTO_TRADE_DISABLED'
  | 'EMERGENCY_STOP'
  | 'OTHER';

interface TradeSignalTransition {
  /** null = 초기 진입 (AI_CANDIDATE 첫 등록) */
  from: TradeSignalStatus | null;
  to: TradeSignalStatus;
  reason: string;
  /** ISO timestamp */
  at: string;
}

export interface TradeSignalRecord {
  /** `${signalTimeIso}:${stockCode}` */
  id: string;
  stockCode: string;
  stockName: string;
  status: TradeSignalStatus;
  recommendationType: 'STRONG_BUY' | 'BUY' | 'CONFIRMED_STRONG_BUY';
  signalGateScore?: number;
  /** AI_CANDIDATE 진입 ISO */
  createdAt: string;
  transitions: TradeSignalTransition[];
  blockReason?: string;
  blockGate?: TradeSignalBlockGate;
  /** status ∈ {AUTO_TRADE_READY, BLOCKED} 도달 ISO */
  finalizedAt?: string;
  schemaVersion: 1;
}

// ─── 상수 SSOT ───────────────────────────────────────────────────────────────

export const TRADE_SIGNAL_STATUS_MAX = 1000;
const CURRENT_TRADE_SIGNAL_SCHEMA_VERSION = 1 as const;
const TRANSITIONS_MAX = 32;

export const ALL_TRADE_SIGNAL_STATUSES: readonly TradeSignalStatus[] = [
  'AI_CANDIDATE',
  'DATA_VERIFIED',
  'RISK_APPROVED',
  'USER_APPROVED',
  'AUTO_TRADE_READY',
  'BLOCKED',
] as const;

export const ALL_BLOCK_GATES: readonly TradeSignalBlockGate[] = [
  'DATA',
  'GATE_0',
  'GATE_1',
  'GATE_2',
  'GATE_3',
  'RISK_BUDGET',
  'SECTOR',
  'PORTFOLIO',
  'ENEMY',
  'USER_REJECT',
  'AUTO_TRADE_DISABLED',
  'EMERGENCY_STOP',
  'OTHER',
] as const;

const BLOCK_GATE_SET: Set<TradeSignalBlockGate> = new Set(ALL_BLOCK_GATES);

const TERMINAL_STATUSES: ReadonlySet<TradeSignalStatus> = new Set([
  'AUTO_TRADE_READY',
  'BLOCKED',
]);

// ─── 상태 전이 매트릭스 SSOT ─────────────────────────────────────────────────

/**
 * @param from null = 초기 (record 미존재)
 * @param to 목표 상태
 */
export function canTransition(
  from: TradeSignalStatus | null,
  to: TradeSignalStatus,
): boolean {
  if (to === 'BLOCKED') {
    // BLOCKED 는 terminal 외 모든 상태에서 진입 가능 (단, AUTO_TRADE_READY 도달 후 BLOCK 불가)
    return from !== null && from !== 'BLOCKED' && from !== 'AUTO_TRADE_READY';
  }
  if (to === 'AI_CANDIDATE') return from === null;
  if (to === 'DATA_VERIFIED') return from === 'AI_CANDIDATE';
  if (to === 'RISK_APPROVED') return from === 'DATA_VERIFIED';
  if (to === 'USER_APPROVED') return from === 'RISK_APPROVED';
  if (to === 'AUTO_TRADE_READY') {
    // RISK_APPROVED 직접 전이 허용 (SHADOW + 향후 auto-approve 정책)
    return from === 'USER_APPROVED' || from === 'RISK_APPROVED';
  }
  return false;
}

// ─── ID 생성 SSOT ────────────────────────────────────────────────────────────

export function buildSignalId(signalTimeIso: string, stockCode: string): string {
  return `${signalTimeIso}:${stockCode}`;
}

// ─── 영속 I/O ─────────────────────────────────────────────────────────────────

interface RepoFile {
  schemaVersion: number;
  records: TradeSignalRecord[];
}

function readRaw(): RepoFile {
  ensureDataDir();
  if (!fs.existsSync(TRADE_SIGNAL_STATUS_FILE)) {
    return { schemaVersion: CURRENT_TRADE_SIGNAL_SCHEMA_VERSION, records: [] };
  }
  try {
    const content = fs.readFileSync(TRADE_SIGNAL_STATUS_FILE, 'utf-8');
    if (!content || content.trim().length === 0) {
      return { schemaVersion: CURRENT_TRADE_SIGNAL_SCHEMA_VERSION, records: [] };
    }
    const parsed = JSON.parse(content) as Partial<RepoFile> | null;
    if (!parsed || !Array.isArray(parsed.records)) {
      return { schemaVersion: CURRENT_TRADE_SIGNAL_SCHEMA_VERSION, records: [] };
    }
    return {
      schemaVersion: parsed.schemaVersion ?? CURRENT_TRADE_SIGNAL_SCHEMA_VERSION,
      records: parsed.records,
    };
  } catch (e: unknown) {
    console.warn(
      '[TradeSignalStatusRepo] 영속 파일 손상 — 빈 배열 fallback:',
      e instanceof Error ? e.message : e,
    );
    return { schemaVersion: CURRENT_TRADE_SIGNAL_SCHEMA_VERSION, records: [] };
  }
}

function writeAtomic(records: TradeSignalRecord[]): void {
  ensureDataDir();
  // FIFO trim — 1000건 초과 시 createdAt 내림차순 정렬 후 최근 1000건 보존
  let trimmed = records;
  if (records.length > TRADE_SIGNAL_STATUS_MAX) {
    trimmed = [...records]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, TRADE_SIGNAL_STATUS_MAX);
  }
  const dir = path.dirname(TRADE_SIGNAL_STATUS_FILE);
  const tmp = path.join(dir, `.trade-signal-status.tmp.${process.pid}`);
  const data: RepoFile = {
    schemaVersion: CURRENT_TRADE_SIGNAL_SCHEMA_VERSION,
    records: trimmed,
  };
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, TRADE_SIGNAL_STATUS_FILE);
}

// ─── 입력 검증 헬퍼 ───────────────────────────────────────────────────────────

function isNonEmptyString(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0;
}

function appendTransition(
  record: TradeSignalRecord,
  to: TradeSignalStatus,
  reason: string,
  nowIso: string,
): TradeSignalRecord {
  const transition: TradeSignalTransition = {
    from: record.status,
    to,
    reason,
    at: nowIso,
  };
  const transitions = [...record.transitions, transition];
  // transitions 배열 max 32 안전망 — 가장 오래된 항목부터 trim (정상 시나리오는 6 이하)
  const trimmed =
    transitions.length > TRANSITIONS_MAX
      ? transitions.slice(transitions.length - TRANSITIONS_MAX)
      : transitions;
  return { ...record, status: to, transitions: trimmed };
}

// ─── Read API ─────────────────────────────────────────────────────────────────

/** 부팅 시 1회 + 호출자 read-only. */
export function loadTradeSignalRecords(): TradeSignalRecord[] {
  return readRaw().records.slice();
}

/**
 * UI/진단용 — 최근 record N건 (createdAt 내림차순).
 *
 * @param limit 기본 50, 음수/0 → 빈 배열
 */
export function getRecentTradeSignalRecords(limit: number = 50): TradeSignalRecord[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return [...readRaw().records]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.floor(limit));
}

/** 단건 조회 — 미등록 시 null. */
export function getTradeSignalRecord(id: string): TradeSignalRecord | null {
  if (!isNonEmptyString(id)) return null;
  const records = readRaw().records;
  return records.find(r => r.id === id) ?? null;
}

// ─── Mutating API ─────────────────────────────────────────────────────────────

export function recordAiCandidate(input: {
  signalTimeIso: string;
  stockCode: string;
  stockName: string;
  recommendationType: TradeSignalRecord['recommendationType'];
  signalGateScore?: number;
  reason?: string;
  now?: Date;
}): TradeSignalRecord | null {
  if (!isNonEmptyString(input.signalTimeIso)) return null;
  if (!isNonEmptyString(input.stockCode)) return null;
  if (!isNonEmptyString(input.stockName)) return null;
  if (
    input.recommendationType !== 'STRONG_BUY' &&
    input.recommendationType !== 'BUY' &&
    input.recommendationType !== 'CONFIRMED_STRONG_BUY'
  ) {
    return null;
  }

  const id = buildSignalId(input.signalTimeIso, input.stockCode);
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const reason = input.reason ?? 'AI 추천 후보 발생';

  const file = readRaw();
  const existingIdx = file.records.findIndex(r => r.id === id);

  if (existingIdx >= 0) {
    // 멱등 — 동일 id 존재 시 기존 record 그대로 반환 (영속 변경 없음)
    return file.records[existingIdx];
  }

  if (!canTransition(null, 'AI_CANDIDATE')) {
    // 정의상 항상 true — 안전망
    return null;
  }

  const record: TradeSignalRecord = {
    id,
    stockCode: input.stockCode,
    stockName: input.stockName,
    status: 'AI_CANDIDATE',
    recommendationType: input.recommendationType,
    signalGateScore:
      typeof input.signalGateScore === 'number' && Number.isFinite(input.signalGateScore)
        ? input.signalGateScore
        : undefined,
    createdAt: nowIso,
    transitions: [
      {
        from: null,
        to: 'AI_CANDIDATE',
        reason,
        at: nowIso,
      },
    ],
    schemaVersion: CURRENT_TRADE_SIGNAL_SCHEMA_VERSION,
  };

  const next = [...file.records, record];
  writeAtomic(next);
  return record;
}

function transitionRecord(
  id: string,
  to: TradeSignalStatus,
  reason: string,
  now: Date | undefined,
): TradeSignalRecord | null {
  if (!isNonEmptyString(id)) return null;
  const file = readRaw();
  const idx = file.records.findIndex(r => r.id === id);
  if (idx < 0) return null;
  const current = file.records[idx];

  // 멱등: 이미 동일 status 면 silent skip — record 그대로 반환
  if (current.status === to) return current;

  // canTransition false 시 silent skip — record 그대로 반환 (throw 안 함)
  if (!canTransition(current.status, to)) return current;

  const nowIso = (now ?? new Date()).toISOString();
  let updated = appendTransition(current, to, reason, nowIso);

  // terminal 상태 도달 시 finalizedAt 설정
  if (TERMINAL_STATUSES.has(to)) {
    updated = { ...updated, finalizedAt: nowIso };
  }

  const next = [...file.records.slice(0, idx), updated, ...file.records.slice(idx + 1)];
  writeAtomic(next);
  return updated;
}

export function markDataVerified(input: {
  id: string;
  reason?: string;
  now?: Date;
}): TradeSignalRecord | null {
  return transitionRecord(
    input.id,
    'DATA_VERIFIED',
    input.reason ?? '데이터 검증 통과',
    input.now,
  );
}

export function markRiskApproved(input: {
  id: string;
  reason?: string;
  now?: Date;
}): TradeSignalRecord | null {
  return transitionRecord(
    input.id,
    'RISK_APPROVED',
    input.reason ?? '리스크 검증 통과',
    input.now,
  );
}

export function markUserApproved(input: {
  id: string;
  approvedBy?: string;
  reason?: string;
  now?: Date;
}): TradeSignalRecord | null {
  const reason =
    input.reason ?? `사용자 승인 (${input.approvedBy ?? 'unknown'})`;
  return transitionRecord(input.id, 'USER_APPROVED', reason, input.now);
}

export function markAutoTradeReady(input: {
  id: string;
  reason?: string;
  now?: Date;
}): TradeSignalRecord | null {
  return transitionRecord(
    input.id,
    'AUTO_TRADE_READY',
    input.reason ?? '실주문 직전 진입',
    input.now,
  );
}

export function markBlocked(input: {
  id: string;
  gate: TradeSignalBlockGate;
  reason: string;
  now?: Date;
}): TradeSignalRecord | null {
  if (!isNonEmptyString(input.id)) return null;
  if (!BLOCK_GATE_SET.has(input.gate)) return null;
  if (!isNonEmptyString(input.reason)) return null;

  const file = readRaw();
  const idx = file.records.findIndex(r => r.id === input.id);
  if (idx < 0) return null;
  const current = file.records[idx];

  // 멱등: 이미 BLOCKED 면 silent skip
  if (current.status === 'BLOCKED') return current;

  // canTransition false 시 silent skip (예: AUTO_TRADE_READY 도달 후)
  if (!canTransition(current.status, 'BLOCKED')) return current;

  const nowIso = (input.now ?? new Date()).toISOString();
  const transitioned = appendTransition(current, 'BLOCKED', input.reason, nowIso);
  const updated: TradeSignalRecord = {
    ...transitioned,
    blockGate: input.gate,
    blockReason: input.reason,
    finalizedAt: nowIso,
  };

  const next = [...file.records.slice(0, idx), updated, ...file.records.slice(idx + 1)];
  writeAtomic(next);
  return updated;
}

// ─── 테스트 격리 헬퍼 ─────────────────────────────────────────────────────────
