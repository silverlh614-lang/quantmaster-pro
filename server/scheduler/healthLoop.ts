// @responsibility healthLoop — 3티어 자가점검 (5분/1시간/일일) 임계 변화 시에만 Telegram (ADR-0131)
//
// 정상→정상 무알림 + 정상→비정상 즉시 + 비정상→정상 회복 + 비정상→비정상 dedupe.
// `collectHealthSnapshot()` SSOT read-only — 외부 KIS/KRX/Yahoo 호출 추가 금지.
// 예외: KIS 토큰 만료 분기 한정 self-heal refresh 1회 허용 (2026-06-11 인시던트) —
// snapshot 수집이 아닌 복구 조치이므로 read-only 규칙 위반이 아니다.

import fs from 'fs';
import { scheduledJob } from './scheduleGuard.js';
import { collectHealthSnapshot, type HealthSnapshot } from '../health/diagnostics.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import type { AlertNoiseEvent } from '../alerts/alertNoisePolicy.js';
import { HEALTH_LOOP_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { isKrxTradingDay, toKstDateKey } from '../calendar/krxTradingCalendar.js';

// ─── 영속 SSOT ────────────────────────────────────────────────────────────

export interface HealthLoopState {
  /** KIS 토큰 마지막 6h bucket — Math.floor(hours / 6). 변화 시 알림. */
  kisTokenLastBucket?: number;
  /** heal-first 마지막 시도 시각 (ISO) — 만료 지속 상태 backoff 재시도 기준. */
  kisTokenHealLastAttemptAt?: string;
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
      kisTokenHealLastAttemptAt:
        typeof obj.kisTokenHealLastAttemptAt === 'string' ? obj.kisTokenHealLastAttemptAt : undefined,
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
  options: {
    priority?: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
    cooldownMs?: number;
    noiseEvent?: AlertNoiseEvent;
  } = {},
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
      noiseEvent: options.noiseEvent,
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

// ─── KIS 토큰 heal-first (2026-06-11 인시던트) ────────────────────────────

/**
 * 만료 분기 한정 self-heal — CRITICAL 발송 **전에** 토큰 재발급 1회 시도.
 *
 * 재배포 직후 휘발 data/ 로 토큰 캐시가 비어 "만료"로 관측돼도 OAuth 재발급이
 * 가능하면 거짓 긴급 경보 대신 NORMAL self-healed 1건만 남긴다.
 * single-flight(auth.ts 내장) + Tier 1 5분 주기가 재시도 자연 상한.
 * 실계좌(realData) 토큰은 HAS_REAL_DATA_CLIENT 시 함께 시도하되 실패는 main
 * 결과에 영향 없이 로그만 남긴다.
 *
 * @returns 재발급 후 main 토큰 잔여 시간(h). 실패 시 0 — 호출자는 기존 CRITICAL
 *          (휴장일 다운그레이드 포함) 경로로 진행.
 */
async function attemptKisTokenHealFirst(): Promise<number> {
  try {
    const auth = await import('../clients/kisClient/auth.js');
    await auth.refreshKisToken();
    const { HAS_REAL_DATA_CLIENT } = await import('../clients/kisClient/constants.js');
    if (HAS_REAL_DATA_CLIENT) {
      try {
        await auth.refreshRealDataToken();
      } catch (e) {
        // realData 토큰 실패는 main self-heal 결과에 영향 없음 — 로그만.
        console.warn(
          '[HealthLoop] realData 토큰 self-heal 재발급 실패 (main 무영향):',
          e instanceof Error ? e.message : e,
        );
      }
    }
    return auth.getKisTokenRemainingHours();
  } catch (e) {
    // 불변식 #1 — heal 실패는 기존 CRITICAL 경보 경로로 진행 (silent catch 아님).
    console.warn(
      '[HealthLoop] KIS 토큰 heal-first 재발급 실패 — 기존 만료 경보 경로 진행:',
      e instanceof Error ? e.message : e,
    );
    return 0;
  }
}

/** 만료 지속 상태 heal 재시도 간격 — Tier 1(5분) tick 중 30분마다 1회만 시도. */
const KIS_TOKEN_HEAL_RETRY_INTERVAL_MS = 30 * 60_000;

/** ENV 1줄 롤백 — `KIS_TOKEN_HEAL_RETRY_DISABLED=true` 시 기존(전이 tick 1회) 동작 복귀. */
function isKisTokenHealRetryDisabled(): boolean {
  return process.env.KIS_TOKEN_HEAL_RETRY_DISABLED === 'true';
}

/**
 * heal-first 시도 허용 여부 (2026-07-04 인시던트).
 *
 * 기존 결함: 발동 조건이 `lastBucket >= 0`(유효→만료 전이 tick)뿐이라 그 1회가 실패하면
 * bucket 이 -1 로 저장돼 다음 tick 부터 영구 불발 — "5분 주기가 재시도 자연 상한" 주석과
 * 실동작 불일치. 이미 만료 상태로 부팅(lastBucket=undefined)해도 발동 불가.
 *
 * 수리: 전이 tick 은 기존대로 무조건 1회 + 만료 지속/부팅 상태는 30분 backoff 재시도.
 */
function shouldAttemptTokenHeal(
  state: HealthLoopState,
  lastBucket: number | undefined,
  now: Date,
): boolean {
  // 유효→만료 전이 tick — 기존 동작 그대로 무조건 시도.
  if (lastBucket !== undefined && lastBucket >= 0) return true;
  // 만료 지속(-1)·부팅 직후(undefined) — backoff 재시도 (ENV 1줄 롤백 가능).
  if (isKisTokenHealRetryDisabled()) return false;
  const last = state.kisTokenHealLastAttemptAt ? Date.parse(state.kisTokenHealLastAttemptAt) : NaN;
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= KIS_TOKEN_HEAL_RETRY_INTERVAL_MS;
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
      {
        priority: downgradeKrxClosed ? 'NORMAL' : 'HIGH',
        noiseEvent: {
          eventType: 'KIS_TOKEN_EXPIRY',
          channel: 'CH4_JOURNAL',
          tokenExpiresInSeconds: Math.max(0, Math.round(kisHours * 3600)),
          status: downgradeKrxClosed ? 'MARKET_CLOSED' : 'EXPIRING',
          executionImpact: 'NONE',
        },
      },
      now,
    );
  } else if (kisHours === 0 && shouldAttemptTokenHeal(state, lastBucket, now)) {
    // 선치유-후경보 (2026-06-11 인시던트) — 재배포 직후 휘발 토큰 캐시가 "만료"로
    // 관측돼도 재발급 가능하면 거짓 CRITICAL 대신 NORMAL self-healed 1건만 발송.
    // 2026-07-04: 전이 tick 1회 한정이던 발동 조건을 만료 지속/부팅 상태 30분 backoff
    // 재시도로 확장 (shouldAttemptTokenHeal). 경보는 alertOnce 일일 dedupe 로 무증가.
    state.kisTokenHealLastAttemptAt = now.toISOString();
    const healedHours = await attemptKisTokenHealFirst();
    if (healedHours > 0) {
      await alertOnce(
        state,
        'kis_token_self_healed',
        `🔄 KIS 토큰 만료 감지 → 자동 재발급 완료\n잔여 ${healedHours.toFixed(1)}h — 운영자 조치 불필요 (heal-first).`,
        {
          priority: 'NORMAL',
          noiseEvent: {
            eventType: 'HEALTH_RECOVERY',
            channel: 'CH4_JOURNAL',
            tokenExpiresInSeconds: Math.max(0, Math.round(healedHours * 3600)),
            status: 'SELF_HEALED',
            executionImpact: 'NONE',
            dedupeHint: 'kis_token_self_healed',
          },
        },
        now,
      );
    } else {
      const profile = kisTokenAlertProfile(now);
      await alertOnce(
        state,
        downgradeKrxClosed ? 'kis_token_expired_maintenance' : 'kis_token_expired',
        `${profile.label}\n${profile.suffix}`,
        {
          priority: profile.priority,
          noiseEvent: {
            eventType: 'KIS_TOKEN_EXPIRED_IMPACTED',
            channel: 'CH1_TRADE',
            tokenExpiresInSeconds: 0,
            status: downgradeKrxClosed ? 'EXPIRED_MARKET_CLOSED' : 'EXPIRED',
            queryImpacted: !downgradeKrxClosed,
            executionImpact: downgradeKrxClosed ? 'NONE' : 'QUERY_IMPACT',
          },
        },
        now,
      );
    }
  }

  // KIS 토큰 self-heal — 토큰이 유효(재발급 포함)하면 만료 경보의 미확인 T1 ack 를
  // 자동 해소한다. auto-refresh cron 으로 재발급돼 kisHours>0 가 됐는데도 ack 가
  // 안 닫혀 sweep 재발송·에스컬레이션이 무한 반복되던 false-positive 차단.
  // dedupeKey 형태(alertOnce): `health_loop:kis_token_expired:<YMD>` 및
  // `health_loop:kis_token_expired_maintenance:<YMD>` — 둘 다 'kis_token_expired'
  // 부분문자열로 커버. idempotent(해소 대상 없으면 no-op).
  if (kisHours > 0) {
    try {
      const { autoResolvePendingAcks } = await import('../alerts/ackTracker.js');
      const resolvedCount = await autoResolvePendingAcks(
        (e) => {
          const key = e.dedupeKey ?? '';
          if (key.includes('kis_token_expired')) return true;
          // dedupeKey 부재 fallback — category+summary 로 매칭.
          return e.category === 'health_loop' && /KIS\s*토큰\s*만료/.test(e.summary ?? '');
        },
        'KIS 토큰 재발급 — 조건 회복',
      );
      // 회복 가시화 (2026-06-11 인시던트) — 실제 해소 건이 ≥1 일 때만 운영자 대면
      // 1건 발송. 해소 0건이면 무발송 (평시 무소음 보존).
      if (resolvedCount >= 1) {
        await alertOnce(
          state,
          'kis_token_expired_ack_recovered',
          `✅ KIS 토큰 재발급 확인 — 만료 경보 해소\n미확인 만료 경보 ${resolvedCount}건 자동 해소 (잔여 ${kisHours.toFixed(1)}h).`,
          {
            priority: 'NORMAL',
            noiseEvent: {
              eventType: 'HEALTH_RECOVERY',
              channel: 'CH4_JOURNAL',
              tokenExpiresInSeconds: Math.max(0, Math.round(kisHours * 3600)),
              status: 'SELF_HEALED',
              executionImpact: 'NONE',
              dedupeHint: 'kis_token_expired_ack_recovered',
            },
          },
          now,
        );
      }
    } catch (e) {
      console.warn(
        '[HealthLoop] KIS 토큰 ack 자동 해소 실패:',
        e instanceof Error ? e.message : e,
      );
    }
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
    // Master Tier 4 self-heal — fallback 탈출 시 master_tier4_enter 미확인 T1 ack 자동 해소.
    // KIS 토큰 self-heal(2026-06-11)과 동형 패턴: 조건이 스스로 회복(정상 source 복구)했는데
    // 운영자가 [확인]을 안 눌러 sweepPendingAcks 재발송·에스컬레이션(ack_escalate)이 반복되던
    // false-positive 차단. master_tier4_enter 는 CRITICAL(T1)이라 ack 가 등록돼 있다.
    // dedupeKey 형태(alertOnce): `health_loop:master_tier4_enter:<YMD>`.
    // 회복 메시지는 위 master_tier4_exit alertOnce 가 이미 1건 발송 — 별도 가시화 알림 불필요.
    // idempotent(해소 대상 없으면 no-op).
    try {
      const { autoResolvePendingAcks } = await import('../alerts/ackTracker.js');
      await autoResolvePendingAcks(
        (e) => (e.dedupeKey ?? '').includes('master_tier4_enter'),
        'Master Tier 4 회복 — 조건 회복',
      );
    } catch (e) {
      console.warn(
        '[HealthLoop] Master Tier 4 ack 자동 해소 실패:',
        e instanceof Error ? e.message : e,
      );
    }
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
