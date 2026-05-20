/**
 * @responsibility SHADOW 졸업 진행률 브리핑 — trade 샘플 수 + fill 실현 이벤트 동시 표시
 *
 * 목적: 60일 Shadow 모니터링 기간 동안 "얼마나 남았는지" 를 매일 눈으로 확인
 * 가능하게 하여, 지루함으로 인해 운용자가 시스템을 건드리는 것을 방지한다.
 *
 * 두 기능:
 *   1. computeShadowProgress() — 현재 상태 스냅샷 (WIN/LOSS/ACTIVE + ETA).
 *   2. detectSampleStall()    — 최근 7일간 신규 Shadow 증가 0건이면 경보 대상 판정.
 *
 * 호출자: scheduler/reportJobs.ts 가 cron 으로 invoke.
 */

import { loadShadowTrades, aggregateFillStats, type ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';
import { emitTelegramEvent } from './telegramEventRouter.js';
import type { DisplayMetric } from './displayMetric.js';
import { classifyTradeLifecycleOutcome } from '../trading/exitOutcomeClassifier.js';
import { resolveCanonicalTradeOutcomeFromShadowTrade } from '../trading/canonicalTradeOutcomeResolver.js';

// ── 설정 ──────────────────────────────────────────────────────────────────────

/** 월말 캘리브레이션 1회 트리거 목표 표본 수 */
export const SHADOW_SAMPLE_TARGET = 30;

/** 전체 모니터링 기간(일) — 첫 표본 생성일 기준 잔여 산출에 사용 */
export const SHADOW_MONITORING_DAYS = 60;

/** 표본 정체 판정 윈도우(일) — 이 기간 내 신규 Shadow=0 이면 stall */
export const SAMPLE_STALL_DAYS = 7;

// ── 내부 유틸 ────────────────────────────────────────────────────────────────

function kstDateStr(d: Date = new Date()): string {
  return new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function addDaysKst(baseIso: string, days: number): string {
  const base = new Date(baseIso);
  base.setDate(base.getDate() + days);
  return kstDateStr(base);
}

/**
 * ADR-0129: trade 단위 BE 분리 SSOT.
 * `exitOutcome === 'BE'` 인 trade 는 LOSS 로 카운트 안 함 — 사용자 4/30 보고
 * "WIN 2/LOSS 8" 중 일부는 PROFIT_PROTECTION (BE) 청산. ADR-0123 학습 격리 정합.
 *
 * BE_CLASSIFICATION_DISABLED=true ENV 시 자동 fallback (legacy 동작).
 */
function classifyTradeOutcome(shadows: ServerShadowTrade[]): {
  beCount: number;
  winCount: number;
  lossCount: number;
  fullWinCount: number;
  partialWinCount: number;
  winBreakevenCount: number;
} {
  const beDisabled = process.env.BE_CLASSIFICATION_DISABLED === 'true';
  const closed = shadows.filter((s) => s.status === 'HIT_TARGET' || s.status === 'HIT_STOP');
  if (beDisabled) {
    return {
      beCount: 0,
      winCount: closed.filter(s => s.status === 'HIT_TARGET').length,
      lossCount: closed.filter(s => s.status === 'HIT_STOP').length,
      fullWinCount: closed.filter(s => s.status === 'HIT_TARGET').length,
      partialWinCount: 0,
      winBreakevenCount: 0,
    };
  }
  const canonicalReady = closed.filter((trade) => (trade.fills?.length ?? 0) > 0 || typeof trade.returnPct === 'number');
  const legacyOnly = closed.filter((trade) => !canonicalReady.includes(trade));
  const canonical = canonicalReady.map((trade) => resolveCanonicalTradeOutcomeFromShadowTrade(trade));
  const classified = legacyOnly.map((trade) => classifyTradeLifecycleOutcome(trade));
  const fullWinCount = classified.filter((c) => c.tradeLifecycleOutcome === 'FULL_WIN').length
    + canonical.filter((c) => c.winRateBucket === 'WIN_FULL').length;
  const partialWinCount = classified.filter((c) => c.tradeLifecycleOutcome === 'PARTIAL_WIN' || c.tradeLifecycleOutcome === 'SMALL_WIN').length
    + canonical.filter((c) => c.outcome === 'PARTIAL_WIN' || c.outcome === 'FORCED_EXIT_WIN').length;
  const winBreakevenCount = classified.filter((c) => c.tradeLifecycleOutcome === 'WIN_BREAKEVEN').length
    + canonical.filter((c) => c.outcome === 'PARTIAL_WIN_BREAKEVEN').length;
  const beCount = classified.filter((c) => c.tradeLifecycleOutcome === 'BREAKEVEN').length
    + canonical.filter((c) => c.winRateBucket === 'BREAKEVEN').length;
  const lossCount = classified.filter((c) => (
    c.tradeLifecycleOutcome === 'SMALL_LOSS'
    || c.tradeLifecycleOutcome === 'FULL_LOSS'
    || c.tradeLifecycleOutcome === 'FORCED_EXIT'
  )).length
    + canonical.filter((c) => c.winRateBucket === 'LOSS').length;
  return {
    beCount,
    winCount: fullWinCount + partialWinCount + winBreakevenCount,
    lossCount,
    fullWinCount,
    partialWinCount,
    winBreakevenCount,
  };
}

export { classifyTradeOutcome as _classifyTradeOutcomeForTests };

// ── 공개 API: 진행 현황 ──────────────────────────────────────────────────────

export interface ShadowProgress {
  dayElapsed: number;      // 첫 샘플 생성 후 경과일 (0 = 당일)
  totalDays:  number;      // SHADOW_MONITORING_DAYS
  /** 전량 청산된 trade 단위 WIN 수 (graduation 샘플 기준, ADR-0129: BE 제외) */
  winCount:   number;
  fullWinCount?: number;
  partialWinCount?: number;
  winBreakevenCount?: number;
  /** 전량 청산된 trade 단위 LOSS 수 (ADR-0129: BE 제외) */
  lossCount:  number;
  /**
   * ADR-0129: 전량 청산된 trade 단위 BE 수.
   * `(s.status === 'HIT_TARGET' || 'HIT_STOP') && s.exitOutcome === 'BE'`
   * 옵셔널 — 기존 호출자 무영향. BE_CLASSIFICATION_DISABLED=true 시 0 (legacy).
   */
  beCount?:   number;
  activeCount: number;
  /** WIN + LOSS 만 (BE 제외) — 승률 분모 정합 (ADR-0129). */
  totalClosed: number;
  totalSamples: number;
  targetSamples: number;   // SHADOW_SAMPLE_TARGET
  winRatePct:  number;
  newToday:    number;     // 오늘 생성된 신규 신호 수
  etaDate:     string;     // YYYY-MM-DD — 현재 속도로 30건 도달 예상일 (또는 '미정')
  etaDaysRemain: number;   // ETA 까지 잔여 일수 (미정 시 -1)
  /** PR-18: fill SSOT — 전체 기간 실현 이벤트(부분매도 포함) */
  fillWins:    number;
  fillLosses:  number;
  /**
   * ADR-0124: 본절 fill 수 (-0.5 ≤ pnlPct ≤ +0.5, ADR-0112 정합).
   * 옵셔널 — 기존 호출자 무영향. BE_CLASSIFICATION_DISABLED=true 시 0.
   */
  fillBeFills?: number;
  fillWeightedReturnPct: number;
  fillRealizedKrw: number;
  partialOnlyCount: number;
}

export function computeShadowProgress(now: Date = new Date()): ShadowProgress {
  const todayKst = kstDateStr(now);
  const shadows = loadShadowTrades();

  // ADR-0129: BE 분리 SSOT — trade 단위 BE 카운터.
  const { beCount, winCount, lossCount, fullWinCount, partialWinCount, winBreakevenCount } = classifyTradeOutcome(shadows);
  const activeCount = shadows.filter(s => isOpenShadowStatus(s.status)).length;
  const totalSamples = shadows.length;
  // 승률 분모는 WIN + LOSS 만 (BE 제외).
  const totalClosed  = winCount + lossCount;
  const winRatePct   = totalClosed > 0 ? (winCount / totalClosed) * 100 : 0;

  const newToday = shadows.filter(s => s.signalTime.slice(0, 10) === todayKst).length;

  // 첫 샘플 생성일 기준 경과일
  let dayElapsed = 0;
  if (shadows.length > 0) {
    const firstIso = shadows
      .map(s => s.signalTime)
      .sort()[0];
    dayElapsed = daysBetween(firstIso, now.toISOString()) + 1;
  }

  // ETA — 최근 7일 rolling velocity (건/일) 로 잔여 표본 도달일 추산
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const recent7 = shadows.filter(s => s.signalTime >= sevenDaysAgo).length;
  const velocityPerDay = recent7 / 7;
  const remaining = Math.max(0, SHADOW_SAMPLE_TARGET - totalSamples);
  let etaDate = '미정';
  let etaDaysRemain = -1;
  if (remaining === 0) {
    etaDate = todayKst;
    etaDaysRemain = 0;
  } else if (velocityPerDay > 0) {
    etaDaysRemain = Math.ceil(remaining / velocityPerDay);
    etaDate = addDaysKst(now.toISOString(), etaDaysRemain);
  }

  // PR-18: fill SSOT — 전체 기간 실현 이벤트 집계 (부분매도 포함).
  const fillAgg = aggregateFillStats(shadows);

  return {
    dayElapsed,
    totalDays: SHADOW_MONITORING_DAYS,
    winCount, lossCount, beCount, fullWinCount, partialWinCount, winBreakevenCount, activeCount,
    totalClosed, totalSamples,
    targetSamples: SHADOW_SAMPLE_TARGET,
    winRatePct,
    newToday, etaDate, etaDaysRemain,
    fillWins: fillAgg.winFills,
    fillLosses: fillAgg.lossFills,
    fillBeFills: fillAgg.beFills,
    fillWeightedReturnPct: fillAgg.weightedReturnPct,
    fillRealizedKrw: fillAgg.totalRealizedKrw,
    partialOnlyCount: fillAgg.partialOnlyCount,
  };
}

export function formatShadowProgress(p: ShadowProgress): string {
  const closedWinRateMetric: DisplayMetric = {
    label: '종료 샘플 승률',
    value: `${p.winRatePct.toFixed(1)}%`,
    numerator: p.winCount,
    denominator: p.totalClosed,
    denominatorLabel: 'closed_samples',
    note: 'ACTIVE는 종료 샘플 승률 분모에서 제외됩니다.',
  };
  const allSamplesMetric: DisplayMetric = {
    label: '전체 샘플',
    value: `${p.totalSamples}/${p.targetSamples}`,
    numerator: p.totalSamples,
    denominator: p.targetSamples,
    denominatorLabel: 'all_shadow_samples',
  };
  const beFills = p.fillBeFills ?? 0;
  const hasFillRealizations = (p.fillWins + p.fillLosses + beFills) > 0;
  const fillSummaryLine = hasFillRealizations
    ? `${p.fillWins}익 / ${p.fillLosses}손` +
      (beFills > 0 ? ` / ${beFills}본절` : '') +
      (p.partialOnlyCount > 0 ? ` · 부분매도만 ${p.partialOnlyCount}건` : '')
    : '';
  const fillPnlLine = hasFillRealizations
    ? `가중 P&L ${p.fillWeightedReturnPct >= 0 ? '+' : ''}${p.fillWeightedReturnPct.toFixed(2)}%`
    : '';
  // ADR-0129: trade 단위 BE 라인 — beCount > 0 시에만 노출 (BE_CLASSIFICATION_DISABLED 자연 호환).
  const beTradeCount = p.beCount ?? 0;
  const beTradeLine = beTradeCount > 0 ? `⚪ 종료 본절: ${beTradeCount}건` : '';
  const winBreakevenLine = (p.winBreakevenCount ?? 0) > 0 ? `✅ PARTIAL_WIN_BREAKEVEN: ${p.winBreakevenCount}건 (legacy WIN_BREAKEVEN, TP1 후 본절, LOSS 아님)` : '';
  return [
    `📊 <b>[SHADOW 진행률 Day ${p.dayElapsed}/${p.totalDays}]</b>`,
    `신규 신호: ${p.newToday}건 | 📊 ${allSamplesMetric.label}: ${allSamplesMetric.value}`,
    ``,
    `✅ ${closedWinRateMetric.label}: ${closedWinRateMetric.value} = ${p.winCount}승 / ${p.totalClosed}종료`,
    `❌ 종료 손실: ${p.lossCount}건`,
    winBreakevenLine,
    beTradeLine,
    `⏳ 진행 중: ${p.activeCount}건`,
    hasFillRealizations ? `` : '',
    hasFillRealizations ? `🎯 Fill 기준 실현:` : '',
    fillSummaryLine,
    fillPnlLine,
    ``,
    p.etaDaysRemain >= 0
      ? `예상 완주: ${p.etaDate} (D-${p.etaDaysRemain})`
      : `예상 완주: 미정 (최근 7일 신규 0건)`,
    `⚠️ SHADOW 모드 — 실계좌 잔고 아님`,
    ``,
    `※ ${closedWinRateMetric.note}`,
    `※ Fill 기준 실현은 sample 승률과 다른 단위입니다.`,
  ].filter(line => line !== '').join('\n');
}

export async function sendDailyShadowProgress(): Promise<void> {
  const progress = computeShadowProgress();
  const message = formatShadowProgress(progress);
  await emitTelegramEvent({
    type: 'SHADOW_SUMMARY',
    message,
    severity: 'NORMAL',
    dedupeKey: `shadow-progress-${kstDateStr()}`,
    metadata: { scope: 'daily_shadow_progress' },
  }).catch(console.error);
}

// ── Phase 2.2: Sample Velocity Stall Tracker ─────────────────────────────────

export interface SampleStallResult {
  stalled: boolean;
  reason:  string;
  sampleCount7d: number;
  targetVelocity: number;
  currentVelocity: number;
}

/**
 * 최근 7일간 신규 Shadow 가 0건이면 "조용한 고장" 가능성 경보.
 *
 * 원인은 4가지 — 이 함수는 자동 판정하지 않고 Telegram 메시지에 체크리스트만
 * 나열한다. 운용자가 어느 원인인지 확인하도록 유도하는 것이 목적.
 */
export function detectSampleStall(now: Date = new Date()): SampleStallResult {
  const shadows = loadShadowTrades();
  const sevenDaysAgoIso = new Date(now.getTime() - SAMPLE_STALL_DAYS * 86_400_000).toISOString();
  const recent = shadows.filter(s => s.signalTime >= sevenDaysAgoIso);
  const sampleCount7d = recent.length;

  // 목표 속도 — 60일 안에 30건 수집하려면 일 0.5건 이상 필요 (근사)
  const targetVelocity = SHADOW_SAMPLE_TARGET / SHADOW_MONITORING_DAYS;
  const currentVelocity = sampleCount7d / SAMPLE_STALL_DAYS;

  if (sampleCount7d === 0) {
    return {
      stalled: true,
      reason: `최근 ${SAMPLE_STALL_DAYS}일간 신규 Shadow 0건 — 파이프라인 점검 필요`,
      sampleCount7d, targetVelocity, currentVelocity,
    };
  }

  // 반속도 이하로 둔화되면 조기 경보 (정체는 아니지만 느림)
  if (currentVelocity < targetVelocity * 0.4) {
    return {
      stalled: false,
      reason: `속도 둔화 — 현재 ${currentVelocity.toFixed(2)} < 목표 ${targetVelocity.toFixed(2)} 건/일`,
      sampleCount7d, targetVelocity, currentVelocity,
    };
  }

  return {
    stalled: false,
    reason: '정상',
    sampleCount7d, targetVelocity, currentVelocity,
  };
}

export async function sendSampleStallAlertIfNeeded(): Promise<boolean> {
  const r = detectSampleStall();
  if (!r.stalled) return false;
  await emitTelegramEvent({
    type: 'SHADOW_SUMMARY',
    message: [
      `⚠️ <b>[Sample Stall]</b> ${r.reason}`,
      `현재 속도: ${r.currentVelocity.toFixed(2)}건/일 (목표 ${r.targetVelocity.toFixed(2)}건/일)`,
      ``,
      `<b>점검 체크리스트:</b>`,
      `· 시장이 Risk-Off (정상 가능)`,
      `· 워치리스트 비어있음 (비정상 → autoPopulate 확인)`,
      `· Gemini API 레이트리밋 (비정상 → getRateLimiterStats)`,
      `· KIS 토큰 만료 후 재발급 실패 (비정상 → invalidateKisToken)`,
    ].join('\n'),
    severity: 'HIGH',
    dedupeKey: 'sample-stall',
    cooldownMs: 24 * 60 * 60 * 1000,  // 1일 쿨다운 (중복 스팸 방지)
    metadata: { scope: 'sample_stall' },
  }).catch(console.error);
  return true;
}

// ── 테스트 편의 ───────────────────────────────────────────────────────────────

/** 테스트에서 사용할 — shadow 배열을 직접 주입받아 진행률 계산 */
export function _computeProgressFromShadows(
  shadows: ServerShadowTrade[],
  now: Date,
): ShadowProgress {
  // computeShadowProgress 의 핵심 로직을 그대로 재사용하되 loadShadowTrades 우회.
  const todayKst = kstDateStr(now);
  // ADR-0129: BE 분리 SSOT — trade 단위 BE 카운터.
  const { beCount, winCount, lossCount, fullWinCount, partialWinCount, winBreakevenCount } = classifyTradeOutcome(shadows);
  const activeCount = shadows.filter(s => isOpenShadowStatus(s.status)).length;
  const totalSamples = shadows.length;
  const totalClosed  = winCount + lossCount;
  const winRatePct   = totalClosed > 0 ? (winCount / totalClosed) * 100 : 0;
  const newToday = shadows.filter(s => s.signalTime.slice(0, 10) === todayKst).length;
  let dayElapsed = 0;
  if (shadows.length > 0) {
    const firstIso = shadows.map(s => s.signalTime).sort()[0];
    dayElapsed = daysBetween(firstIso, now.toISOString()) + 1;
  }
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const recent7 = shadows.filter(s => s.signalTime >= sevenDaysAgo).length;
  const velocityPerDay = recent7 / 7;
  const remaining = Math.max(0, SHADOW_SAMPLE_TARGET - totalSamples);
  let etaDate = '미정';
  let etaDaysRemain = -1;
  if (remaining === 0) {
    etaDate = todayKst; etaDaysRemain = 0;
  } else if (velocityPerDay > 0) {
    etaDaysRemain = Math.ceil(remaining / velocityPerDay);
    etaDate = addDaysKst(now.toISOString(), etaDaysRemain);
  }
  const fillAgg = aggregateFillStats(shadows);
  return {
    dayElapsed, totalDays: SHADOW_MONITORING_DAYS,
    winCount, lossCount, beCount, fullWinCount, partialWinCount, winBreakevenCount, activeCount, totalClosed, totalSamples,
    targetSamples: SHADOW_SAMPLE_TARGET, winRatePct,
    newToday, etaDate, etaDaysRemain,
    fillWins: fillAgg.winFills,
    fillLosses: fillAgg.lossFills,
    fillBeFills: fillAgg.beFills,
    fillWeightedReturnPct: fillAgg.weightedReturnPct,
    fillRealizedKrw: fillAgg.totalRealizedKrw,
    partialOnlyCount: fillAgg.partialOnlyCount,
  };
}
