/**
 * @responsibility ADR diagnostic log normalization with summary logging.
 * ADR-0001 scan diagnostics core split.
 */

import { logger, logNoiseDetail } from '../../../utils/logger.js';

const GATE1_DRY_RUN_ADR_CODES = new Set([
  'ADR-0467',
  'ADR-0468',
  'ADR-0469',
  'ADR-0470',
  'ADR-0471',
  'ADR-0472',
  'ADR-0475',
  'ADR-0476',
]);
const GATE1_DRY_RUN_LUNCH_RATE_LIMIT_MS = 15 * 60 * 1000;
const gate1DryRunLogLastEmittedAt = new Map<string, number>();

export interface AdrDiagnosticPayload {
  adrCode?: string;
  dryRun?: boolean;
  engineMode?: string;
  executionImpact?: 'NONE' | string;
  liveExecutionAllowed?: boolean;
  session?: string;
  reason?: string;
  issueClass?: string;
  providerIssue?: boolean;
  marketSignal?: boolean;
  deferred?: boolean;
  [key: string]: unknown;
}

export interface AdrDiagnosticLogOptions {
  nowMs?: number;
  rateLimitMs?: number;
  recordShadowCase?: () => void;
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
}

function currentKstSession(nowMs = Date.now()): 'LUNCH_GUARD' | 'REGULAR' {
  const kst = new Date(nowMs + 9 * 60 * 60_000);
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= 11 * 60 + 30 && minutes < 13 * 60 ? 'LUNCH_GUARD' : 'REGULAR';
}

function adrCodeFromEvent(event: string, payload: AdrDiagnosticPayload): string {
  return payload.adrCode ?? event.match(/ADR-\d{4}/)?.[0] ?? 'ADR-UNKNOWN';
}

function normalizeAdrDiagnosticPayload(event: string, payload: AdrDiagnosticPayload): AdrDiagnosticPayload {
  const adrCode = adrCodeFromEvent(event, payload);
  const gate1Diagnostic = GATE1_DRY_RUN_ADR_CODES.has(adrCode);
  return {
    ...payload,
    adrCode,
    ...(gate1Diagnostic
      ? {
          issueClass: payload.issueClass ?? 'GATE1_DIAGNOSTIC',
          providerIssue: payload.providerIssue ?? false,
          marketSignal: payload.marketSignal ?? false,
          executionImpact: payload.executionImpact ?? 'NONE',
          deferred: payload.deferred ?? true,
        }
      : {}),
  };
}

function isNonImpactAdrDiagnostic(payload: AdrDiagnosticPayload): boolean {
  return payload.dryRun === true
    || payload.engineMode === 'SHADOW_ONLY'
    || payload.executionImpact === 'NONE'
    || payload.liveExecutionAllowed === false;
}

export function resetAdrDiagnosticLogRateLimiterForTest(): void {
  gate1DryRunLogLastEmittedAt.clear();
}

export function logAdrDiagnostic(
  event: string,
  payload: AdrDiagnosticPayload = {},
  options: AdrDiagnosticLogOptions = {},
): boolean {
  const activeLogger = options.logger ?? logger;
  const nowMs = options.nowMs ?? Date.now();
  const normalized = normalizeAdrDiagnosticPayload(event, payload);
  options.recordShadowCase?.();

  const adrCode = adrCodeFromEvent(event, normalized);
  const session = normalized.session ?? currentKstSession(nowMs);
  const reason = String(normalized.reason ?? normalized.issueClass ?? 'UNSPECIFIED');
  const nonImpact = isNonImpactAdrDiagnostic(normalized);

  if (GATE1_DRY_RUN_ADR_CODES.has(adrCode) && session === 'LUNCH_GUARD' && nonImpact) {
    const key = `${adrCode}:${session}:${reason}`;
    const rateLimitMs = options.rateLimitMs ?? GATE1_DRY_RUN_LUNCH_RATE_LIMIT_MS;
    const lastEmittedAt = gate1DryRunLogLastEmittedAt.get(key) ?? 0;
    if (lastEmittedAt > 0 && nowMs - lastEmittedAt < rateLimitMs) {
      return false;
    }
    gate1DryRunLogLastEmittedAt.set(key, nowMs);
  }

  if (nonImpact) {
    if (GATE1_DRY_RUN_ADR_CODES.has(adrCode)) {
      logNoiseDetail({
        category: 'GATE1_DIAGNOSTIC_DRY_RUN',
        message: event,
        payload: { ...normalized, session, reason },
        loggerOverride: activeLogger,
      });
      return true;
    }
    activeLogger.debug(event, { ...normalized, session, reason });
    return true;
  }

  activeLogger.warn(event, { ...normalized, session, reason });
  return true;
}

export interface GateDiagnosticSummaryInput {
  session: string;
  dryRuns: number;
  candidates: number;
  deferred: number;
  executionImpact: 'NONE' | string;
}

export function formatGateDiagnosticSummary(summary: GateDiagnosticSummaryInput): string {
  return `[GateDiagnosticSummary] session=${summary.session} dryRuns=${summary.dryRuns} candidates=${summary.candidates} deferred=${summary.deferred} executionImpact=${summary.executionImpact}`;
}

export function logGateDiagnosticSummary(
  summary: GateDiagnosticSummaryInput,
  target: Pick<Console, 'info'> = logger,
): void {
  target.info(formatGateDiagnosticSummary(summary));
}

export interface PreBreakoutNoiseSummaryInput {
  scanned: number;
  wait: number;
  approaching: number;
  gateFail: number;
  ready: number;
  rejected: number;
  priceDistance?: number;
}

export function formatPreBreakoutNoiseSummary(summary: PreBreakoutNoiseSummaryInput): string {
  const priceDistance = summary.priceDistance === undefined ? '' : ` priceDistance=${summary.priceDistance}`;
  return `[PreBreakoutSummary] scanned=${summary.scanned} wait=${summary.wait} approaching=${summary.approaching} gateFail=${summary.gateFail} ready=${summary.ready} rejected=${summary.rejected}${priceDistance}`;
}

export function logPreBreakoutNoiseSummary(
  summary: PreBreakoutNoiseSummaryInput,
  logger: Pick<Console, 'info'> = console,
): void {
  logger.info(formatPreBreakoutNoiseSummary(summary));
}
