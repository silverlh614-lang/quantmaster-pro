// @responsibility KRX investor detail 안전 프로브 가드 — 세션·쿨다운·로그 상태 관리
import { logVisibilityEvent } from '../../utils/logger.js';

export type KrxEndpointGuardReason =
  | 'SESSION_CLOSED_NOT_APPLICABLE'
  | 'ENDPOINT_PARAM_NOT_READY'
  | 'BAD_REQUEST_SESSION_OR_PARAM';

export const INVESTOR_DETAIL_SAFE_PROBE_ENDPOINTS = new Set(['MDCSTAT02201', 'MDCSTAT02203', 'MDCSTAT02401']);
export const INVESTOR_DETAIL_SAFE_PROBE_COOLDOWN_MS = 60 * 60 * 1000;

const krxInvestorDetailGuardCooldown = new Map<string, number>();
const krxInvestorDetailGuardLogState = new Map<string, { lastEmittedAt: number; suppressedCount: number }>();

export function resetKrxInvestorDetailSafeProbeGuardState(): void {
  krxInvestorDetailGuardCooldown.clear();
  krxInvestorDetailGuardLogState.clear();
}

function kstDateParts(now: Date): { day: number; hour: number; minute: number } {
  const kst = new Date(now.getTime() + 9 * 60 * 60_000);
  return {
    day: kst.getUTCDay(),
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes(),
  };
}

export function isKrxInvestorDetailIntradaySession(now: Date): boolean {
  if (process.env.KRX_TIME_WINDOW_GATING_DISABLED === 'true') return true;
  if (process.env.DATA_FETCH_FORCE_MARKET === 'true') return true;
  if (process.env.DATA_FETCH_FORCE_OFF === 'true') return false;
  const { day, hour, minute } = kstDateParts(now);
  if (day === 0 || day === 6) return false;
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}

export function isKrxInvestorDetailSafeProbeEndpoint(endpoint: string): boolean {
  return INVESTOR_DETAIL_SAFE_PROBE_ENDPOINTS.has(endpoint);
}

export function krxInvestorDetailProbeEnabled(): boolean {
  return process.env.KRX_INVESTOR_DETAIL_ENABLED === 'true';
}

export function krxInvestorDetailGuardCooldownKey(input: {
  endpoint: string;
  session: 'CLOSED' | 'INTRADAY';
  tradeDate: string;
}): string {
  return `provider=KRX:module=INVESTOR_DETAIL:endpoint=${input.endpoint}:session=${input.session}:date=${input.tradeDate}`;
}

export function activeKrxInvestorDetailGuardCooldown(input: {
  endpoint: string;
  session: 'CLOSED' | 'INTRADAY';
  tradeDate: string;
  now: Date;
}): number {
  const cooldownUntil = krxInvestorDetailGuardCooldown.get(krxInvestorDetailGuardCooldownKey(input)) ?? 0;
  return Math.max(0, cooldownUntil - input.now.getTime());
}

export function recordKrxInvestorDetailBadRequestCooldown(input: {
  endpoint: string;
  tradeDate: string;
  now: Date;
}): void {
  krxInvestorDetailGuardCooldown.set(
    krxInvestorDetailGuardCooldownKey({ endpoint: input.endpoint, session: 'INTRADAY', tradeDate: input.tradeDate }),
    input.now.getTime() + INVESTOR_DETAIL_SAFE_PROBE_COOLDOWN_MS,
  );
}

export function emitKrxInvestorDetailGuard(input: {
  endpoint: string;
  reason: KrxEndpointGuardReason;
  intradaySession: boolean;
  enabled: boolean;
  now: Date;
}): void {
  const key = `${input.endpoint}:${input.reason}:${input.intradaySession ? 'INTRADAY' : 'CLOSED'}:${input.enabled ? 'ENABLED' : 'DISABLED'}`;
  const state = krxInvestorDetailGuardLogState.get(key);
  const elapsed = state ? input.now.getTime() - state.lastEmittedAt : Number.POSITIVE_INFINITY;
  if (!state || elapsed >= INVESTOR_DETAIL_SAFE_PROBE_COOLDOWN_MS) {
    if (state && state.suppressedCount > 0) {
      logVisibilityEvent({
        visibility: 'SUMMARY',
        category: 'KRX',
        message:
        `[KRX_ENDPOINT_GUARD_SUPPRESSED] endpoint=${input.endpoint}` +
        ` reason=${input.reason}` +
        ` suppressedCount=${state.suppressedCount}` +
        ' executionImpact=NONE',
        summary: { endpoint: input.endpoint, reason: input.reason, suppressedCount: state.suppressedCount, executionImpact: 'NONE' },
        details: { input },
        level: 'info',
        executionImpact: 'NONE',
      });
    }
    logVisibilityEvent({
      visibility: 'DIAGNOSTIC',
      category: 'KRX',
      dedupKey: `KRX_ENDPOINT_GUARDED:${input.reason}:${input.endpoint}:NONE`,
      message:
      `[KRX_ENDPOINT_GUARDED] endpoint=${input.endpoint}` +
      ` reason=${input.reason}` +
      ` intradaySession=${String(input.intradaySession)}` +
      ` enabled=${String(input.enabled)}` +
      ' providerIssue=false marketSignal=false executionImpact=NONE',
      summary: { endpoint: input.endpoint, reason: input.reason, providerIssue: false, marketSignal: false, executionImpact: 'NONE' },
      details: { input },
      level: 'info',
      executionImpact: 'NONE',
    });
    krxInvestorDetailGuardLogState.set(key, { lastEmittedAt: input.now.getTime(), suppressedCount: 0 });
    return;
  }
  state.suppressedCount += 1;
}
