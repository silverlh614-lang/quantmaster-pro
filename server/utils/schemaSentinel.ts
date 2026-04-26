/**
 * @responsibility 외부 API 응답을 zod 스키마로 검증하고 실패 시 격리·경보·일시 차단을 일괄 처리한다.
 *
 * 결정성 패치 Tier 2 #5 — KIS/KRX/Yahoo/DART API 경계마다 응답 스키마를 정의해
 * NaN/undefined 가 학습 가중치까지 흘러들어 silently 손상시키는 시나리오를 차단한다.
 *
 * 검증 실패 시:
 *   1. 격리 폴더 (`data/quarantine/<source>-<ts>.json`) 에 원본 페이로드 저장
 *   2. 텔레그램 HIGH 경보 (source 별 1시간 dedupe)
 *   3. 동일 source 일시 차단 — `isSourceQuarantined(source)` 가 true 반환
 *      (호출자가 다음 요청을 스킵하거나 캐시 폴백)
 */

import fs from 'fs';
import path from 'path';
import type { ZodType } from 'zod';
import { ensureQuarantineDir, QUARANTINE_DIR } from '../persistence/paths.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

export type ExternalDataSource = 'KIS' | 'KRX' | 'YAHOO' | 'DART' | 'NAVER' | 'GEMINI' | 'FRED' | 'ECOS';

export interface SentinelOptions {
  /** 격리 시 일시 차단 지속(ms). 기본 5분. */
  quarantineDurationMs?: number;
  /** 텔레그램 경보 dedupe 윈도우(ms). 기본 1시간. */
  alertCooldownMs?: number;
  /** 격리 시 호출자에게 추가 컨텍스트 제공 (요청 path 등). */
  context?: Record<string, string | number | boolean>;
}

interface QuarantineEntry {
  blockedUntil: number;
  reason: string;
  lastFailedAt: number;
  failureCount: number;
}

const _quarantine = new Map<ExternalDataSource, QuarantineEntry>();
const _lastAlertAt = new Map<ExternalDataSource, number>();

const DEFAULT_QUARANTINE_MS = 5 * 60 * 1000;
const DEFAULT_ALERT_COOLDOWN_MS = 60 * 60 * 1000;

/** source 가 일시 차단 상태인지 확인. 만료 entry 는 호출 시점에 정리. */
export function isSourceQuarantined(source: ExternalDataSource, now: number = Date.now()): boolean {
  if ((process.env.SCHEMA_SENTINEL_DISABLED ?? '').toLowerCase() === 'true') return false;
  const entry = _quarantine.get(source);
  if (!entry) return false;
  if (entry.blockedUntil <= now) {
    _quarantine.delete(source);
    return false;
  }
  return true;
}

function safePayloadString(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2).slice(0, 200_000);
  } catch {
    try { return String(payload).slice(0, 10_000); } catch { return '<unserializable>'; }
  }
}

function persistQuarantine(source: ExternalDataSource, payload: unknown, error: string, opts: SentinelOptions | undefined): string {
  ensureQuarantineDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(QUARANTINE_DIR, `${source.toLowerCase()}-${ts}.json`);
  const body = {
    source,
    at: new Date().toISOString(),
    error,
    context: opts?.context ?? {},
    payload,
  };
  try {
    fs.writeFileSync(file, safePayloadString(body));
  } catch (e) {
    console.warn('[schemaSentinel] 격리 파일 저장 실패:', e instanceof Error ? e.message : e);
  }
  return file;
}

async function notifyQuarantine(source: ExternalDataSource, error: string, file: string, now: number, cooldownMs: number): Promise<void> {
  const last = _lastAlertAt.get(source) ?? 0;
  if (now - last < cooldownMs) return;
  _lastAlertAt.set(source, now);
  try {
    await sendTelegramAlert(
      `🛑 외부 데이터 스키마 검증 실패 — <code>${source}</code> 일시 차단\n사유: ${error.slice(0, 200)}\n격리 파일: <code>${path.basename(file)}</code>`,
      { priority: 'HIGH', dedupeKey: `schema_sentinel:${source}`, cooldownMs },
    );
  } catch (e) {
    console.warn('[schemaSentinel] 텔레그램 경보 실패:', e instanceof Error ? e.message : e);
  }
}

/**
 * 외부 응답 검증 진입점. 성공 시 typed value 반환, 실패 시 null + 격리·경보·차단.
 *
 * `caller` 권장 사용:
 * ```ts
 * const data = validateExternalPayload('KIS', payload, KisInquireSchema, { context: { trId } });
 * if (!data) return null; // schemaSentinel 가 이미 격리 + 차단 + 경보 처리
 * ```
 */
export function validateExternalPayload<T>(
  source: ExternalDataSource,
  payload: unknown,
  schema: ZodType<T>,
  opts?: SentinelOptions,
): T | null {
  if ((process.env.SCHEMA_SENTINEL_DISABLED ?? '').toLowerCase() === 'true') {
    // env 우회 — 검증 자체를 건너뛴다. 단, schema 가 통과하지 않는 데이터가 흘러갈 수 있음.
    const result = schema.safeParse(payload);
    return result.success ? result.data : null;
  }

  const result = schema.safeParse(payload);
  if (result.success) return result.data;

  const now = Date.now();
  const quarantineDuration = opts?.quarantineDurationMs ?? DEFAULT_QUARANTINE_MS;
  const cooldown = opts?.alertCooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS;
  const errorMsg = result.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ');

  const file = persistQuarantine(source, payload, errorMsg, opts);
  const existing = _quarantine.get(source);
  _quarantine.set(source, {
    blockedUntil: now + quarantineDuration,
    reason: errorMsg,
    lastFailedAt: now,
    failureCount: (existing?.failureCount ?? 0) + 1,
  });
  void notifyQuarantine(source, errorMsg, file, now, cooldown);
  return null;
}

/** 운영자 수동 해제. */
export function releaseQuarantine(source: ExternalDataSource): boolean {
  return _quarantine.delete(source);
}

/** 진단 — 현재 차단 중인 source 목록. */
export function getQuarantineStatus(): Array<{ source: ExternalDataSource; blockedUntil: number; reason: string; failureCount: number }> {
  const now = Date.now();
  const out: Array<{ source: ExternalDataSource; blockedUntil: number; reason: string; failureCount: number }> = [];
  for (const [source, entry] of _quarantine.entries()) {
    if (entry.blockedUntil > now) {
      out.push({ source, blockedUntil: entry.blockedUntil, reason: entry.reason, failureCount: entry.failureCount });
    }
  }
  return out;
}

export const __testOnly = {
  reset(): void {
    _quarantine.clear();
    _lastAlertAt.clear();
  },
};
