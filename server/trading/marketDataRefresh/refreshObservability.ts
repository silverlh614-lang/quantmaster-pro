// @responsibility marketDataRefresh 시작/성공/실패/스킵 로깅과 P1 운영 경고 emit 단일 통로 (providerIssue≠marketSignal 명시)
/**
 * refreshObservability.ts — ADR-0595 marketDataRefresh 섹션 모듈 분해.
 *
 * 본체 marketDataRefresh.ts 에서 텍스트 그대로 이동 (byte-equivalent, behavior change 0).
 * 전 섹션 모듈이 공유하는 emitMarketDataProviderWarn 을 형제 모듈로 격리해 순환 import 를 차단한다.
 */

import { loadMacroState } from '../../persistence/macroStateRepo.js';
import { resolveRegimeSnapshot } from '../regime/regimeResolver.js';
import { classifyMacroDataHealth, listMacroDataHealthIssues, summarizeMacroDataHealth } from '../regime/macroDataHealthRouter.js';
import { defaultWarnTtlSec, emitOperationalWarn } from '../../observability/operationalWarn.js';
import type { MacroRefreshReason } from './types.js';

export function macroRefreshRuntimeContext(now = new Date()): { marketSession: string; engineMode: string; r6State: string; sellOnly: boolean } {
  try {
    const macro = loadMacroState();
    const regimeSnapshot = resolveRegimeSnapshot({ macroState: macro, now });
    const r6State = regimeSnapshot.diagnostics.transitionState.r6StateMachineState ?? regimeSnapshot.effectiveRegime;
    return {
      marketSession: process.env.MARKET_SESSION ?? process.env.NODE_ENV ?? 'UNKNOWN',
      engineMode: regimeSnapshot.engineMode,
      r6State,
      sellOnly: false,
    };
  } catch (e) {
    return {
      marketSession: process.env.MARKET_SESSION ?? process.env.NODE_ENV ?? 'UNKNOWN',
      engineMode: 'UNKNOWN',
      r6State: 'UNKNOWN',
      sellOnly: false,
    };
  }
}

export function logMacroRefreshStarted(reason: MacroRefreshReason): void {
  const ctx = macroRefreshRuntimeContext();
  console.info(
    '[MACRO_REFRESH_STARTED] ' +
    `reason=${reason} ` +
    `marketSession=${ctx.marketSession} ` +
    `engineMode=${ctx.engineMode} ` +
    `r6State=${ctx.r6State} ` +
    `sellOnly=${ctx.sellOnly}`,
  );
}

export function logMacroRefreshSuccess(input: { updatedAt: string; mhs?: number; vkospi?: number; kospiDayReturn?: number; writeSucceeded: boolean }): void {
  console.info(
    '[MACRO_REFRESH_SUCCESS] ' +
    `updatedAt=${input.updatedAt} ` +
    `mhs=${input.mhs ?? 'N/A'} ` +
    `vkospi=${input.vkospi ?? 'N/A'} ` +
    `kospiDayReturn=${input.kospiDayReturn ?? 'N/A'} ` +
    `writeSucceeded=${input.writeSucceeded}`,
  );
}

export function logMacroRefreshFailed(input: { error: unknown; provider: string; fallbackUsed?: boolean | string }): void {
  const errorName = input.error instanceof Error ? input.error.name : 'Error';
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code: 'P1_MACRO_DATA_HEALTH_DEGRADED',
    message: '[MACRO_REFRESH_FAILED] macro provider refresh failed',
    executionImpact: 'NONE',
    mode: 'DEGRADED',
    dedupKey: `macro-refresh-failed:${input.provider}:${errorName}`,
    ttlSec: defaultWarnTtlSec('P1'),
    details: {
      reason: 'providerIssue=true marketSignal=false',
      errorName,
      errorMessage,
      provider: input.provider,
      fallbackUsed: input.fallbackUsed ?? 'N/A',
    },
  });
}

export function logMacroRefreshSkipped(reason: string): void {
  const ctx = macroRefreshRuntimeContext();
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code: 'P1_REGIME_DATA_HEALTH_STALE',
    message: '[MACRO_REFRESH_SKIPPED] macro refresh skipped',
    executionImpact: 'NONE',
    mode: 'DEGRADED',
    dedupKey: `macro-refresh-skipped:${reason}:${ctx.r6State}`,
    ttlSec: defaultWarnTtlSec('P1'),
    details: {
      reason,
      engineMode: ctx.engineMode,
      r6State: ctx.r6State,
      shouldNotSkipInR6: true,
      providerIssue: true,
      marketSignal: false,
    },
  });
}

export function emitMacroDataHealthSummary(updated: unknown): void {
  const dataHealth = classifyMacroDataHealth(updated as Parameters<typeof classifyMacroDataHealth>[0]);
  const sourceHealth = summarizeMacroDataHealth(dataHealth);
  const issues = listMacroDataHealthIssues(dataHealth);
  if (issues.length === 0) return;
  const staleOnlyShortSelling = issues.length > 0 && issues.every((issue) => issue === 'shortSelling:STALE');
  const hasMacroStateStale = issues.some((issue) => issue.startsWith('macroState:STALE') || issue.startsWith('macroState:HARD_STALE'));
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code: sourceHealth === 'STALE'
      ? (hasMacroStateStale ? 'P1_MACRO_STATE_STALE' : (staleOnlyShortSelling ? 'P1_SHORT_SELLING_DATA_STALE' : 'P1_REGIME_DATA_HEALTH_STALE'))
      : 'P1_MACRO_DATA_HEALTH_DEGRADED',
    message: `[MACRO_DATA_HEALTH] sourceHealth=${sourceHealth}`,
    executionImpact: 'NONE',
    mode: 'DEGRADED',
    dedupKey: `macro-data-health:${sourceHealth}:${issues.join('|')}`,
    ttlSec: defaultWarnTtlSec('P1'),
    details: {
      reason: 'providerIssue=true marketSignal=false',
      sourceHealth,
      issues,
      dataHealth,
    },
  });
}

export function emitMarketDataProviderWarn(reason: string, details: Record<string, unknown> = {}): void {
  emitOperationalWarn({
    priority: 'P1',
    domain: 'DATA',
    code: 'P1_MACRO_DATA_HEALTH_DEGRADED',
    message: `[MarketRefresh] ${reason}`,
    executionImpact: 'NONE',
    mode: 'DEGRADED',
    dedupKey: `market-refresh-provider:${reason}`,
    ttlSec: defaultWarnTtlSec('P1'),
    details: {
      reason: 'providerIssue=true marketSignal=false',
      providerIssue: true,
      marketSignal: false,
      ...details,
    },
  });
}
