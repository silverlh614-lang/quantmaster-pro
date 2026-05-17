// @responsibility counterfactualShadow 학습 엔진 모듈
/**
 * counterfactualShadow.ts — Idea 4: Counterfactual Shadow Ledger.
 *
 * 신호 스캔에서 Gate 기준에 미달하여 탈락한 후보 상위 N 개를 매일 "가상 진입" 으로
 * 기록하고, 30·60·90 일 후 수익률 분포를 추적한다. 목적:
 *   - Gate 기준의 통계적 유의성 검증 (생존 편향 제거)
 *   - "통과 vs 탈락" 수익률 분포 차이가 유의하지 않다면 Gate 가 과잉이라는 증거
 *
 * 데이터 구조 (JSON, 최근 1000건 ring):
 *   CounterfactualEntry {
 *     id, stockCode, stockName, signalDate (YYYY-MM-DD),
 *     priceAtSignal, gateScore, regime, conditionKeys,
 *     skipReason,         // 왜 탈락했는가 (SKIP / GATE_UNDER / SECTOR_FULL 등)
 *     return30d/60d/90d,  // Pipe(resolveCounterfactuals) 가 나중에 채움
 *     resolvedAt,
 *   }
 *
 * 본 모듈은 "기록 + 해상도" API만 제공. Gate 를 실제 바꾸지 않는다 (분석용 관측).
 */

import fs from 'fs';
import { COUNTERFACTUAL_FILE, ensureDataDir } from '../persistence/paths.js';
import { sendSuggestAlert } from './suggestNotifier.js';
import { safePctChange } from '../utils/safePctChange.js';
import { shouldSuppressNoise, recordNoiseSuppressed } from '../utils/logger.js';
import type { RegimePhase } from '../shadow/regimeContext.js';
import type { RegimeRecoveryConfidence, RegimeRecoverySource } from './learningTypes.js';
import {
  SUGGEST_MIN_SAMPLE_COUNTERFACTUAL,
  SUGGEST_COUNTERFACTUAL_RATIO_THRESHOLD,
} from './suggestThresholds.js';

export interface CounterfactualEntry {
  id: string;
  stockCode: string;
  stockName: string;
  signalDate: string;          // YYYY-MM-DD (KST)
  signalTime: string;          // ISO
  priceAtSignal: number;
  gateScore: number;
  regime: string;
  rawRegime?: string;
  effectiveRegime?: string;
  regimePhase?: RegimePhase;
  originalRegimePhase?: RegimePhase;
  regimeAtSignal?: RegimePhase | string;
  regimeAtEntry?: RegimePhase | string;
  regimeAtExit?: RegimePhase | string;
  regimeAtOutcome?: RegimePhase | string;
  r6Trigger?: string;
  engineMode?: string;
  marketSession?: string;
  sellOnlyActive?: boolean;
  hardBlockActive?: boolean;
  sourceFreshness?: string;
  regimeConfidence?: string;
  regimeRecovered?: boolean;
  regimeRecoverySource?: RegimeRecoverySource;
  regimeRecoveryConfidence?: RegimeRecoveryConfidence;
  regimeRecoveredAt?: string;
  conditionKeys: string[];
  skipReason: string;
  /** 30 거래일 후 수익률 (%) — resolveCounterfactuals 가 채움 */
  return30d?: number;
  /** 60 거래일 */
  return60d?: number;
  /** 90 거래일 */
  return90d?: number;
  resolvedAt?: string;
  /** Counterfactual Truth v1 idempotency key: sourceCandidateId+symbol+tradingDate+blockedReason+hypotheticalSide+strategyId. */
  counterfactualKey?: string;
  sourceCandidateId?: string;
  symbol?: string;
  tradingDate?: string;
  blockedReason?: string;
  hypotheticalSide?: 'BUY' | 'SELL';
  strategyId?: string;
  hypotheticalEntryPrice?: number;
  hypotheticalTargetPrice?: number;
  hypotheticalStopPrice?: number;
  maxHoldingMinutes?: number;
  riskRuleId?: string;
  atr?: number;
  volatility?: number;
  maturityAt?: string;
  maturityStatus?: 'MATURED' | 'WAITING_FOR_HOLDING_PERIOD' | 'OVERDUE' | 'INVALID_CREATED_AT' | 'INVALID_MAX_HOLDING';
  currentAgeMinutes?: number;
  remainingMinutesToMaturity?: number;
  pricePath?: Array<{ at?: string; timestamp?: string; price?: number; high?: number; low?: number; close?: number }>;
  outcomeLabel?: 'MISSED_WIN' | 'AVOIDED_LOSS' | 'GOOD_BLOCK' | 'BAD_BLOCK' | 'NEUTRAL_BLOCK' | 'DATA_INSUFFICIENT' | 'QUARANTINED' | 'PENDING_OUTCOME';
  outcomeStatus?: 'PENDING' | 'LABELED' | 'DATA_INSUFFICIENT' | 'QUARANTINED' | 'EXPIRED' | 'UNRESOLVED';
  outcomeResolvedAt?: string;
  targetStopRecovered?: boolean;
  recoverySource?: 'ORIGINAL_SIGNAL_SNAPSHOT' | 'STRATEGY_RISK_RULE' | 'ATR_FALLBACK' | 'DEFAULT_R_MULTIPLE_FALLBACK';
  recoveryConfidence?: 'RECOVERED' | 'MEDIUM' | 'RECOVERED_LOW';
  recoveredAt?: string;
  recoveryRuleId?: string;
  recoveryNote?: string;
  sourceConfidence?: 'RECOVERED' | 'MEDIUM' | 'RECOVERED_LOW';
  labelSource?: 'RECOVERED_TARGET_STOP';
  diagnosticOnly?: boolean;
  promotionEligible?: boolean;
  autoApply?: false;
  duplicateSuppressedAt?: string;
  duplicateSuppressedCount?: number;
}

export function buildCounterfactualKey(params: {
  sourceCandidateId?: string;
  symbol?: string;
  stockCode?: string;
  tradingDate?: string;
  signalDate?: string;
  blockedReason?: string;
  skipReason?: string;
  hypotheticalSide?: string;
  strategyId?: string;
}): string {
  const symbol = String(params.symbol ?? params.stockCode ?? 'UNKNOWN');
  const tradingDate = String(params.tradingDate ?? params.signalDate ?? 'UNKNOWN_DATE').slice(0, 10);
  return [
    params.sourceCandidateId ?? `${symbol}:${tradingDate}`,
    symbol,
    tradingDate,
    params.blockedReason ?? params.skipReason ?? 'BLOCKED',
    params.hypotheticalSide ?? 'BUY',
    params.strategyId ?? 'default',
  ].map((v) => String(v).replace(/\s+/g, '_')).join('|');
}

const MAX_RECORDS = 1000;
/** 일별 후보 최대 추적 수 (signalScanner 호출 측이 상위 N개로 제한). */
export const COUNTERFACTUAL_DAILY_CAP = Number(process.env.COUNTERFACTUAL_DAILY_CAP ?? '5');

function load(): CounterfactualEntry[] {
  ensureDataDir();
  if (!fs.existsSync(COUNTERFACTUAL_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(COUNTERFACTUAL_FILE, 'utf-8')) as CounterfactualEntry[];
  } catch {
    return [];
  }
}

export function saveCounterfactuals(entries: CounterfactualEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(
    COUNTERFACTUAL_FILE,
    JSON.stringify(entries.slice(-MAX_RECORDS), null, 2),
  );
}

export function loadCounterfactuals(): CounterfactualEntry[] {
  return load();
}

/**
 * 신규 탈락 후보를 기록. 동일 counterfactualKey 중복은 upsert/suppress 한다 (멱등).
 * signalDate 는 ISO 날짜 부분(YYYY-MM-DD) 으로 정규화.
 */
export function recordCounterfactualCase(params: {
  stockCode: string;
  stockName: string;
  priceAtSignal: number;
  gateScore: number;
  regime: string;
  conditionKeys: string[];
  skipReason: string;
  now?: Date;
  sourceCandidateId?: string;
  blockedReason?: string;
  hypotheticalSide?: 'BUY' | 'SELL';
  strategyId?: string;
  hypotheticalTargetPrice?: number;
  hypotheticalStopPrice?: number;
  maxHoldingMinutes?: number;
}): { entry: CounterfactualEntry | null; created: boolean; duplicateSuppressed: boolean; existingCaseId?: string; attemptedKey?: string } {
  if (!Number.isFinite(params.priceAtSignal) || params.priceAtSignal <= 0) return { entry: null, created: false, duplicateSuppressed: false };
  const now = params.now ?? new Date();
  const signalDate = now.toISOString().slice(0, 10);
  const blockedReason = params.blockedReason ?? params.skipReason;
  const sourceCandidateId = params.sourceCandidateId ?? `${params.stockCode}:${signalDate}:${blockedReason}`;
  const counterfactualKey = buildCounterfactualKey({ sourceCandidateId, stockCode: params.stockCode, tradingDate: signalDate, blockedReason, hypotheticalSide: params.hypotheticalSide ?? 'BUY', strategyId: params.strategyId ?? 'default' });
  const entries = load();
  const existing = entries.find((e) => (e.counterfactualKey ?? buildCounterfactualKey({ sourceCandidateId: e.sourceCandidateId ?? `${e.stockCode}:${e.signalDate}:${e.blockedReason ?? e.skipReason}`, stockCode: e.stockCode, tradingDate: e.signalDate, blockedReason: e.blockedReason ?? e.skipReason, hypotheticalSide: e.hypotheticalSide ?? 'BUY', strategyId: e.strategyId ?? 'default' })) === counterfactualKey);
  if (existing) {
    existing.counterfactualKey = counterfactualKey;
    existing.sourceCandidateId = sourceCandidateId;
    existing.symbol = existing.symbol ?? params.stockCode;
    existing.tradingDate = existing.tradingDate ?? signalDate;
    existing.blockedReason = blockedReason;
    existing.hypotheticalSide = params.hypotheticalSide ?? existing.hypotheticalSide ?? 'BUY';
    existing.strategyId = params.strategyId ?? existing.strategyId ?? 'default';
    existing.hypotheticalEntryPrice = params.priceAtSignal;
    existing.hypotheticalTargetPrice = params.hypotheticalTargetPrice ?? existing.hypotheticalTargetPrice;
    existing.hypotheticalStopPrice = params.hypotheticalStopPrice ?? existing.hypotheticalStopPrice;
    existing.maxHoldingMinutes = params.maxHoldingMinutes ?? existing.maxHoldingMinutes;
    existing.duplicateSuppressedAt = now.toISOString();
    existing.duplicateSuppressedCount = (existing.duplicateSuppressedCount ?? 0) + 1;
    saveCounterfactuals(entries);
    // Patch-009 P2 — counterfactual 중복 억제는 멱등 upsert 의 정상 동작일 뿐이라
    // default LOG_LEVEL=info 에서는 종목 수만큼 multi-line JSON 으로 누적된다.
    // duplicateSuppressedCount 는 entry 에 이미 영속되므로 로그는 중앙 logger
    // 게이트로 억제하고 LOG_LEVEL=debug 또는 LOG_SUPPRESS_COUNTERFACTUAL_DUPLICATE=false
    // 시에만 노출. 억제 시 NoiseSummary 카운터에 집계.
    if (shouldSuppressNoise('COUNTERFACTUAL_DUPLICATE_SUPPRESSED')) {
      recordNoiseSuppressed('COUNTERFACTUAL_DUPLICATE_SUPPRESSED');
    } else {
      console.info('COUNTERFACTUAL_DUPLICATE_SUPPRESSED', { existingCaseId: existing.id, attemptedKey: counterfactualKey });
    }
    return { entry: existing, created: false, duplicateSuppressed: true, existingCaseId: existing.id, attemptedKey: counterfactualKey };
  }

  const entry: CounterfactualEntry = {
    id: `cf_${Date.now()}_${params.stockCode}`,
    stockCode: params.stockCode,
    stockName: params.stockName,
    signalDate,
    signalTime: now.toISOString(),
    priceAtSignal: params.priceAtSignal,
    gateScore: params.gateScore,
    regime: params.regime,
    conditionKeys: params.conditionKeys,
    skipReason: params.skipReason,
    counterfactualKey,
    sourceCandidateId,
    symbol: params.stockCode,
    tradingDate: signalDate,
    blockedReason,
    hypotheticalSide: params.hypotheticalSide ?? 'BUY',
    strategyId: params.strategyId ?? 'default',
    hypotheticalEntryPrice: params.priceAtSignal,
    hypotheticalTargetPrice: params.hypotheticalTargetPrice,
    hypotheticalStopPrice: params.hypotheticalStopPrice,
    maxHoldingMinutes: params.maxHoldingMinutes,
    outcomeStatus: 'PENDING',
  };
  entries.push(entry);
  saveCounterfactuals(entries);
  return { entry, created: true, duplicateSuppressed: false };
}

/**
 * 신규 탈락 후보를 기록. 동일 counterfactualKey 중복은 스킵 (멱등).
 * signalDate 는 ISO 날짜 부분(YYYY-MM-DD) 으로 정규화.
 */
export function recordCounterfactual(params: Parameters<typeof recordCounterfactualCase>[0]): CounterfactualEntry | null {
  const result = recordCounterfactualCase(params);
  return result.created ? result.entry : null;
}
/**
 * 아직 resolved 가 아닌 엔트리 중, signalDate 로부터 N 영업일 경과한 것을 찾아
 * 현재가로 수익률을 계산해 기록한다. 호출자는 현재가 fetcher (주로 fetchCurrentPrice) 를 주입.
 *
 * @param fetchPrice (code: string) => Promise<number|null>
 * @returns 해상된 엔트리 수
 */
export async function resolveCounterfactuals(
  fetchPrice: (stockCode: string) => Promise<number | null>,
  now: Date = new Date(),
): Promise<{ resolved30d: number; resolved60d: number; resolved90d: number }> {
  const entries = load();
  let r30 = 0, r60 = 0, r90 = 0;

  for (const e of entries) {
    const signalMs = new Date(e.signalTime).getTime();
    const elapsedDays = Math.floor((now.getTime() - signalMs) / (24 * 3600 * 1000));
    // 영업일 근사 — 주말 포함 캘린더일로 처리 (후속 리소스: 영업일 캐시 사용 가능)
    if (elapsedDays < 30) continue;

    const currentPrice = await fetchPrice(e.stockCode).catch(() => null);
    if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) continue;

    // ADR-0059: stale currentPrice 시 0 fallback — counterfactual 학습 영속 입력 보호.
    const ret = safePctChange(currentPrice, e.priceAtSignal, {
      label: `counterfactual:${e.stockCode}`,
    }) ?? 0;

    if (elapsedDays >= 30 && e.return30d === undefined) { e.return30d = ret; r30++; }
    if (elapsedDays >= 60 && e.return60d === undefined) { e.return60d = ret; r60++; }
    if (elapsedDays >= 90 && e.return90d === undefined) { e.return90d = ret; r90++; e.resolvedAt = now.toISOString(); }
  }

  saveCounterfactuals(entries);
  return { resolved30d: r30, resolved60d: r60, resolved90d: r90 };
}

export interface CounterfactualStats {
  samples: number;
  mean: number;
  median: number;
  stdDev: number;
  winRate: number;         // returns > 0 ratio
  p25: number; p75: number;
}

/** 특정 horizon 의 수익률 분포 통계. horizon: 30 | 60 | 90 */
export function getCounterfactualStats(horizon: 30 | 60 | 90): CounterfactualStats | null {
  const entries = load();
  const key = `return${horizon}d` as 'return30d' | 'return60d' | 'return90d';
  const returns = entries
    .map(e => e[key])
    .filter((r): r is number => typeof r === 'number' && Number.isFinite(r));
  if (returns.length === 0) return null;

  const sorted = [...returns].sort((a, b) => a - b);
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const variance = returns.reduce((s, x) => s + (x - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const winRate = returns.filter(r => r > 0).length / returns.length;
  const p25 = sorted[Math.floor(sorted.length * 0.25)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];

  return { samples: returns.length, mean, median, stdDev, winRate, p25, p75 };
}

// ── ADR-0182 — Phase 4-B-2-b3 Unresolved Counterfactuals stats SSOT ─────

/**
 * Counterfactual 학습 영속의 *해결 진행도* 진단 통계.
 *
 * `getCounterfactualStats(horizon)` 가 *분포 분석* 이라면, 본 함수는
 * *학습 입력 누락 진단* — 운영자가 cron 미실행 / 가격 fetcher 실패 /
 * 표본 부족 즉시 인지 (사이드바 Learning Sanity Dashboard 6번째 카드).
 *
 * **resolved**: `return{30,60,90}d` 채워진 entry 수.
 * **pending**: signalDate 로부터 N 영업일 경과 + `return{30,60,90}d` 부재.
 *   resolveCounterfactuals 가 *calendar day* 로 elapsed 산정 (line 133)
 *   하므로 본 함수도 동일 기준 (정합성). KRX 휴장일 미반영 — 후속 PR.
 * **awaitingHorizonCount**: signalDate 30 영업일 미경과 (정상 대기).
 * **oldestSignalDate**: 최오래된 signalDate (KST). 영속 누적 진행도 추적.
 *
 * 본 함수는 read-only — 영속 변경 0건. ADR-0182 §3 안전 invariant 정합.
 */
export interface CounterfactualUnresolvedSummary {
  totalCount: number;
  resolved30dCount: number;
  resolved60dCount: number;
  resolved90dCount: number;
  pending30dCount: number;
  pending60dCount: number;
  pending90dCount: number;
  awaitingHorizonCount: number;
  oldestSignalDate?: string;
}

export function summarizeUnresolvedCounterfactuals(
  now: Date = new Date(),
): CounterfactualUnresolvedSummary {
  const entries = load();
  const totalCount = entries.length;

  let resolved30dCount = 0;
  let resolved60dCount = 0;
  let resolved90dCount = 0;
  let pending30dCount = 0;
  let pending60dCount = 0;
  let pending90dCount = 0;
  let awaitingHorizonCount = 0;
  let oldestSignalDate: string | undefined;

  for (const e of entries) {
    if (oldestSignalDate === undefined || e.signalDate < oldestSignalDate) {
      oldestSignalDate = e.signalDate;
    }

    const signalMs = new Date(e.signalTime).getTime();
    const elapsedDays = Number.isFinite(signalMs)
      ? Math.floor((now.getTime() - signalMs) / (24 * 3600 * 1000))
      : 0;

    // 30 영업일 미경과 — 정상 대기 (resolved 못 채워졌어도 시간 부족만)
    if (elapsedDays < 30) {
      awaitingHorizonCount++;
      continue;
    }

    // 30+ 일 — 해결 또는 미해결 분기
    if (typeof e.return30d === 'number' && Number.isFinite(e.return30d)) {
      resolved30dCount++;
    } else {
      pending30dCount++;
    }
    if (elapsedDays >= 60) {
      if (typeof e.return60d === 'number' && Number.isFinite(e.return60d)) {
        resolved60dCount++;
      } else {
        pending60dCount++;
      }
    }
    if (elapsedDays >= 90) {
      if (typeof e.return90d === 'number' && Number.isFinite(e.return90d)) {
        resolved90dCount++;
      } else {
        pending90dCount++;
      }
    }
  }

  return {
    totalCount,
    resolved30dCount,
    resolved60dCount,
    resolved90dCount,
    pending30dCount,
    pending60dCount,
    pending90dCount,
    awaitingHorizonCount,
    oldestSignalDate,
  };
}

/**
 * Suggest 판정 — resolved (return30d) 30건 이상이고, 탈락 후보(gateScore<7)의 평균 수익률이
 * 통과 후보(gateScore≥7) 평균의 80% 이상이면 Gate 기준 과잉 의심으로 suggest 를 발동한다.
 *
 * gateScore 가 없는 레코드는 skipReason 을 보조 지표로 사용하지 않고 — 현 구현은 gateScore
 * 필드를 기본값으로 사용한다 (recordCounterfactual 은 항상 gateScore 를 채움).
 *
 * 조건 미달 시 no-op + false. 예외는 warn 로그만 남기고 false 반환 — 스케줄러 전체 중단 방지.
 */
export async function evaluateCounterfactualSuggestion(now: Date = new Date()): Promise<boolean> {
  try {
    const entries = loadCounterfactuals();
    const resolved = entries.filter(e => typeof e.return30d === 'number' && Number.isFinite(e.return30d));
    if (resolved.length < SUGGEST_MIN_SAMPLE_COUNTERFACTUAL) return false;

    // 통과(pass) vs 탈락(skip) 이분 — gateScore ≥ 7 이면 통과 근접 (STRONG_BUY/BUY cutoff).
    const passed = resolved.filter(e => e.gateScore >= 7);
    const skipped = resolved.filter(e => e.gateScore < 7);
    if (passed.length === 0 || skipped.length === 0) return false;

    const meanPass  = passed.reduce((s, e) => s + (e.return30d as number), 0) / passed.length;
    const meanSkip  = skipped.reduce((s, e) => s + (e.return30d as number), 0) / skipped.length;

    // 양쪽 모두 양수일 때만 비율 판정 (둘 다 음수일 때 ratio 의미 없음).
    if (meanPass <= 0) return false;
    const ratio = meanSkip / meanPass;
    if (ratio < SUGGEST_COUNTERFACTUAL_RATIO_THRESHOLD) return false;

    const day = now.toISOString().slice(0, 10);
    return await sendSuggestAlert({
      moduleKey: 'counterfactual',
      signature: `counterfactual-${day}`,
      title: '탈락 후보 Gate 기준 과잉 의심',
      rationale:
        `resolved ${resolved.length}건 · 통과 평균 ${meanPass.toFixed(2)}% / ` +
        `탈락 평균 ${meanSkip.toFixed(2)}% (ratio ${ratio.toFixed(2)})`,
      currentValue: 'Gate Score ≥ 7 통과',
      suggestedValue: 'Gate 기준 완화 또는 컨디션 가중치 재검토',
      threshold:
        `샘플≥${SUGGEST_MIN_SAMPLE_COUNTERFACTUAL} & ratio≥${SUGGEST_COUNTERFACTUAL_RATIO_THRESHOLD}`,
    });
  } catch (e) {
    console.warn(
      '[counterfactualShadow] evaluateSuggestion 실패:',
      e instanceof Error ? e.message : String(e),
    );
    return false;
  }
}
