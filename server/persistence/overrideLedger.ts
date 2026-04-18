/**
 * overrideLedger.ts — 운용자 오버라이드 감사 로그 + 일 2회 제한
 *
 * Telegram Decision Broker가 발송한 3택 중 한 액션이 실행될 때 이 모듈을 거쳐야 한다.
 *   1. 일 2회 제한 — KST 자정 기준 카운터 리셋
 *   2. TTL 30분 — 액션 효과의 자동 만료 시점 계산용 (executor가 사용)
 *   3. 감사 로그 — append-only, Railway Volume에 영속화
 *
 * 파일: DATA_DIR/override-ledger.json
 * 포맷: { entries: OverrideEntry[] }  (최근 500건만 유지)
 *
 * 이 모듈은 "무엇을 했는가"만 기록하고 "실제 액션 실행"은 overrideExecutor가 담당한다.
 * SRP 분리 — 기록과 실행의 결합을 끊어 오발 시 롤백 지점을 명확히 한다.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from './paths.js';

export type OverrideAction = 'EXPAND_UNIVERSE' | 'RELAX_THRESHOLD' | 'HOLD';

export interface OverrideEntry {
  /** ISO 8601 */
  at: string;
  action: OverrideAction;
  /** 액션 트리거 맥락 — "consecutive_empty_scans=5" 등 */
  context: string;
  /** 결과 상태 */
  status: 'APPLIED' | 'REJECTED' | 'NOOP';
  /** 거부/노옵 사유 */
  reason?: string;
  /** 액션 효과 만료 시각 (ISO). 해당 없는 액션은 null */
  expiresAt: string | null;
  /** 실행 주체 — 'telegram:callback', 'api:/api/operator/override', etc */
  source: string;
}

const LEDGER_FILE = path.join(DATA_DIR, 'override-ledger.json');
const MAX_ENTRIES = 500;

/** 하루 최대 적용 횟수 (REJECTED/NOOP 제외) */
export const DAILY_LIMIT = 2;
/** 액션 효과 기본 TTL (ms) */
export const DEFAULT_TTL_MS = 30 * 60_000;

interface LedgerFile {
  entries: OverrideEntry[];
}

function loadLedger(): LedgerFile {
  ensureDataDir();
  if (!fs.existsSync(LEDGER_FILE)) return { entries: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8')) as Partial<LedgerFile>;
    return { entries: Array.isArray(raw.entries) ? raw.entries : [] };
  } catch {
    return { entries: [] };
  }
}

function saveLedger(f: LedgerFile): void {
  ensureDataDir();
  // 가장 오래된 엔트리부터 버리는 rolling window
  const trimmed = f.entries.slice(-MAX_ENTRIES);
  fs.writeFileSync(LEDGER_FILE, JSON.stringify({ entries: trimmed }, null, 2));
}

/** KST 기준 오늘(YYYY-MM-DD) 문자열 */
function todayKst(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** 엔트리의 ISO timestamp가 KST 오늘에 속하는지 */
function isTodayKst(iso: string): boolean {
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10) === todayKst();
}

/**
 * 오늘 APPLIED 상태로 기록된 오버라이드 개수.
 * HOLD 액션은 "관망 유지"이므로 카운터에서 제외 — 아무 변경도 없기 때문.
 */
export function countAppliedToday(): number {
  const { entries } = loadLedger();
  return entries.filter(
    e => e.status === 'APPLIED' && e.action !== 'HOLD' && isTodayKst(e.at),
  ).length;
}

/**
 * 새 오버라이드를 기록. 호출자는 먼저 canApplyToday()로 제한을 확인해야 한다.
 * 제한 초과 상태에서 record()를 호출하면 status를 REJECTED로 강제 저장한다.
 */
export function recordOverride(
  entry: Omit<OverrideEntry, 'at'> & { at?: string },
): OverrideEntry {
  const full: OverrideEntry = {
    at: entry.at ?? new Date().toISOString(),
    action: entry.action,
    context: entry.context,
    status: entry.status,
    reason: entry.reason,
    expiresAt: entry.expiresAt,
    source: entry.source,
  };
  const f = loadLedger();
  f.entries.push(full);
  saveLedger(f);
  return full;
}

/**
 * 하루 한도 내에 있는지 — APPLIED(HOLD 제외) 기준.
 */
export function canApplyToday(): { ok: boolean; used: number; limit: number } {
  const used = countAppliedToday();
  return { ok: used < DAILY_LIMIT, used, limit: DAILY_LIMIT };
}

/** 최근 N건 조회 (진단·UI용) */
export function listRecentOverrides(limit = 20): OverrideEntry[] {
  const { entries } = loadLedger();
  return entries.slice(-limit).reverse();
}

/**
 * 현재 활성인 가장 최근 APPLIED 엔트리 — 만료 안 된 것만.
 * gateConfig 델타가 ledger와 정합하는지 교차 검증할 때 사용.
 */
export function getActiveOverride(): OverrideEntry | null {
  const { entries } = loadLedger();
  const now = Date.now();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.status !== 'APPLIED') continue;
    if (!e.expiresAt) continue;
    if (new Date(e.expiresAt).getTime() > now) return e;
  }
  return null;
}
