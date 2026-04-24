/**
 * @responsibility AI 추천 외부 호출 일일 예산 카운터 — KST 자정 단위 리셋 (ADR-0011, PR-25-A)
 *
 * googleSearch / naverFinance / krx_master_refresh 등 bucket 별로 일일 호출 수를
 * Volume JSON 으로 영속한다. 한도 도달 시 호출자가 BudgetExceededError 또는
 * null 반환을 결정. 자정 KST 가 지나면 다음 read·write 시 자동 리셋.
 */

import fs from 'fs';
import { AI_CALL_BUDGET_FILE, ensureDataDir } from './paths.js';

export interface DailyBudgetState {
  date: string;
  counters: Record<string, number>;
  /** PR-25-C: 임계 경보 중복 억제 — bucket 별로 이미 통과한 임계값 percent(80/95/100). */
  alertedThresholds?: Record<string, number[]>;
}

export const ALERT_THRESHOLDS_PCT = [80, 95, 100] as const;

/**
 * 임계 경보 콜백. 같은 bucket 의 같은 임계값은 하루에 한 번만 호출된다.
 * 실제 텔레그램 송신은 server/index.ts 에서 주입 — repo 는 telegram 모듈 의존 없음.
 */
export type BudgetAlertHook = (payload: {
  bucket: string;
  used: number;
  limit: number;
  thresholdPct: number;
}) => void;

let _alertHook: BudgetAlertHook | null = null;
export function setBudgetAlertHook(hook: BudgetAlertHook | null): void {
  _alertHook = hook;
}

const KST_OFFSET_MS = 9 * 3_600_000;

function todayKstDate(now: number = Date.now()): string {
  const kst = new Date(now + KST_OFFSET_MS);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

let _state: DailyBudgetState | null = null;
let _flushTimer: NodeJS.Timeout | null = null;
let _dirty = false;
const FLUSH_DEBOUNCE_MS = 200;

function ensureLoaded(now: number = Date.now()): DailyBudgetState {
  if (_state) {
    if (_state.date !== todayKstDate(now)) {
      _state = { date: todayKstDate(now), counters: {}, alertedThresholds: {} };
      scheduleFlush();
    }
    return _state;
  }
  ensureDataDir();
  if (!fs.existsSync(AI_CALL_BUDGET_FILE)) {
    _state = { date: todayKstDate(now), counters: {}, alertedThresholds: {} };
    return _state;
  }
  try {
    const raw = fs.readFileSync(AI_CALL_BUDGET_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as DailyBudgetState;
    if (parsed.date !== todayKstDate(now)) {
      _state = { date: todayKstDate(now), counters: {}, alertedThresholds: {} };
      scheduleFlush();
    } else {
      _state = { ...parsed, alertedThresholds: parsed.alertedThresholds ?? {} };
    }
    return _state;
  } catch (e) {
    console.warn('[AiCallBudgetRepo] 로드 실패:', e instanceof Error ? e.message : e);
    _state = { date: todayKstDate(now), counters: {}, alertedThresholds: {} };
    return _state;
  }
}

function scheduleFlush(): void {
  _dirty = true;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    flushAiCallBudget();
  }, FLUSH_DEBOUNCE_MS);
}

export function flushAiCallBudget(): void {
  if (!_state || !_dirty) return;
  ensureDataDir();
  try {
    fs.writeFileSync(AI_CALL_BUDGET_FILE, JSON.stringify(_state, null, 2));
    _dirty = false;
  } catch (e) {
    console.warn('[AiCallBudgetRepo] 저장 실패:', e instanceof Error ? e.message : e);
  }
}

function defaultLimit(bucket: string): number {
  // env=0 도 유효한 한도(전체 차단). 음수만 무시.
  const envRaw = process.env.AI_DAILY_CALL_BUDGET;
  if (envRaw !== undefined && envRaw !== '') {
    const env = Number(envRaw);
    if (Number.isFinite(env) && env >= 0) return env;
  }
  // bucket 별 기본 한도 — google_search 무료 100/day 의 80% 안전 마진
  if (bucket === 'google_search') return 80;
  if (bucket === 'naver_finance') return 1000;
  if (bucket === 'krx_master_refresh') return 5;
  return 100;
}

export function getRemaining(bucket: string, now: number = Date.now()): number {
  const state = ensureLoaded(now);
  const used = state.counters[bucket] ?? 0;
  return Math.max(0, defaultLimit(bucket) - used);
}

export function getUsed(bucket: string, now: number = Date.now()): number {
  return ensureLoaded(now).counters[bucket] ?? 0;
}

/**
 * 사용량이 임계 percent 를 넘으면 콜백 호출 (중복 억제 — 같은 임계 일 1회).
 * 한도 0 (전면 차단) 일 때는 비활성.
 */
function checkThresholds(bucket: string, newUsed: number, limit: number, state: DailyBudgetState): void {
  if (!_alertHook || limit <= 0) return;
  const pct = (newUsed / limit) * 100;
  const already = state.alertedThresholds?.[bucket] ?? [];
  for (const t of ALERT_THRESHOLDS_PCT) {
    if (pct >= t && !already.includes(t)) {
      if (!state.alertedThresholds) state.alertedThresholds = {};
      state.alertedThresholds[bucket] = [...already, t];
      try {
        _alertHook({ bucket, used: newUsed, limit, thresholdPct: t });
      } catch (e) {
        console.warn('[AiCallBudgetRepo] alert hook 실패:', e instanceof Error ? e.message : e);
      }
      already.push(t);
    }
  }
}

/**
 * 호출 시도 — 항상 true 반환 (enforcement 비활성, 2026-04 사용자 요청).
 * AI 추천은 사용자가 직접 실행하는 경로이므로 자동 한도·경보가 불필요.
 * 카운터는 관측용으로 유지하되 차단·threshold 알림은 발생시키지 않는다.
 */
export function tryConsume(bucket: string, count: number = 1, now: number = Date.now()): boolean {
  const state = ensureLoaded(now);
  state.counters[bucket] = (state.counters[bucket] ?? 0) + count;
  scheduleFlush();
  return true;
}

/** 강제 카운터 증가 — 외부 fetch 가 이미 발생한 후 사후 기록할 때. threshold 알림 없음. */
export function recordCall(bucket: string, count: number = 1, now: number = Date.now()): void {
  const state = ensureLoaded(now);
  state.counters[bucket] = (state.counters[bucket] ?? 0) + count;
  scheduleFlush();
}

export function getBudgetSnapshot(now: number = Date.now()): {
  date: string;
  buckets: Array<{ bucket: string; used: number; limit: number; remaining: number }>;
} {
  const state = ensureLoaded(now);
  const knownBuckets = new Set([
    'google_search', 'naver_finance', 'krx_master_refresh',
    ...Object.keys(state.counters),
  ]);
  return {
    date: state.date,
    buckets: Array.from(knownBuckets).map((b) => {
      const used = state.counters[b] ?? 0;
      const limit = defaultLimit(b);
      return { bucket: b, used, limit, remaining: Math.max(0, limit - used) };
    }),
  };
}

/** 운영자 수동 리셋. */
export function resetBudget(): void {
  _state = { date: todayKstDate(), counters: {}, alertedThresholds: {} };
  scheduleFlush();
}

export const __testOnly = {
  reset(): void {
    _state = null;
    _dirty = false;
    if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  },
};
