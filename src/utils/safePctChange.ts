/**
 * @responsibility 클라이언트 사이드 갭/수익률 % 계산 단일 안전 SSOT (서버 사본)
 *
 * ADR-0028. `server/utils/safePctChange.ts` 의 동기 사본 — 서버↔클라 직접 import
 * 금지 절대 규칙(#3). 5종 가드 일괄 적용:
 *   1. 분모 가드 — base ≤ 0 / NaN / Infinity → null
 *   2. 분자 가드 — current < 0 / NaN / Infinity → null
 *   3. 결과 NaN/Infinity 가드 → null
 *   4. Sanity bound (default ±90%) — 위반 시 null + 진단 로그 (60s throttle)
 *   5. 호출자 컨텍스트 — label 옵션
 *
 * 서버 사본과 동일 시그니처 — 호출자가 server/client 어디에서든 동일하게 사용 가능.
 */

import { clientWarn } from './clientWarn';

const DEFAULT_SANITY_BOUND_PCT = 90;
const LOG_THROTTLE_MS = 60_000;

const _lastWarnAt = new Map<string, number>();

function warnSafePctDegraded(reason: string, current: number, base: number, opts: SafePctChangeOptions): void {
  if (opts.silent) return;
  const label = opts.label ?? 'unknown';
  const warnKey = `${label}:${reason}`;
  const now = Date.now();
  const last = _lastWarnAt.get(warnKey) ?? 0;
  if (now - last < LOG_THROTTLE_MS) return;
  _lastWarnAt.set(warnKey, now);
  clientWarn({
    domain: 'CLIENT_DATA',
    code: 'P4_CLIENT_SAFE_PCT_CHANGE_DEGRADED',
    message: `[safePctChange] ${reason} @${label} — 화면 표시용 % fallback(null) 반환`,
    dedupKey: `safePctChange:${warnKey}`,
    details: {
      current,
      base,
      clientOnly: true,
      executionImpact: 'NONE',
      serverImpact: 'NONE',
    },
  });
}

export interface SafePctChangeOptions {
  sanityBoundPct?: number;
  label?: string;
  silent?: boolean;
}

export function safePctChange(
  current: number,
  base: number,
  opts: SafePctChangeOptions = {},
): number | null {
  if (!Number.isFinite(base) || base <= 0) {
    warnSafePctDegraded('invalid denominator', current, base, opts);
    return null;
  }
  if (!Number.isFinite(current) || current < 0) {
    warnSafePctDegraded('invalid numerator', current, base, opts);
    return null;
  }

  const result = ((current - base) / base) * 100;
  if (!Number.isFinite(result)) {
    warnSafePctDegraded('non-finite result', current, base, opts);
    return null;
  }

  const bound = opts.sanityBoundPct ?? DEFAULT_SANITY_BOUND_PCT;
  if (Math.abs(result) > bound) {
    if (!opts.silent) {
      const label = opts.label ?? 'unknown';
      const now = Date.now();
      const last = _lastWarnAt.get(label) ?? 0;
      if (now - last >= LOG_THROTTLE_MS) {
        _lastWarnAt.set(label, now);
        clientWarn({
          domain: 'CLIENT_DATA',
          code: 'P4_CLIENT_SAFE_PCT_CHANGE_DEGRADED',
          message: `[safePctChange] sanity 위반 @${label} — 화면 표시용 % fallback(null) 반환`,
          dedupKey: `safePctChange:${label}`,
          details: {
            resultPct: result,
            sanityBoundPct: bound,
            current,
            base,
            clientOnly: true,
            executionImpact: 'NONE',
            serverImpact: 'NONE',
          },
        });
      }
    }
    return null;
  }

  return result;
}
