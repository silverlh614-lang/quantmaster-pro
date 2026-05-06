/**
 * @responsibility R3 Violation streak 영속 SSOT — 단계형 state machine 입력
 *
 * ADR-0401 — 같은 violation+regime 의 연속 발생 횟수를 영속해 5단계 state machine
 * (CLEAN→WARNING→ELEVATED→SHADOW_ONLY→HARD_BLOCK) 의 임계 평가 입력으로 사용한다.
 *
 * 정책 SSOT (ADR-0401 §6 결정):
 *   - 24h decay (default) — `lastSeenAt` 부터 24h 초과 시 자동 reset (무한 누적 차단)
 *   - ENV `R3_VIOLATION_STREAK_DECAY_HOURS` — Number 변환 + NaN/0/음수 fallback default 24
 *   - scanIds[] 마지막 1건 비교 — 같은 스캔 사이클 중복 호출 시 +1 차단
 *   - violation 또는 regime 변경 시 consecutiveCount=1 (다른 위반 시작)
 *
 * Atomic write (tmp → rename) — race 차단. 손상 JSON / schemaVersion 불일치 시
 * 빈 상태 fallback. 외부 의존성 0 (fs / paths.ts 만, KIS 주문 함수 import 0건).
 *
 * 호출자: `r3ViolationStateMachine.ts` (단일 진입점) + `r3Unblock.cmd.ts` (reset 호출).
 */

import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'fs';
import { ensureDataDir, R3_VIOLATION_STREAK_FILE } from './paths.js';

export type R3SanityViolationType =
  | 'NONE'
  | 'GATE1_PASS_ZERO'
  | 'GATE_PASS_DATA_MISSING'
  | 'CANDIDATES_ZERO';

export interface R3ViolationStreakState {
  schemaVersion: 1;
  violation: R3SanityViolationType;
  regime: string;
  consecutiveCount: number;
  /** ISO — 첫 발생 시각 (decay 진단용) */
  firstSeenAt: string;
  /** ISO — 마지막 갱신 시각 (decay 임계 비교용) */
  lastSeenAt: string;
  /** 마지막 1개 scanId — 같은 스캔 사이클 중복 호출 +1 차단 */
  scanIds: string[];
}

const DEFAULT_DECAY_HOURS = 24;
const SCAN_IDS_KEEP = 1;

const EMPTY_STATE: R3ViolationStreakState = {
  schemaVersion: 1,
  violation: 'NONE',
  regime: '',
  consecutiveCount: 0,
  firstSeenAt: '',
  lastSeenAt: '',
  scanIds: [],
};

/* ───────── ENV 헬퍼 SSOT ───────── */

/**
 * `R3_VIOLATION_STREAK_DECAY_HOURS` 정확 비교 (ADR-0157).
 *
 * Number 변환 → NaN/Infinity/0/음수 → default 24 fallback.
 * 양수 정수 외 (예: '2.5') 도 허용 (정수 강제 안 함, Math.floor 변환).
 *
 * `=0` 명시 시 default 24 로 폴백 — *완전 비활성* 의도가 있으면 운영자가
 * `=0.001` 같은 매우 작은 값 사용 (effective 매번 reset). 이는 본 PR 의 회귀
 * 발견 시 ADR-0120 단일 발생 즉시 차단 동작으로 effective rollback 하는
 * 안전망 (별도 disable ENV 미도입 정책, ADR-0401 §11).
 */
export function getR3ViolationStreakDecayHours(): number {
  const raw = process.env.R3_VIOLATION_STREAK_DECAY_HOURS;
  if (raw === undefined || raw === '') return DEFAULT_DECAY_HOURS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DECAY_HOURS;
  return n;
}

/* ───────── 내부 헬퍼 ───────── */

function isValidViolationType(v: unknown): v is R3SanityViolationType {
  return v === 'NONE' || v === 'GATE1_PASS_ZERO' || v === 'GATE_PASS_DATA_MISSING' || v === 'CANDIDATES_ZERO';
}

function emptyState(): R3ViolationStreakState {
  return {
    schemaVersion: 1,
    violation: 'NONE',
    regime: '',
    consecutiveCount: 0,
    firstSeenAt: '',
    lastSeenAt: '',
    scanIds: [],
  };
}

function parseStored(raw: string): R3ViolationStreakState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  if (!parsed || typeof parsed !== 'object') return emptyState();
  const o = parsed as Record<string, unknown>;
  if (o.schemaVersion !== 1) return emptyState();
  const violation = isValidViolationType(o.violation) ? o.violation : 'NONE';
  const regime = typeof o.regime === 'string' ? o.regime : '';
  const consecutiveCount =
    typeof o.consecutiveCount === 'number' && Number.isFinite(o.consecutiveCount) && o.consecutiveCount >= 0
      ? Math.floor(o.consecutiveCount)
      : 0;
  const firstSeenAt = typeof o.firstSeenAt === 'string' ? o.firstSeenAt : '';
  const lastSeenAt = typeof o.lastSeenAt === 'string' ? o.lastSeenAt : '';
  const scanIds: string[] =
    Array.isArray(o.scanIds) ? o.scanIds.filter((x): x is string => typeof x === 'string').slice(-SCAN_IDS_KEEP) : [];
  return { schemaVersion: 1, violation, regime, consecutiveCount, firstSeenAt, lastSeenAt, scanIds };
}

/* ───────── Public API ───────── */

/**
 * 영속 streak 상태 로드. 파일 부재 / 손상 / schemaVersion 불일치 시 빈 상태 반환.
 *
 * 손상 JSON 시 graceful fallback (운영 안전성 우선).
 */
export function loadR3ViolationStreakState(): R3ViolationStreakState {
  ensureDataDir();
  if (!existsSync(R3_VIOLATION_STREAK_FILE)) return emptyState();
  let raw: string;
  try {
    raw = readFileSync(R3_VIOLATION_STREAK_FILE, 'utf-8');
  } catch {
    return emptyState();
  }
  if (!raw || raw.trim().length === 0) return emptyState();
  return parseStored(raw);
}

/**
 * 영속 streak 상태 저장. atomic write (tmp → rename) — race 차단.
 *
 * scanIds 는 마지막 1건만 영속 (디스크 사용량 최소화).
 */
export function saveR3ViolationStreakState(state: R3ViolationStreakState): void {
  ensureDataDir();
  const tmp = `${R3_VIOLATION_STREAK_FILE}.tmp`;
  const trimmed: R3ViolationStreakState = {
    ...state,
    schemaVersion: 1,
    scanIds: state.scanIds.slice(-SCAN_IDS_KEEP),
  };
  writeFileSync(tmp, JSON.stringify(trimmed, null, 2), { encoding: 'utf-8' });
  renameSync(tmp, R3_VIOLATION_STREAK_FILE);
}

/**
 * Streak 강제 reset — `/r3_unblock` 호출 시 latch 해제와 함께 사용.
 *
 * `acknowledgeR3SanityBlock()` 호출 직후 본 함수 호출하여 운영자가 latch 해제 시
 * 다시 누적 시작하도록 보장 (절대 원칙 #15 정합).
 *
 * 파일 부재 시 silent skip.
 */
export function resetR3ViolationStreakState(): void {
  ensureDataDir();
  if (existsSync(R3_VIOLATION_STREAK_FILE)) {
    try {
      unlinkSync(R3_VIOLATION_STREAK_FILE);
    } catch (e) {
      // best-effort — 삭제 실패해도 진행 (호출자가 새 streak 저장하면 자연 덮어씀)
      console.warn('[r3ViolationStreakRepo] reset 실패:', e);
    }
  }
}

/**
 * Streak 갱신 입력 — 호출자 (state machine) 가 매 스캔 사이클마다 호출.
 */
export interface UpdateR3StreakInput {
  /** evaluateR3Sanity 결과 violation. 'NONE' 시 streak reset (호출자 단순화). */
  violation: R3SanityViolationType;
  /** macroGateState.regime — 'R3_EARLY' / 'R3_CONFIRMED' 등. */
  regime: string;
  /**
   * 같은 스캔 사이클 식별자 — 중복 +1 차단용. ISO 시각 또는 KST 일자+time 합성 권장.
   * 부재 시 매번 +1 (테스트 격리용 — 실 사용에서는 의무 권장).
   */
  scanId?: string;
  /** 시간 의존 격리 (테스트용). 미전달 시 new Date(). */
  now?: Date;
}

/**
 * Streak 갱신 SSOT — ADR-0401 §6 결정 트리 정합.
 *
 * 결정 우선순위:
 *   1. violation === 'NONE' → empty state 영속 + 반환 (호출자 단순화)
 *   2. lastSeenAt 부재 OR (now - lastSeenAt) > decayHours → consecutiveCount=1 + firstSeenAt=now
 *      (decay — 무한 누적 차단)
 *   3. scanId === state.scanIds 마지막 → 변경 없음 (중복 호출 차단)
 *   4. state.violation !== violation OR state.regime !== regime → consecutiveCount=1
 *      (다른 위반 시작)
 *   5. 그 외 (같은 violation+regime, 새 scanId, decay 안 지남) → consecutiveCount += 1
 */
export function updateR3ViolationStreak(input: UpdateR3StreakInput): R3ViolationStreakState {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  // (1) violation=NONE → 즉시 reset
  if (input.violation === 'NONE') {
    const reset = emptyState();
    saveR3ViolationStreakState(reset);
    return reset;
  }

  const current = loadR3ViolationStreakState();
  const decayHours = getR3ViolationStreakDecayHours();
  const decayMs = decayHours * 60 * 60 * 1000;

  // (2) Decay 평가
  const lastTs = current.lastSeenAt ? Date.parse(current.lastSeenAt) : NaN;
  const elapsed = Number.isFinite(lastTs) ? now.getTime() - lastTs : Number.POSITIVE_INFINITY;
  const decayed = !current.lastSeenAt || elapsed > decayMs;

  if (decayed) {
    const fresh: R3ViolationStreakState = {
      schemaVersion: 1,
      violation: input.violation,
      regime: input.regime,
      consecutiveCount: 1,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      scanIds: input.scanId ? [input.scanId] : [],
    };
    saveR3ViolationStreakState(fresh);
    return fresh;
  }

  // (3) 같은 scanId 중복 호출 차단 — count 변경 없음, lastSeenAt 도 보존 (영속 무영향)
  if (input.scanId && current.scanIds.length > 0 && current.scanIds[current.scanIds.length - 1] === input.scanId) {
    return current;
  }

  // (4) violation 또는 regime 변경 → consecutiveCount=1 (다른 위반 시작)
  if (current.violation !== input.violation || current.regime !== input.regime) {
    const restarted: R3ViolationStreakState = {
      schemaVersion: 1,
      violation: input.violation,
      regime: input.regime,
      consecutiveCount: 1,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      scanIds: input.scanId ? [input.scanId] : [],
    };
    saveR3ViolationStreakState(restarted);
    return restarted;
  }

  // (5) 같은 violation+regime + 새 scanId + decay 안 지남 → +1
  const next: R3ViolationStreakState = {
    schemaVersion: 1,
    violation: current.violation,
    regime: current.regime,
    consecutiveCount: current.consecutiveCount + 1,
    firstSeenAt: current.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    scanIds: input.scanId ? [input.scanId] : current.scanIds,
  };
  saveR3ViolationStreakState(next);
  return next;
}

/**
 * Decay-aware 영속 streak 조회 — preflight pre-scan check 용.
 *
 * loadR3ViolationStreakState 는 raw read 만 한다. 본 함수는 24h decay 평가까지
 * 포함해 *현재 시점에 effective 한 streak* 을 반환. decay 지났으면 빈 상태 반환.
 *
 * 호출자: preflight.ts (SHADOW_ONLY pre-scan 차단 분기).
 *
 * 사이드 이펙트 0 — 영속 파일 변경 없음 (read-only). 실제 갱신은
 * `updateR3ViolationStreak` 에서 (post-scan).
 */
export function getEffectiveR3ViolationStreak(now: Date = new Date()): R3ViolationStreakState {
  const current = loadR3ViolationStreakState();
  if (current.violation === 'NONE' || current.consecutiveCount === 0) return current;
  if (!current.lastSeenAt) return current;

  const lastTs = Date.parse(current.lastSeenAt);
  if (!Number.isFinite(lastTs)) return current;

  const elapsed = now.getTime() - lastTs;
  const decayMs = getR3ViolationStreakDecayHours() * 60 * 60 * 1000;
  if (elapsed > decayMs) {
    // Decay 지났음 — effective streak=0, 영속은 그대로 유지 (다음 update 시점에 reset).
    return emptyState();
  }
  return current;
}

/**
 * 테스트용 격리 헬퍼 — 영속 파일 강제 제거.
 */
export function __resetR3ViolationStreakForTests(): void {
  resetR3ViolationStreakState();
}
