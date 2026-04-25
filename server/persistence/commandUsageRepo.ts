/**
 * @responsibility Telegram 명령어 사용량 텔레메트리 — count + lastUsedAt 영속화 (ADR-0017 §Stage 3, PR-48).
 *
 * webhookHandler 가 commandRegistry.resolve 매칭 직후 recordUsage(name) 를 호출하면
 * 본 모듈이 메모리 카운터를 증가시키고 200ms debounce 로 Volume JSON 에 flush 한다.
 * Top N 조회는 /help 개인화에, stale 검출은 주간 폐기 후보 리포트에 사용된다.
 *
 * 영속 스키마:
 *   { commands: { [name]: { count: number, lastUsedAt: string } }, lastWriteAt?: string }
 *
 * 본 모듈은 외부 의존성 없음 — telegram/commandRegistry 모듈 import 금지 (순환 차단).
 */

import fs from 'fs';
import { COMMAND_USAGE_FILE, ensureDataDir } from './paths.js';

export interface CommandUsageEntry {
  count: number;
  lastUsedAt: string;
}

export interface CommandUsageState {
  commands: Record<string, CommandUsageEntry>;
  lastWriteAt?: string;
}

const FLUSH_DEBOUNCE_MS = 200;

let _state: CommandUsageState | null = null;
let _flushTimer: NodeJS.Timeout | null = null;
let _dirty = false;

function ensureLoaded(): CommandUsageState {
  if (_state) return _state;
  ensureDataDir();
  if (!fs.existsSync(COMMAND_USAGE_FILE)) {
    _state = { commands: {} };
    return _state;
  }
  try {
    const raw = fs.readFileSync(COMMAND_USAGE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CommandUsageState>;
    _state = { commands: parsed.commands ?? {}, lastWriteAt: parsed.lastWriteAt };
    return _state;
  } catch (e) {
    console.warn('[CommandUsageRepo] 로드 실패:', e instanceof Error ? e.message : e);
    _state = { commands: {} };
    return _state;
  }
}

function scheduleFlush(): void {
  _dirty = true;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    flushCommandUsage();
  }, FLUSH_DEBOUNCE_MS);
}

export function flushCommandUsage(): void {
  if (!_state || !_dirty) return;
  ensureDataDir();
  try {
    _state.lastWriteAt = new Date().toISOString();
    fs.writeFileSync(COMMAND_USAGE_FILE, JSON.stringify(_state, null, 2));
    _dirty = false;
  } catch (e) {
    console.warn('[CommandUsageRepo] 저장 실패:', e instanceof Error ? e.message : e);
  }
}

/**
 * 명령어 호출 1건 기록. webhookHandler 진입점에서 commandRegistry.resolve 매칭 후 호출.
 * - name 은 슬래시 포함 표준화된 lowercase ('/status' 등). alias 는 매핑 측에서 정식명으로 정규화 권장.
 * - now 는 테스트 결정성을 위해 옵셔널.
 */
export function recordUsage(name: string, now: number = Date.now()): void {
  if (!name || !name.startsWith('/')) return; // 비명령어 텍스트 차단.
  const state = ensureLoaded();
  const key = name.toLowerCase();
  const existing = state.commands[key];
  state.commands[key] = {
    count: (existing?.count ?? 0) + 1,
    lastUsedAt: new Date(now).toISOString(),
  };
  scheduleFlush();
}

/**
 * Top N 사용 명령어를 count 내림차순으로 반환. 동률 시 lastUsedAt 최신순.
 * limit 0 또는 음수 → 빈 배열. 등록되지 않은 명령어는 제외하지 않음 (호출자가 필요시 필터).
 */
export function getTopUsage(
  limit: number,
): Array<{ name: string; count: number; lastUsedAt: string }> {
  if (limit <= 0) return [];
  const state = ensureLoaded();
  return Object.entries(state.commands)
    .map(([name, entry]) => ({ name, count: entry.count, lastUsedAt: entry.lastUsedAt }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.lastUsedAt.localeCompare(a.lastUsedAt);
    })
    .slice(0, limit);
}

/**
 * registeredNames 중 daysThreshold 일 이상 미사용 (또는 사용 이력 0) 인 명령어 반환.
 * 폐기 후보 리포트에서 사용. 결과는 daysSinceLastUse 내림차순 + 미사용은 Infinity 동등 처리.
 */
export function getStaleCommands(
  registeredNames: string[],
  daysThreshold: number,
  now: number = Date.now(),
): Array<{ name: string; daysSinceLastUse: number | null; lastUsedAt: string | null }> {
  const state = ensureLoaded();
  const cutoffMs = daysThreshold * 24 * 3_600_000;
  const stale: Array<{ name: string; daysSinceLastUse: number | null; lastUsedAt: string | null }> = [];
  for (const rawName of registeredNames) {
    const name = rawName.toLowerCase();
    const entry = state.commands[name];
    if (!entry) {
      stale.push({ name, daysSinceLastUse: null, lastUsedAt: null });
      continue;
    }
    const lastTs = Date.parse(entry.lastUsedAt);
    if (Number.isNaN(lastTs)) {
      stale.push({ name, daysSinceLastUse: null, lastUsedAt: entry.lastUsedAt });
      continue;
    }
    const ageMs = now - lastTs;
    if (ageMs >= cutoffMs) {
      stale.push({
        name,
        daysSinceLastUse: Math.floor(ageMs / (24 * 3_600_000)),
        lastUsedAt: entry.lastUsedAt,
      });
    }
  }
  return stale.sort((a, b) => {
    const av = a.daysSinceLastUse ?? Number.POSITIVE_INFINITY;
    const bv = b.daysSinceLastUse ?? Number.POSITIVE_INFINITY;
    return bv - av;
  });
}

/** 단일 명령어 통계 조회 — 없으면 null. */
export function getCommandStats(name: string): CommandUsageEntry | null {
  const state = ensureLoaded();
  return state.commands[name.toLowerCase()] ?? null;
}

/** 등록된 모든 카운터의 합 (관측용). */
export function getTotalUsage(): number {
  const state = ensureLoaded();
  let total = 0;
  for (const entry of Object.values(state.commands)) total += entry.count;
  return total;
}

/** 테스트 전용 — 메모리 + 디스크 상태 초기화. */
export function __resetForTests(filePath: string = COMMAND_USAGE_FILE): void {
  _state = null;
  _dirty = false;
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}
