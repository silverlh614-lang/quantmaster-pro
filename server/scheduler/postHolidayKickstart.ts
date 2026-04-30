// @responsibility postHolidayKickstart — 휴장 후 첫 거래일 07:30 가속 점검 (ADR-0131)
//
// 4/27~5/01 패턴 (어린이날 + 부처님오신날 연휴 직후 시스템 점검 부재) 재발 방지.
// 일반 거래일은 cron 진입 즉시 silent return — 휴장 후 첫 거래일에만 5 check 실행.

import fs from 'fs';
import { scheduledJob } from './scheduleGuard.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { isTradingDay } from '../utils/marketDayClassifier.js';
import { collectHealthSnapshot, type HealthSnapshot } from '../health/diagnostics.js';
import { POST_HOLIDAY_KICKSTART_STATE_FILE, ensureDataDir } from '../persistence/paths.js';

// ─── 영속 ────────────────────────────────────────────────────────────────

export type PostHolidayCheckStatus = 'PASS' | 'WARN' | 'FAIL';

export interface PostHolidayCheck {
  name: string;
  status: PostHolidayCheckStatus;
  detail: string;
}

export interface PostHolidayKickstartState {
  lastFirstDayCheckedAt?: string;
  lastFirstDayDate?: string;
  lastChecks?: PostHolidayCheck[];
}

export function loadPostHolidayState(): PostHolidayKickstartState {
  ensureDataDir();
  if (!fs.existsSync(POST_HOLIDAY_KICKSTART_STATE_FILE)) return {};
  try {
    const raw = fs.readFileSync(POST_HOLIDAY_KICKSTART_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const obj = parsed as Partial<PostHolidayKickstartState>;
    return {
      lastFirstDayCheckedAt:
        typeof obj.lastFirstDayCheckedAt === 'string' ? obj.lastFirstDayCheckedAt : undefined,
      lastFirstDayDate:
        typeof obj.lastFirstDayDate === 'string' ? obj.lastFirstDayDate : undefined,
      lastChecks: Array.isArray(obj.lastChecks)
        ? (obj.lastChecks as PostHolidayCheck[]).filter(
            (c) =>
              c &&
              typeof c.name === 'string' &&
              typeof c.detail === 'string' &&
              (c.status === 'PASS' || c.status === 'WARN' || c.status === 'FAIL'),
          )
        : undefined,
    };
  } catch {
    return {};
  }
}

export function savePostHolidayState(state: PostHolidayKickstartState): void {
  ensureDataDir();
  const tmp = `${POST_HOLIDAY_KICKSTART_STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, POST_HOLIDAY_KICKSTART_STATE_FILE);
}

// ─── 휴장 후 첫 거래일 판정 ────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;

function todayKstYmd(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function shiftYmd(ymd: string, days: number): string {
  return new Date(ymdToUtcMs(ymd) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 오늘이 휴장 후 첫 거래일인가? = 오늘 영업일 + 어제 비영업일.
 * 일반 거래일 (어제도 영업일) → false. 본인이 휴장 → false (영업일 아님).
 */
export function isPostHolidayFirstDay(now = new Date()): boolean {
  const today = todayKstYmd(now);
  if (!isTradingDay(today)) return false;
  const yesterday = shiftYmd(today, -1);
  // 어제가 영업일이면 일반 거래일 — 가속 점검 불필요.
  if (isTradingDay(yesterday)) return false;
  return true;
}

// ─── 5 check (Pre-Market Kickstart) ──────────────────────────────────────

function checkKrxMaster(): PostHolidayCheck {
  // PR-Z1 / ADR-0060 sectorMapUpdater 패턴 — collectHealthSnapshot 에 직접 master count
  // 노출되지 않으므로 본 PR 은 시드. 후속 PR 에서 multiSourceStockMaster 결과 wiring.
  return { name: 'KRX Master', status: 'PASS', detail: '본 PR 시드 — 향후 master count 기반 평가' };
}

function checkKisToken(snapshot: HealthSnapshot): PostHolidayCheck {
  if (!snapshot.kisConfigured) {
    return { name: 'KIS Token', status: 'WARN', detail: 'KIS_APP_KEY 미설정' };
  }
  const hours = snapshot.kisTokenHours;
  if (hours === 0) {
    return { name: 'KIS Token', status: 'FAIL', detail: '토큰 만료 — 즉시 갱신 필요' };
  }
  if (hours < 4) {
    return { name: 'KIS Token', status: 'WARN', detail: `잔여 ${hours.toFixed(1)}h (장 시작 전 갱신 권장)` };
  }
  return { name: 'KIS Token', status: 'PASS', detail: `잔여 ${hours.toFixed(1)}h` };
}

function checkKrxOpenApi(snapshot: HealthSnapshot): PostHolidayCheck {
  if (!snapshot.krxTokenConfigured) {
    return { name: 'KRX OpenAPI', status: 'WARN', detail: 'KRX_OPEN_API_AUTH_KEY 미설정' };
  }
  if (!snapshot.krxTokenValid) {
    return {
      name: 'KRX OpenAPI',
      status: 'FAIL',
      detail: `회로 ${snapshot.krxCircuitState} (실패 ${snapshot.krxFailures}회)`,
    };
  }
  return { name: 'KRX OpenAPI', status: 'PASS', detail: `${snapshot.krxCircuitState} (실패 ${snapshot.krxFailures}회)` };
}

function checkAutoTrade(snapshot: HealthSnapshot): PostHolidayCheck {
  if (snapshot.emergencyStop) {
    return { name: 'Auto Trade', status: 'FAIL', detail: '비상정지 활성 — /reset 필요' };
  }
  if (!snapshot.autoTradeEnabled) {
    return { name: 'Auto Trade', status: 'WARN', detail: 'AUTO_TRADE_ENABLED=false' };
  }
  return { name: 'Auto Trade', status: 'PASS', detail: `${snapshot.autoTradeMode} 모드 활성` };
}

function checkWatchlist(snapshot: HealthSnapshot): PostHolidayCheck {
  const count = snapshot.watchlistCount;
  if (count === 0) {
    return { name: 'Watchlist', status: 'FAIL', detail: '워치리스트 비어 있음 — autoPopulate 점검' };
  }
  if (count < 5) {
    return { name: 'Watchlist', status: 'WARN', detail: `${count}개 (5개 미만 — 후보 부족 의심)` };
  }
  return { name: 'Watchlist', status: 'PASS', detail: `${count}개` };
}

export function runChecks(snapshot: HealthSnapshot): PostHolidayCheck[] {
  return [
    checkKrxMaster(),
    checkKisToken(snapshot),
    checkKrxOpenApi(snapshot),
    checkAutoTrade(snapshot),
    checkWatchlist(snapshot),
  ];
}

// ─── 메시지 빌더 ─────────────────────────────────────────────────────────

function emojiForStatus(s: PostHolidayCheckStatus): string {
  return s === 'PASS' ? '✅' : s === 'WARN' ? '⚠️' : '🚨';
}

function headerEmoji(checks: PostHolidayCheck[]): string {
  if (checks.some((c) => c.status === 'FAIL')) return '🚨';
  if (checks.some((c) => c.status === 'WARN')) return '⚠️';
  return '✅';
}

export function formatKickstartMessage(checks: PostHolidayCheck[], date: string): string {
  const head = headerEmoji(checks);
  const lines = checks.map((c) => `${emojiForStatus(c.status)} ${c.name}: ${c.detail}`);
  return [
    `${head} 휴장 후 첫 거래일 사전 점검 (${date})`,
    '',
    ...lines,
  ].join('\n');
}

export function formatFollowupMessage(
  prevChecks: PostHolidayCheck[],
  currChecks: PostHolidayCheck[],
  date: string,
): string {
  const changes: string[] = [];
  for (const curr of currChecks) {
    const prev = prevChecks.find((p) => p.name === curr.name);
    if (!prev) continue;
    if (prev.status !== curr.status) {
      changes.push(
        `${emojiForStatus(curr.status)} ${curr.name}: ${prev.status} → ${curr.status} (${curr.detail})`,
      );
    }
  }
  const head = headerEmoji(currChecks);
  if (changes.length === 0) {
    return [
      `${head} 휴장 후 첫 거래일 추적 점검 (${date})`,
      '',
      '1차 점검 대비 변화 없음 — 동일 상태 유지.',
    ].join('\n');
  }
  return [
    `${head} 휴장 후 첫 거래일 추적 점검 (${date})`,
    '',
    '1차 대비 변화:',
    ...changes,
  ].join('\n');
}

// ─── 1차 / 2차 진입점 ────────────────────────────────────────────────────

export async function preMarketKickstart(now = new Date()): Promise<void> {
  if (process.env.POST_HOLIDAY_KICKSTART_DISABLED === 'true') return;
  if (!isPostHolidayFirstDay(now)) return; // 일반 거래일 silent

  let snapshot: HealthSnapshot;
  try {
    snapshot = collectHealthSnapshot();
  } catch (e) {
    console.warn(
      '[PostHolidayKickstart] snapshot 수집 실패:',
      e instanceof Error ? e.message : e,
    );
    return;
  }

  const checks = runChecks(snapshot);
  const date = todayKstYmd(now);
  const msg = formatKickstartMessage(checks, date);

  const hasFail = checks.some((c) => c.status === 'FAIL');
  const hasWarn = checks.some((c) => c.status === 'WARN');
  const priority: 'CRITICAL' | 'HIGH' | 'NORMAL' = hasFail ? 'CRITICAL' : hasWarn ? 'HIGH' : 'NORMAL';

  try {
    await sendTelegramAlert(msg, {
      priority,
      dedupeKey: `post_holiday_kickstart:${date}`,
      cooldownMs: 24 * 3600_000,
      category: 'health_loop',
    });
  } catch (e) {
    console.warn(
      '[PostHolidayKickstart] 1차 텔레그램 실패:',
      e instanceof Error ? e.message : e,
    );
  }

  const state = loadPostHolidayState();
  state.lastFirstDayCheckedAt = now.toISOString();
  state.lastFirstDayDate = date;
  state.lastChecks = checks;
  savePostHolidayState(state);
}

export async function preMarketFollowup(now = new Date()): Promise<void> {
  if (process.env.POST_HOLIDAY_KICKSTART_DISABLED === 'true') return;
  if (!isPostHolidayFirstDay(now)) return; // 일반 거래일 silent

  const state = loadPostHolidayState();
  const date = todayKstYmd(now);
  // 1차 점검이 같은 날짜에 실행되지 않았으면 추적 점검 의미 없음 — silent.
  if (state.lastFirstDayDate !== date || !state.lastChecks || state.lastChecks.length === 0) {
    return;
  }

  let snapshot: HealthSnapshot;
  try {
    snapshot = collectHealthSnapshot();
  } catch (e) {
    console.warn(
      '[PostHolidayKickstart] followup snapshot 실패:',
      e instanceof Error ? e.message : e,
    );
    return;
  }

  const currChecks = runChecks(snapshot);
  const msg = formatFollowupMessage(state.lastChecks, currChecks, date);

  try {
    await sendTelegramAlert(msg, {
      priority: 'NORMAL',
      dedupeKey: `post_holiday_followup:${date}`,
      cooldownMs: 24 * 3600_000,
      category: 'health_loop',
    });
  } catch (e) {
    console.warn(
      '[PostHolidayKickstart] 추적 텔레그램 실패:',
      e instanceof Error ? e.message : e,
    );
  }

  // 추적 결과로 lastChecks 갱신 (다음 사이클을 위해).
  state.lastChecks = currChecks;
  savePostHolidayState(state);
}

// ─── 등록 ────────────────────────────────────────────────────────────────

export function registerPostHolidayKickstart(): void {
  // KST 07:30 (UTC 22:30 전일) — 평일만, 본 함수 내부 isPostHolidayFirstDay() 가 추가 가드.
  // ScheduleClass='TRADING_DAY_ONLY' 로 KRX 공휴일 자동 차단 + 평일 cron 마스크.
  scheduledJob(
    '30 22 * * 0-4',
    'TRADING_DAY_ONLY',
    'post_holiday_kickstart',
    () => preMarketKickstart(),
    { timezone: 'UTC' },
  );
  // KST 08:30 추적 점검 (UTC 23:30 전일).
  scheduledJob(
    '30 23 * * 0-4',
    'TRADING_DAY_ONLY',
    'post_holiday_followup',
    () => preMarketFollowup(),
    { timezone: 'UTC' },
  );
  console.log(
    '[PostHolidayKickstart] 휴장 후 첫 거래일 가속 점검 등록 (07:30 1차 + 08:30 추적, 일반 거래일 silent)',
  );
}

// ─── 테스트 헬퍼 ─────────────────────────────────────────────────────────

export function __resetPostHolidayKickstartStateForTests(): void {
  if (fs.existsSync(POST_HOLIDAY_KICKSTART_STATE_FILE)) {
    try {
      fs.unlinkSync(POST_HOLIDAY_KICKSTART_STATE_FILE);
    } catch {
      /* noop */
    }
  }
}
