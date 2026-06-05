// @responsibility Scan evaluation state machine public contract and formatter.

import type { ScanCounters } from '../scanDiagnostics/scanCounterTypes.js';
import type { MacroGateState } from '../scanDiagnostics/scanSummaryTypes.js';
import { classifyScanBlockReason } from './scanBlockReasonClassifier.js';
import { buildGateEvaluationReport } from './gateEvaluationReporter.js';
import { evaluateQuoteHydration } from './quoteHydrationGuard.js';
import { isKrxTradingDay } from '../../../calendar/krxTradingCalendar.js';
import { resolveStaleLegacyR6 } from '../scanDiagnostics/staleLegacyR6.js';

export type ScanEvaluationState =
  | 'NOT_EVALUATED_SELL_ONLY'
  | 'NOT_EVALUATED_NON_TRADING_DAY'
  | 'NOT_EVALUATED_R6_LIVE_BLOCKED'
  | 'NOT_EVALUATED_DIAGNOSTIC_ONLY'
  | 'NOT_EVALUATED_OBSERVE_ONLY'
  | 'EVALUATED_ZERO_SURVIVOR'
  | 'EVALUATED_DATA_INSUFFICIENT'
  | 'EVALUATED_GATE_REJECTED'
  | 'EVALUATED_QUOTE_HYDRATION_FAILED'
  | 'EVALUATED_PARTIAL'
  | 'EVALUATED_WITH_SURVIVORS';

export type ScanEvaluationExecutionImpact =
  | 'NONE'
  | 'NEW_BUY_BLOCKED_ONLY'
  | 'SCAN_GATE_DEGRADED';

export interface ScanEvaluationResult {
  scanId: string;
  asOf: string;
  evaluationState: ScanEvaluationState;
  marketSessionState: string;
  engineMode: string;
  effectiveRegime: string;
  totalCandidates: number;
  evaluated: number;
  skipped: number;
  rejected: number;
  survivors: number;
  quoteHydrated: number;
  quoteHydrationFailed: number;
  blockReason?: string;
  breakPoint?: string;
  sourcePath: string;
  executionImpact: ScanEvaluationExecutionImpact;
  shadowLearningAllowed: boolean;
  diagnostics?: Record<string, unknown>;
}

export interface BuildScanEvaluationResultInput {
  scanId?: string;
  asOf?: string;
  counters: ScanCounters;
  totalCandidates: number;
  sellOnly?: boolean;
  marketSessionState?: string;
  engineMode?: string;
  effectiveRegime?: string;
  macroGateState?: MacroGateState;
  volumeClockAllowsEntry?: boolean;
  sourcePath: string;
  diagnostics?: Record<string, unknown>;
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function stringField(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export type ScanMarketCanonicalSession = 'REGULAR_OPEN' | 'POST_CLOSE' | 'CLOSED' | 'HOLIDAY' | 'UNKNOWN';

export interface ScanMarketSessionView {
  marketSessionState: string;
  canonicalSession: ScanMarketCanonicalSession;
  displaySession: string;
}

function upper(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function canonicalSessionFromRaw(value: string | null | undefined): ScanMarketCanonicalSession {
  const session = upper(value);
  if (!session) return 'UNKNOWN';
  if (session.includes('HOLIDAY') || session === 'NON_TRADING_DAY') return 'HOLIDAY';
  if (session.includes('POST_CLOSE') || session.includes('AFTERMARKET') || session.includes('AFTER_MARKET')) return 'POST_CLOSE';
  if (session.includes('CLOSED') || session === 'PRE_MARKET') return 'CLOSED';
  if (session === 'BUY_ALLOWED' || session === 'OPEN' || session === 'REGULAR_OPEN' || session === 'REGULAR') return 'REGULAR_OPEN';
  return 'UNKNOWN';
}

function kstMinuteFromLabel(value: string | undefined): number | null {
  const raw = String(value ?? '').trim();
  const hhmm = raw.match(/\b(\d{2}):(\d{2})\b/);
  if (hhmm) {
    const hour = Number(hhmm[1]);
    const minute = Number(hhmm[2]);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) return hour * 60 + minute;
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const parsed = new Date(ms);
  return parsed.getUTCHours() * 60 + parsed.getUTCMinutes();
}

function sessionFromKstMinute(minute: number | null): ScanMarketCanonicalSession {
  if (minute === null) return 'UNKNOWN';
  if (minute >= 9 * 60 && minute < 15 * 60 + 30) return 'REGULAR_OPEN';
  if (minute >= 15 * 60 + 30 && minute < 18 * 60) return 'POST_CLOSE';
  return 'CLOSED';
}

function isWeekendKstLabel(value: string | undefined): boolean {
  const raw = String(value ?? '').trim();
  if (!/\d{4}-\d{2}-\d{2}/.test(raw)) return false;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return false;
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * 라벨에서 KRX 거래일 판정용 'YYYY-MM-DD'(KST) date-key 를 추출한다.
 * 본 리졸버의 wall-clock 규약(라벨의 시각을 KST 벽시계로 해석, isWeekendKstLabel 과 동일하게
 * 시프트 없이 UTC 컴포넌트 사용)과 정합되도록 라벨에 박힌 날짜를 그대로 쓴다.
 */
function dateKeyFromLabel(value: string | undefined): string | null {
  const raw = String(value ?? '').trim();
  const ymd = raw.match(/(\d{4}-\d{2}-\d{2})/);
  if (ymd) return ymd[1];
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${d.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 휴장일 SSOT(ADR-0559) 위임 — 자체 휴일셋을 만들지 않고 krxTradingCalendar.isKrxTradingDay
 * (→ krxHolidays SSOT, +ADR-0548 KIS sync) 로 평일+비공휴일을 확인한다. 라벨/asOf 의 날짜를 입력.
 * 거래일 단정 불가(날짜 파싱 실패) 시 false 반환 → 교정 비적용(보수).
 */
function isKrxTradingDayFromLabels(timeLabel: string | undefined, asOf: string | undefined): boolean {
  const key = dateKeyFromLabel(timeLabel) ?? dateKeyFromLabel(asOf);
  if (!key) return false;
  return isKrxTradingDay(key);
}

/**
 * ISO datetime('YYYY-MM-DDThh:mm…') 의 KST 벽시계 분(分)을 정확히 산출한다.
 * 기존 kstMinuteFromLabel 은 loose word-boundary 정규식이 ISO 의 mm:ss 조각(예 '23:45')을
 * 시각으로 오인하는 결함이 있어, 교정 분기는 본 T-anchored 파서로 신뢰 가능한 장중 판정을 한다.
 * (legacy wallClock 변수는 무변경 → 교정 flag OFF 경로 byte-equal 보존.)
 * ISO datetime 이 아니면 null → 호출부가 legacy wallClock 으로 폴백.
 */
function isoKstMinute(value: string | undefined): number | null {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (hour < 0 || hour >= 24 || minute < 0 || minute >= 60) return null;
  return hour * 60 + minute;
}

/**
 * ADR-0567(patch): permissive 방향 wall-clock stale 교정 flag. default OFF → 기존 동작 byte-equal.
 * ON 시에만 평일 장중(wallClock=REGULAR_OPEN + KRX 거래일)에서 상류 macro 의 stale CLOSED/POST_CLOSE
 * canonical 을 REGULAR_OPEN 으로 신뢰 교정한다. 운영자가 shadow 검증 후 ON.
 */
function isWallClockCorrectionEnabled(): boolean {
  return process.env.SCAN_SESSION_WALLCLOCK_CORRECTION_ENABLED === 'true';
}

function displaySessionFor(canonical: ScanMarketCanonicalSession, rawDisplay?: string): string {
  if (canonical === 'REGULAR_OPEN') return rawDisplay && canonicalSessionFromRaw(rawDisplay) === 'REGULAR_OPEN' ? rawDisplay : 'REGULAR_OPEN';
  if (canonical === 'POST_CLOSE') return 'POST_CLOSE_SHADOW_OBSERVE';
  if (canonical === 'CLOSED') return 'CLOSED_SHADOW_OBSERVE';
  if (canonical === 'HOLIDAY') return 'HOLIDAY_SHADOW_OBSERVE';
  return rawDisplay ?? 'UNKNOWN';
}

export function resolveScanMarketSessionView(input: {
  explicitMarketSessionState?: string;
  macroGateState?: MacroGateState;
  asOf?: string;
  timeLabel?: string;
}): ScanMarketSessionView {
  const rawDisplay = input.macroGateState?.displaySession;
  const rawSession = rawDisplay ?? input.macroGateState?.canonicalSession ?? input.explicitMarketSessionState;
  let canonical = canonicalSessionFromRaw(rawSession);
  const wallClock = sessionFromKstMinute(kstMinuteFromLabel(input.timeLabel) ?? kstMinuteFromLabel(input.asOf));
  const weekend = isWeekendKstLabel(input.timeLabel) || isWeekendKstLabel(input.asOf);
  if (weekend) {
    canonical = 'HOLIDAY';
  } else if ((canonical === 'UNKNOWN' || canonical === 'REGULAR_OPEN') && wallClock !== 'UNKNOWN') {
    canonical = wallClock;
  } else if (canonical === 'CLOSED' || canonical === 'POST_CLOSE') {
    // 상류 macro 스냅샷이 CLOSED/POST_CLOSE 세션을 주는 경우 — wall-clock 이 장중이면 stale 충돌이다.
    // 교정 분기는 ISO T-anchored 파서로 신뢰 가능한 장중 분(分)을 재산출한다 (legacy wallClock 무변경).
    const intradayMinute = isoKstMinute(input.timeLabel) ?? isoKstMinute(input.asOf);
    const intradayWallClock = intradayMinute === null ? wallClock : sessionFromKstMinute(intradayMinute);
    if (intradayWallClock === 'REGULAR_OPEN') {
      // CLOSED-vs-wallclock 충돌 — 상류 macro 세션 stale 추적용 진단 로그 (silent 금지).
      const tradingDay = isKrxTradingDayFromLabels(input.timeLabel, input.asOf);
      const correctionEnabled = isWallClockCorrectionEnabled();
      // permissive 교정은 (a) flag ON 이고 (b) KRX 거래일(평일+비공휴일, ADR-0559 SSOT 위임)일 때만.
      // 공휴일(예 2026-06-03 지방선거)은 거래일 SSOT 가 막아 CLOSED/POST_CLOSE 유지 → live false-open 방지.
      if (correctionEnabled && tradingDay) {
        console.warn(
          `[ScanSession] stale macro session=${canonical} corrected to REGULAR_OPEN via wall-clock` +
            ` (KRX trading day, ADR-0567 flag ON); timeLabel=${input.timeLabel ?? ''} asOf=${input.asOf ?? ''}`,
        );
        canonical = 'REGULAR_OPEN';
      } else {
        console.warn(
          `[ScanSession] wall-clock REGULAR_OPEN conflicts with macro session=${canonical}` +
            ` (correction ${correctionEnabled ? 'ON' : 'OFF'}, tradingDay=${tradingDay}); keeping ${canonical}.` +
            ` timeLabel=${input.timeLabel ?? ''} asOf=${input.asOf ?? ''}`,
        );
      }
    }
  }
  const displaySession = displaySessionFor(canonical, rawDisplay);
  const marketSessionState = canonical === 'REGULAR_OPEN'
    ? (input.explicitMarketSessionState ?? 'BUY_ALLOWED')
    : canonical;
  return { marketSessionState, canonicalSession: canonical, displaySession };
}

function buildCanonicalRegimeDiagnostics(
  macro: MacroGateState | undefined,
  requestedEffectiveRegime: string | undefined,
): { effectiveRegime: string; diagnostics: Record<string, unknown> } {
  const rawRegime =
    stringField(macro, 'macroRegimeRaw') ??
    stringField(macro, 'regime') ??
    requestedEffectiveRegime ??
    'UNKNOWN';
  const legacyEffectiveRegime =
    requestedEffectiveRegime ??
    stringField(macro, 'macroRegimeEffective') ??
    stringField(macro, 'regime') ??
    'UNKNOWN';
  const displayRegime =
    stringField(macro, 'displayRegime') ??
    stringField(macro, 'riskOverride') ??
    stringField(macro, 'regime') ??
    legacyEffectiveRegime;
  const riskOverride = stringField(macro, 'riskOverride') ?? displayRegime;
  // 결정 SSOT: staleLegacyR6 ternary 는 staleLegacyR6.ts 에 단일화(gate0 resolveScoringEffectiveRegime 과 공유, drift 방지).
  const { effectiveRegime: canonicalEffectiveRegime, staleLegacyR6 } = resolveStaleLegacyR6({
    legacyEffectiveRegime,
    displayRegime,
    regime: stringField(macro, 'regime'),
    rawRegime,
  });
  return {
    effectiveRegime: canonicalEffectiveRegime,
    diagnostics: {
      rawRegime,
      canonicalEffectiveRegime,
      displayRegime,
      riskOverride,
      ...(staleLegacyR6
        ? {
            legacyEffectiveRegime,
            legacyRegimeDeprecated: true,
            legacyRegimeNotUsedForDecision: true,
          }
        : {}),
    },
  };
}

export function buildScanEvaluationId(asOf: string): string {
  const compact = asOf.replace(/[^0-9]/g, '').slice(0, 14);
  return `scan-eval-${compact || 'unknown'}`;
}

export function buildScanEvaluationResult(
  input: BuildScanEvaluationResultInput,
): ScanEvaluationResult {
  const asOf = input.asOf ?? new Date().toISOString();
  const totalCandidates = finiteCount(input.totalCandidates);
  const macro = input.macroGateState;
  const gateReport = buildGateEvaluationReport(input.counters, totalCandidates);
  const quoteReport = evaluateQuoteHydration(input.counters, totalCandidates);
  const marketSessionState = resolveScanMarketSessionView({
    explicitMarketSessionState: input.marketSessionState,
    macroGateState: macro,
    asOf,
  }).marketSessionState;
  const rawEngineMode = input.engineMode ?? macro?.engineMode ?? 'NORMAL';
  const engineMode = rawEngineMode === 'SELL_ONLY' ? 'NORMAL' : rawEngineMode;
  const regimeView = buildCanonicalRegimeDiagnostics(macro, input.effectiveRegime);
  const effectiveRegime = regimeView.effectiveRegime;
  const classification = classifyScanBlockReason({
    sellOnly: input.sellOnly,
    marketSessionState,
    engineMode,
    effectiveRegime,
    macroGateState: macro,
    totalCandidates,
    volumeClockAllowsEntry: input.volumeClockAllowsEntry,
    gateReport,
    quoteReport,
  });

  return {
    scanId: input.scanId ?? buildScanEvaluationId(asOf),
    asOf,
    evaluationState: classification.evaluationState,
    marketSessionState,
    engineMode,
    effectiveRegime,
    totalCandidates,
    evaluated: gateReport.evaluatedCount,
    skipped: gateReport.skippedCount,
    rejected: gateReport.rejectedCount,
    survivors: gateReport.survivorCount,
    quoteHydrated: quoteReport.hydrated,
    quoteHydrationFailed: quoteReport.failed,
    ...(classification.blockReason ? { blockReason: classification.blockReason } : {}),
    ...(classification.breakPoint ? { breakPoint: classification.breakPoint } : {}),
    sourcePath: input.sourcePath,
    executionImpact: classification.executionImpact,
    shadowLearningAllowed: classification.shadowLearningAllowed,
    diagnostics: {
      ...input.diagnostics,
      ...regimeView.diagnostics,
      gate: gateReport.diagnostics,
      quote: quoteReport.diagnostics,
      ...(classification.unmapped ? { unmappedBlockReason: true } : {}),
    },
  };
}

export function isNotEvaluatedScanState(state: ScanEvaluationState): boolean {
  return state.startsWith('NOT_EVALUATED_');
}

function displaySourcePath(sourcePath: string | undefined): string {
  const raw = sourcePath ?? 'UNKNOWN';
  return raw.includes('SELL_ONLY') ? 'DIAGNOSTIC_SNAPSHOT' : raw;
}

export function formatScanEvaluationCompactLine(result: ScanEvaluationResult | undefined): string | null {
  if (!result) return null;
  const displayState = result.evaluationState === 'NOT_EVALUATED_SELL_ONLY' || result.evaluationState === 'NOT_EVALUATED_R6_LIVE_BLOCKED'
    ? 'EVALUATED_PARTIAL'
    : result.evaluationState;
  const displayBreakPoint = result.breakPoint === 'PRE_FLIGHT_SELL_ONLY' ? 'PRE_FLIGHT' : result.breakPoint;
  const displayReason = result.blockReason === 'SELL_ONLY' || result.blockReason === 'R6_DEFENSE_SELL_ONLY' || result.blockReason === 'R6_DEFENSE'
    ? 'LEGACY_POLICY_IGNORED'
    : result.blockReason;
  const parts = [
    `evaluationState=${displayState}`,
    `sourcePath=${displaySourcePath(result.sourcePath)}`,
    displayBreakPoint ? `breakPoint=${displayBreakPoint}` : undefined,
    displayReason ? `reason=${displayReason}` : undefined,
    `diagnosticGateSurvivors=${result.survivors}`,
    `diagnosticEvaluated=${result.evaluated}`,
    `liveGateSurvivors=${result.survivors}`,
    `liveEvaluated=${result.evaluated}`,
    `skipped=${result.skipped}`,
    `impact=${result.executionImpact}`,
  ].filter((part): part is string => Boolean(part));
  return `ScanEvaluation: ${parts.join(' ')}`;
}

export function formatScanEvaluationSection(result: ScanEvaluationResult | undefined): string | null {
  if (!result) return null;
  const displayState = result.evaluationState === 'NOT_EVALUATED_SELL_ONLY' || result.evaluationState === 'NOT_EVALUATED_R6_LIVE_BLOCKED'
    ? 'EVALUATED_PARTIAL'
    : result.evaluationState;
  const displayBreakPoint = result.breakPoint === 'PRE_FLIGHT_SELL_ONLY' ? 'PRE_FLIGHT' : result.breakPoint;
  const displayReason = result.blockReason === 'SELL_ONLY' || result.blockReason === 'R6_DEFENSE_SELL_ONLY' || result.blockReason === 'R6_DEFENSE'
    ? 'LEGACY_POLICY_IGNORED'
    : result.blockReason;
  const diagnostics = result.diagnostics ?? {};
  const displayRegime = typeof diagnostics.displayRegime === 'string' ? diagnostics.displayRegime : undefined;
  const riskOverride = typeof diagnostics.riskOverride === 'string' ? diagnostics.riskOverride : undefined;
  const legacyEffectiveRegime = typeof diagnostics.legacyEffectiveRegime === 'string' ? diagnostics.legacyEffectiveRegime : undefined;
  const canonicalEffectiveRegime = typeof diagnostics.canonicalEffectiveRegime === 'string'
    ? diagnostics.canonicalEffectiveRegime
    : result.effectiveRegime;
  return [
    'Scan Evaluation State',
    `  evaluationState=${displayState}`,
    `  sourcePath=${displaySourcePath(result.sourcePath)}`,
    `  breakPoint=${displayBreakPoint ?? 'NONE'}`,
    `  blockReason=${displayReason ?? 'NONE'}`,
    `  marketSessionState=${result.marketSessionState}`,
    `  engineMode=${result.engineMode}`,
    `  effectiveRegime=${canonicalEffectiveRegime}`,
    ...(displayRegime ? [`  displayRegime=${displayRegime}`] : []),
    ...(riskOverride ? [`  riskOverride=${riskOverride}`] : []),
    ...(legacyEffectiveRegime
      ? [`  legacyEffectiveRegime=${legacyEffectiveRegime} deprecated=true notUsedForDecision=true`]
      : []),
    '  liveEntryEvaluation=EVALUATED_OR_APPLICABLE',
    `  diagnosticEvaluation=${result.evaluationState.startsWith('NOT_EVALUATED_') ? 'PARTIAL' : 'EVALUATED_DIAGNOSTIC'}`,
    '  Gate Evaluation Counts:',
    `    total=${result.totalCandidates}`,
    `    diagnosticEvaluated=${result.evaluated}`,
    `    skipped=${result.skipped}`,
    `    rejected=${result.rejected}`,
    `    diagnosticGateSurvivors=${result.survivors}`,
    `    liveEvaluated=${result.evaluated}`,
    `    liveGateSurvivors=${result.survivors}`,
    `  quote hydrated=${result.quoteHydrated} failed=${result.quoteHydrationFailed}`,
    `  executionImpact=${result.executionImpact}`,
    `  shadowLearningAllowed=${result.shadowLearningAllowed}`,
    `  scanId=${result.scanId}`,
    `  asOf=${result.asOf}`,
  ].join('\n');
}
