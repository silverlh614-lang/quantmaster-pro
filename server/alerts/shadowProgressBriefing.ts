/**
 * shadowProgressBriefing.ts — Phase 2: 일일 Shadow 진행률 브리핑 & 표본 속도 추적
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

import { loadShadowTrades, type ServerShadowTrade } from '../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';
import { sendTelegramAlert } from './telegramClient.js';

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

// ── 공개 API: 진행 현황 ──────────────────────────────────────────────────────

export interface ShadowProgress {
  dayElapsed: number;      // 첫 샘플 생성 후 경과일 (0 = 당일)
  totalDays:  number;      // SHADOW_MONITORING_DAYS
  winCount:   number;
  lossCount:  number;
  activeCount: number;
  totalClosed: number;
  totalSamples: number;
  targetSamples: number;   // SHADOW_SAMPLE_TARGET
  winRatePct:  number;
  newToday:    number;     // 오늘 생성된 신규 신호 수
  etaDate:     string;     // YYYY-MM-DD — 현재 속도로 30건 도달 예상일 (또는 '미정')
  etaDaysRemain: number;   // ETA 까지 잔여 일수 (미정 시 -1)
}

export function computeShadowProgress(now: Date = new Date()): ShadowProgress {
  const todayKst = kstDateStr(now);
  const shadows = loadShadowTrades();

  const winCount   = shadows.filter(s => s.status === 'HIT_TARGET').length;
  const lossCount  = shadows.filter(s => s.status === 'HIT_STOP').length;
  const activeCount = shadows.filter(s => isOpenShadowStatus(s.status)).length;
  const totalSamples = shadows.length;
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

  return {
    dayElapsed,
    totalDays: SHADOW_MONITORING_DAYS,
    winCount, lossCount, activeCount,
    totalClosed, totalSamples,
    targetSamples: SHADOW_SAMPLE_TARGET,
    winRatePct,
    newToday, etaDate, etaDaysRemain,
  };
}

export function formatShadowProgress(p: ShadowProgress): string {
  const closedPct = p.totalClosed > 0
    ? ` (승률 ${p.winRatePct.toFixed(1)}%)`
    : '';
  return [
    `📊 <b>[Shadow 진행률 Day ${p.dayElapsed}/${p.totalDays}]</b>`,
    `신규 신호: ${p.newToday}건 | 전체 샘플: ${p.totalSamples}/${p.targetSamples}`,
    `━━━━━━━━━━━━━━━━━━`,
    `✅ WIN: ${p.winCount}건${closedPct}`,
    `❌ LOSS: ${p.lossCount}건`,
    `⏳ ACTIVE: ${p.activeCount}건`,
    `━━━━━━━━━━━━━━━━━━`,
    p.etaDaysRemain >= 0
      ? `예상 완주: ${p.etaDate} (D-${p.etaDaysRemain})`
      : `예상 완주: 미정 (최근 7일 신규 0건)`,
  ].join('\n');
}

export async function sendDailyShadowProgress(): Promise<void> {
  const progress = computeShadowProgress();
  const message = formatShadowProgress(progress);
  await sendTelegramAlert(message, {
    priority: 'NORMAL',
    dedupeKey: `shadow-progress-${kstDateStr()}`,
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
  await sendTelegramAlert(
    [
      `⚠️ <b>[Sample Stall]</b> ${r.reason}`,
      `현재 속도: ${r.currentVelocity.toFixed(2)}건/일 (목표 ${r.targetVelocity.toFixed(2)}건/일)`,
      ``,
      `<b>점검 체크리스트:</b>`,
      `· 시장이 Risk-Off (정상 가능)`,
      `· 워치리스트 비어있음 (비정상 → autoPopulate 확인)`,
      `· Gemini API 레이트리밋 (비정상 → getRateLimiterStats)`,
      `· KIS 토큰 만료 후 재발급 실패 (비정상 → invalidateKisToken)`,
    ].join('\n'),
    {
      priority: 'HIGH',
      dedupeKey: 'sample-stall',
      cooldownMs: 24 * 60 * 60 * 1000,  // 1일 쿨다운 (중복 스팸 방지)
    },
  ).catch(console.error);
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
  const winCount   = shadows.filter(s => s.status === 'HIT_TARGET').length;
  const lossCount  = shadows.filter(s => s.status === 'HIT_STOP').length;
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
  return {
    dayElapsed, totalDays: SHADOW_MONITORING_DAYS,
    winCount, lossCount, activeCount, totalClosed, totalSamples,
    targetSamples: SHADOW_SAMPLE_TARGET, winRatePct,
    newToday, etaDate, etaDaysRemain,
  };
}
