// @responsibility credentialExpiryWatchdog — 인증키 만료 D-90/30/7/1/0 단계별 알림 (ADR-0131)
//
// KRX_API_KEY 만료 (2027-04-19) 사전 알림 인프라. 임계 변화 시에만 알림 +
// lastAlertedThreshold 영속으로 같은 임계 중복 차단. 만료 후 매일 1회 (date dedupeKey).
//
// 본 PR 은 KRX_API_KEY 1종만 등록 — 향후 KIS APP_KEY / Naver / Gemini 등 추가 가능.

import { emitMaintenanceWarn } from '../observability/maintenanceWarn.js';
import fs from 'fs';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { CREDENTIAL_EXPIRY_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { scheduledJob } from '../scheduler/scheduleGuard.js';

// ─── 등록된 credentials SSOT ─────────────────────────────────────────────

export interface CredentialEntry {
  id: string;
  label: string;
  /** 만료 일자 (YYYY-MM-DD KST). */
  expiresAt: string;
}

export const KNOWN_CREDENTIALS: CredentialEntry[] = [
  {
    id: 'KRX_API_KEY',
    label: 'KRX OpenAPI 인증키',
    expiresAt: '2027-04-19',
  },
];

/** D-임계 — 도달 시 1회 알림. 0 = 만료 당일/이후 (매일 1회 발송). */
export const ALERT_THRESHOLDS_DAYS: number[] = [90, 30, 7, 1, 0];

// ─── 영속 ────────────────────────────────────────────────────────────────

export interface CredentialExpiryState {
  /** credential id → 마지막 알림된 임계 (90/30/7/1/0). */
  lastAlertedThreshold?: Record<string, number>;
  /** 0 임계 (만료) 마지막 알림 일자 (YYYY-MM-DD) — 매일 1회 보장. */
  expiredLastAlertedDate?: Record<string, string>;
}

export function loadCredentialExpiryState(): CredentialExpiryState {
  ensureDataDir();
  if (!fs.existsSync(CREDENTIAL_EXPIRY_STATE_FILE)) return {};
  try {
    const raw = fs.readFileSync(CREDENTIAL_EXPIRY_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const obj = parsed as Partial<CredentialExpiryState>;
    return {
      lastAlertedThreshold:
        obj.lastAlertedThreshold && typeof obj.lastAlertedThreshold === 'object'
          ? { ...(obj.lastAlertedThreshold as Record<string, number>) }
          : {},
      expiredLastAlertedDate:
        obj.expiredLastAlertedDate && typeof obj.expiredLastAlertedDate === 'object'
          ? { ...(obj.expiredLastAlertedDate as Record<string, string>) }
          : {},
    };
  } catch {
    return {};
  }
}

export function saveCredentialExpiryState(state: CredentialExpiryState): void {
  ensureDataDir();
  const tmp = `${CREDENTIAL_EXPIRY_STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, CREDENTIAL_EXPIRY_STATE_FILE);
}

// ─── 평가 SSOT ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function todayKstYmd(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export interface CredentialEvaluation {
  id: string;
  label: string;
  expiresAt: string;
  daysUntilExpiry: number;
  /** 도달한 임계 (가장 작은 임계 ≤ daysUntilExpiry). null = 임계 미도달. */
  threshold: number | null;
}

/**
 * 단일 credential 평가. 임계 도달 산출 SSOT.
 * - daysUntilExpiry > 90 → threshold=null
 * - daysUntilExpiry ≤ 0 → threshold=0
 * - 외 → 가장 작은 임계 ≥ daysUntilExpiry 의 "도달했으면서 가장 큰" 임계
 *
 * 예: 89일 남음 → 90 이상 임계 미달, 30 임계 미도달 → 90 임계 도달 (도달한 것 중 가장 큰).
 *     실제로는 사용자 사양상 "임계 변화 시에만 알림" 패턴 — 임계 도달 = 90/30/7/1/0 중 daysUntilExpiry ≤ 임계 값.
 */
export function evaluateCredential(
  credential: CredentialEntry,
  now: Date,
): CredentialEvaluation {
  const todayMs = ymdToUtcMs(todayKstYmd(now));
  const expiryMs = ymdToUtcMs(credential.expiresAt);
  const days = Math.floor((expiryMs - todayMs) / DAY_MS);

  // 도달한 임계: ALERT_THRESHOLDS_DAYS 중 days <= 임계 인 것 가운데 가장 작은 임계.
  // 예: 89일 → 90 임계 도달 / 31일 → 90 임계 도달 / 30일 → 30 임계 도달 / 8일 → 30 임계 도달
  // 7일 → 7 임계 도달 / 2일 → 7 임계 도달 / 1일 → 1 임계 도달 / 0일 → 0 임계.
  // 정렬 오름차순 후 첫 매칭 (가장 작은 임계 = 가장 임박한 단계).
  const sorted = [...ALERT_THRESHOLDS_DAYS].sort((a, b) => a - b);
  let threshold: number | null = null;
  for (const t of sorted) {
    if (days <= t) {
      threshold = t;
      break;
    }
  }

  return {
    id: credential.id,
    label: credential.label,
    expiresAt: credential.expiresAt,
    daysUntilExpiry: days,
    threshold,
  };
}

// ─── 메시지 빌더 ─────────────────────────────────────────────────────────

function severityForThreshold(threshold: number): 'CRITICAL' | 'HIGH' {
  return threshold <= 1 ? 'CRITICAL' : 'HIGH';
}

function emojiForThreshold(threshold: number): string {
  if (threshold === 0) return '🚨';
  if (threshold === 1) return '🚨';
  if (threshold === 7) return '⚠️';
  return '🟡';
}

export function formatCredentialExpiryMessage(eval0: CredentialEvaluation): string {
  const t = eval0.threshold;
  if (t === null) return '';
  const emoji = emojiForThreshold(t);
  if (t === 0) {
    if (eval0.daysUntilExpiry < 0) {
      return `${emoji} ${eval0.label} 만료됨\n만료일: ${eval0.expiresAt} (${Math.abs(eval0.daysUntilExpiry)}일 경과)\n즉시 갱신 필요.`;
    }
    return `${emoji} ${eval0.label} 오늘 만료\n만료일: ${eval0.expiresAt}\n즉시 갱신 필요.`;
  }
  return `${emoji} ${eval0.label} D-${eval0.daysUntilExpiry}\n만료일: ${eval0.expiresAt}\nT-${t}일 임계 도달 — 갱신 일정 검토.`;
}

// ─── 진입점 ──────────────────────────────────────────────────────────────

export async function runCredentialWatchdog(now = new Date()): Promise<void> {
  if (process.env.CREDENTIAL_WATCHDOG_DISABLED === 'true') return;

  let state: CredentialExpiryState;
  try {
    state = loadCredentialExpiryState();
  } catch {
    state = {};
  }
  const lastThreshold = state.lastAlertedThreshold ?? {};
  const expiredLast = state.expiredLastAlertedDate ?? {};
  const today = todayKstYmd(now);

  for (const cred of KNOWN_CREDENTIALS) {
    const eval0 = evaluateCredential(cred, now);
    if (eval0.threshold === null) continue; // 임계 미도달

    const t = eval0.threshold;
    const lastT = lastThreshold[cred.id];

    // 0 임계 (만료) — 매일 1회 발송 (date dedupeKey).
    if (t === 0) {
      if (expiredLast[cred.id] === today) continue; // 오늘 이미 발송
      const msg = formatCredentialExpiryMessage(eval0);
      try {
        await sendTelegramAlert(msg, {
          priority: 'CRITICAL',
          dedupeKey: `credential_expired:${cred.id}:${today}`,
          cooldownMs: 24 * 3600_000,
          category: 'credential_expiry',
        });
        expiredLast[cred.id] = today;
      } catch (e) {
        emitMaintenanceWarn({ domain: 'DIAGNOSTIC', code: 'P3_CREDENTIAL_WATCHDOG_NOISY', source: 'CREDENTIAL_WATCHDOG', message: 'Credential expiry alert delivery failed; watchdog remains isolated.', dedupKey: `p3:credential-watchdog:expired:${cred.id}`, error: e, details: { credentialId: cred.id, threshold: t } });
      }
      continue;
    }

    // 90/30/7/1 임계 — 임계 변화 시에만 알림. lastT 가 t 와 다르면 (예: lastT=undefined / lastT=90, t=30).
    if (lastT === t) continue; // 같은 임계 중복 차단
    const msg = formatCredentialExpiryMessage(eval0);
    try {
      await sendTelegramAlert(msg, {
        priority: severityForThreshold(t),
        dedupeKey: `credential_threshold:${cred.id}:${t}`,
        cooldownMs: 30 * 24 * 3600_000, // 30일 — 같은 임계 한 번만
        category: 'credential_expiry',
      });
      lastThreshold[cred.id] = t;
    } catch (e) {
      emitMaintenanceWarn({ domain: 'DIAGNOSTIC', code: 'P3_CREDENTIAL_WATCHDOG_NOISY', source: 'CREDENTIAL_WATCHDOG', message: 'Credential threshold alert delivery failed; watchdog remains isolated.', dedupKey: `p3:credential-watchdog:threshold:${cred.id}:${t}`, error: e, details: { credentialId: cred.id, threshold: t } });
    }
  }

  state.lastAlertedThreshold = lastThreshold;
  state.expiredLastAlertedDate = expiredLast;
  saveCredentialExpiryState(state);
}

export function registerCredentialExpiryWatchdog(): void {
  // KST 09:30 (UTC 00:30) 매일 — ALWAYS_ON (휴일도 인증키 만료 임박이면 알림).
  scheduledJob(
    '30 0 * * *',
    'ALWAYS_ON',
    'credential_expiry_watchdog',
    () => runCredentialWatchdog(),
    { timezone: 'UTC' },
  );
  console.log(
    '[CredentialWatchdog] 인증키 만료 watchdog 등록 (09:30 KST 매일, KNOWN_CREDENTIALS:',
    KNOWN_CREDENTIALS.map((c) => c.id).join(','),
    ')',
  );
}

// ─── 테스트 헬퍼 ─────────────────────────────────────────────────────────

export function __resetCredentialExpiryStateForTests(): void {
  if (fs.existsSync(CREDENTIAL_EXPIRY_STATE_FILE)) {
    try {
      fs.unlinkSync(CREDENTIAL_EXPIRY_STATE_FILE);
    } catch {
      /* noop */
    }
  }
}
