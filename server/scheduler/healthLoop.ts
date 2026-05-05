// @responsibility healthLoop — 3티어 자가점검 (5분/1시간/일일) 임계 변화 시에만 Telegram (ADR-0131)
//
// 정상→정상 무알림 + 정상→비정상 즉시 + 비정상→정상 회복 + 비정상→비정상 dedupe.
// `collectHealthSnapshot()` SSOT read-only — 외부 KIS/KRX/Yahoo 호출 추가 금지.

import fs from 'fs';
import { scheduledJob } from './scheduleGuard.js';
import { collectHealthSnapshot, type HealthSnapshot } from '../health/diagnostics.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { HEALTH_LOOP_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { isKrxTradingDay, toKstDateKey } from '../calendar/krxTradingCalendar.js';

// ─── 영속 SSOT ────────────────────────────────────────────────────────────

export interface HealthLoopState {
  /** KIS 토큰 마지막 6h bucket — Math.floor(hours / 6). 변화 시 알림. */
  kisTokenLastBucket?: number;
  /** Master 마지막 카운트 — 50% 이상 감소 시 즉시 🚨. */
  masterLastCount?: number;
  /** Master Tier 4 fallback 활성 여부 — 진입/회복 알림. */
  masterTier4Active?: boolean;
  /** 마지막 AUTO_TRADE_ENABLED — 토글 변화 알림. */
  autoTradeLastEnabled?: boolean;
  /** Tier 1 / Tier 2 / Tier 3 마지막 실행 시각 (ISO). */
  lastTier1RunAt?: string;
  lastTier2RunAt?: string;
  lastTier3RunAt?: string;
  /** dedupe 맵: key → 'YYYY-MM-DD' (같은 날 같은 key 1회만 알림). */
  alertedKeys?: Record<string, string>;
}

function todayKstYmd(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  return kst.toISOString().slice(0, 10);
}

function isKrxClosedCriticalDowngradeActive(now = new Date()): boolean {
  if (process.env.HEALTH_LOOP_CRITICAL_ON_KRX_CLOSED === 'true') return false;
  return !isKrxTradingDay(toKstDateKey(now));
}

function kisTokenAlertProfile(now = new Date()): {
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
  label: string;
  suffix: string;
} {
  if (!isKrxClosedCriticalDowngradeActive(now)) {
    return {
      priority: 'CRITICAL',
      label: '🚨 KIS 토큰 만료',
      suffix: '자동 갱신 cron 또는 운영자 수동 갱신 필요.',
    };
  }
  return {
    priority: 'NORMAL',
    label: '🛠 KIS 토큰 만료 — 휴장일 점검',
    suffix:
      'KRX 휴장일/비거래일이므로 TRADING_CRITICAL 로 에스컬레이션하지 않습니다. 장 시작 전 갱신만 확인하세요.',
  };
}

export function loadHealthLoopState(): HealthLoopState {
  ensureDataDir();
  if (!fs.existsSync(HEALTH_LOOP_STATE_FILE)) return {};
  try {
    const raw = fs.readFileSync(HEALTH_LOOP_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const obj = parsed as Partial<HealthLoopState>;
    return {
      kisTokenLastBucket:
        typeof obj.kisTokenLastBucket === 'number' && Number.isFinite(obj.kisTokenLastBucket)
          ? obj.kisTokenLastBucket
          : undefined,
      masterLastCount:
        typeof obj.masterLastCount === 'number' && Number.isFinite(obj.masterLastCount)
          ? obj.masterLastCount
          : undefined,
      masterTier4Active:
        typeof obj.masterTier4Active === 'boolean' ? obj.masterTier4Active : undefined,
      autoTradeLastEnabled:
        typeof obj.autoTradeLastEnabled === 'boolean' ? obj.autoTradeLastEnabled : undefined,
      lastTier1RunAt: typeof obj.lastTier1RunAt === 'string' ? obj.lastTier1RunAt : undefined,
      lastTier2RunAt: typeof obj.lastTier2RunAt === 'string' ? obj.lastTier2RunAt : undefined,
      lastTier3RunAt: typeof obj.lastTier3RunAt === 'string' ? obj.lastTier3RunAt : undefined,
      alertedKeys:
        obj.alertedKeys && typeof obj.alertedKeys === 'object' && !Array.isArray(obj.alertedKeys)
          ? { ...(obj.alertedKeys as Record<string, string>) }
          : {},
    };
  } catch {
    return {};
  }
}

export function saveHealthLoopState(state: HealthLoopState): void {
  ensureDataDir();
  const tmp = `${HEALTH_LOOP_STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, HEALTH_LOOP_STATE_FILE);
}

// ─── 알림 dedupe SSOT ────────────────────────────────────────────────────

/**
 * 같은 날 같은 key 1회만 알림. true 반환 시 이번 호출에서 알림 발송됨 (state 갱신 +
 * Telegram 호출). false 반환 시 이미 보고된 임계 (silent skip).
 *
 * 호출자는 본 함수의 boolean 반환을 사용해 본인 영속 상태도 갱신할지 결정한다.
 */
export async function alertOnce(
  state: HealthLoopState,
  key: string,
  message: string,
  options: { priority?: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'; cooldownMs?: number } = {},
  now = new Date(),
): Promise<boolean> {
  const today = todayKstYmd(now);
  const alerted = state.alertedKeys ?? {};
  if (alerted[key] === today) return false;

  try {
    await sendTelegramAlert(message, {
      priority: options.priority ?? 'HIGH',
      dedupeKey: `health_loop:${key}:${today}`,
      cooldownMs: options.cooldownMs ?? 24 * 3600_000,
      category: 'health_loop',
    });
  } catch (e) {
    // 텔레그램 실패는 알림 미발송으로 취급 — alertedKeys 미갱신, 다음 cron tick 재시도
    console.warn(
      `[HealthLoop] alertOnce 텔레그램 실패 key=${key}:`,
      e instanceof Error ? e.message : e,
    );
    return false;
  }

  alerted[key] = today;
  state.alertedKeys = alerted;
  return true;
}

// ─── Tier 1: 5분 (4 임계) ─────────────────────────────────────────────────

interface KrxMasterInfo {
  count: number;
  isFallback: boolean; // Tier 4 (count < 1000)
}

/** master 정보 추출 — 본 PR 은 시드, 실제 master count source 는 후속 PR 에서 wiring. */
function getKrxMasterInfo(): KrxMasterInfo {
  // 본 PR 은 collectHealthSnapshot 에 master count 가 직접 노출되지 않으므로
  // graceful fallback (count=0 → isFallback=true). 향후 PR 에서 실제 source 연결.
  return { count: 0, isFallback: false };
}

export async function runTier1(now = new Date()): Promise<HealthLoopState> {
  if (process.env.HEALTH_LOOP_DISABLED === 'true') {
    return loadHealthLoopState();
  }

  let state: HealthLoopState;
  let snapshot: HealthSnapshot;
  try {
    state = loadHealthLoopState();
    snapshot = collectHealthSnapshot();
  } catch (e) {
    console.warn(
      '[HealthLoop] Tier 1 snapshot 수집 실패:',
      e instanceof Error ? e.message : e,
    );
    return loadHealthLoopState();
  }

  state.lastTier1RunAt = now.toISOString();

  // (a) KIS 토큰 6h bucket 변화
  // bucket = floor(hours / 6). bucket 감소 시 알림 (예: 6→3 진입 = bucket 1→0).
  const kisHours = snapshot.kisTokenHours;
  const kisBucket = kisHours > 0 ? Math.floor(kisHours / 6) : -1;
  const lastBucket = state.kisTokenLastBucket;
  const downgradeKrxClosed = isKrxClosedCriticalDowngradeActive(now);
  if (lastBucket !== undefined && kisBucket < lastBucket && kisHours > 0 && kisHours <= 12) {
    await alertOnce(
      state,
      `kis_token_bucket_${kisBucket}`,
      downgradeKrxClosed
        ? `🛠 KIS 토큰 잔여 ${kisHours.toFixed(1)}h — 휴장일 점검\nKRX 휴장일/비거래일이므로 긴급 에스컬레이션 대신 장전 갱신 대상으로 기록합니다.`
        : `🟡 KIS 토큰 잔여 ${kisHours.toFixed(1)}h 진입\n남은 시간이 6시간 단위로 감소했습니다 — 만료 전 갱신 검토.`,
      { priority: downgradeKrxClosed ? 'NORMAL' : 'HIGH' },
      now,
    );
  } else if (lastBucket !== undefined && kisHours === 0 && lastBucket >= 0) {
    const profile = kisTokenAlertProfile(now);
    await alertOnce(
      state,
      downgradeKrxClosed ? 'kis_token_expired_maintenance' : 'kis_token_expired',
      `${profile.label}\n${profile.suffix}`,
      { priority: profile.priority },
      now,
    );
  }
  state.kisTokenLastBucket = kisBucket;

  // (b) Master count 50% 감소 즉시 🚨
  // (c) Master < 1000 (Tier 4 fallback) 진입/회복
  const master = getKrxMasterInfo();
  const lastCount = state.masterLastCount;
  if (lastCount !== undefined && lastCount > 0 && master.count > 0) {
    const ratio = master.count / lastCount;
    if (ratio <= 0.5) {
      await alertOnce(
        state,
        'master_50pct_drop',
        `🚨 Master count 50% 이상 감소\n이전: ${lastCount} → 현재: ${master.count} (${(ratio * 100).toFixed(1)}%)\nKRX 마스터 갱신 실패 의심 — /krx_master_status 확인.`,
        { priority: 'CRITICAL' },
        now,
      );
    }
  }
  state.masterLastCount = master.count;

  const wasTier4 = state.masterTier4Active === true;
  if (master.isFallback && !wasTier4) {
    await alertOnce(
      state,
      'master_tier4_enter',
      `🚨 Master Tier 4 fallback 진입\ncount=${master.count} (<1000) — KRX/Naver/Shadow 모두 실패, seed 100건 사용 중.`,
      { priority: 'CRITICAL' },
      now,
    );
  } else if (!master.isFallback && wasTier4) {
    await alertOnce(
      state,
      'master_tier4_exit',
      `✅ Master Tier 4 회복\ncount=${master.count} — 정상 source 복구.`,
      { priority: 'NORMAL' },
      now,
    );
  }
  state.masterTier4Active = master.isFallback;

  // (d) AUTO_TRADE_ENABLED 변화
  const autoEnabled = snapshot.autoTradeEnabled;
  const lastAutoEnabled = state.autoTradeLastEnabled;
  if (lastAutoEnabled !== undefined && lastAutoEnabled !== autoEnabled) {
    if (autoEnabled) {
      await alertOnce(
        state,
        'auto_trade_enabled',
        `✅ 자동매매 활성화\nAUTO_TRADE_ENABLED true 전환 감지.`,
        { priority: 'NORMAL' },
        now,
      );
    } else {
      await alertOnce(
        state,
        'auto_trade_disabled',
        `🟡 자동매매 비활성화\nAUTO_TRADE_ENABLED false 전환 감지 — 의도된 변경인지 확인.`,
        { priority: 'HIGH' },
        now,
      );
    }
  }
  state.autoTradeLastEnabled = autoEnabled;

  saveHealthLoopState(state);
  return state;
}

// ─── Tier 2: 1시간 (시드 — 향후 확장) ─────────────────────────────────────

export async function runTier2(now = new Date()): Promise<HealthLoopState> {
  if (process.env.HEALTH_LOOP_DISABLED === 'true') {
    return loadHealthLoopState();
  }
  const state = loadHealthLoopState();
  state.lastTier2RunAt = now.toISOString();
  // 향후: Yahoo probe / KRX 회로 / Gemini budget 임계 — collectHealthSnapshot read-only 만 사용.
  saveHealthLoopState(state);
  return state;
}

// ─── Tier 3: 일일 09:00 (시드 — 향후 확장) ────────────────────────────────

export async function runTier3(now = new Date()): Promise<HealthLoopState> {
  if (process.env.HEALTH_LOOP_DISABLED === 'true') {
    return loadHealthLoopState();
  }
  const state = loadHealthLoopState();
  state.lastTier3RunAt = now.toISOString();
  // 향후: Tier 1 + Tier 2 종합 + 운영 메타 일일 보고.
  saveHealthLoopState(state);
  return state;
}

// ─── 등록 ────────────────────────────────────────────────────────────────

export function registerHealthLoop(): void {
  // Tier 1 (5분) — ALWAYS_ON. 새벽/주말도 점검 (KIS 토큰은 휴일도 만료됨).
  scheduledJob('*/5 * * * *', 'ALWAYS_ON', 'health_loop_tier1', () => runTier1(), {
    timezone: 'UTC',
  });
  // Tier 2 (매시간 정각) — ALWAYS_ON.
  scheduledJob('0 * * * *', 'ALWAYS_ON', 'health_loop_tier2', () => runTier2(), {
    timezone: 'UTC',
  });
  // Tier 3 (일일 09:00 KST = 00:00 UTC) — ALWAYS_ON.
  scheduledJob('0 0 * * *', 'ALWAYS_ON', 'health_loop_tier3', () => runTier3(), {
    timezone: 'UTC',
  });
  console.log('[HealthLoop] 자가점검 헬스 루프 3 cron 등록 (Tier 1: 5분 / Tier 2: 1시간 / Tier 3: 09:00 KST)');
}

// ─── 테스트 헬퍼 ─────────────────────────────────────────────────────────

export function __resetHealthLoopStateForTests(): void {
  if (fs.existsSync(HEALTH_LOOP_STATE_FILE)) {
    try {
      fs.unlinkSync(HEALTH_LOOP_STATE_FILE);
    } catch {
      /* noop */
    }
  }
}
