// @responsibility killSwitch 매매 엔진 모듈
/**
 * killSwitch.ts — 4조건 기반 자동 강등 Cascade (LIVE → SHADOW).
 *
 * 페르소나 원칙 8 확장: "손절은 운영 비용" 을 **포지션 단위** 에서
 * **시스템 단위** 로 격상. 한 번의 과잉 손실·외부 장애·시장 충격이
 * 복합으로 겹치기 전에 선제 강등하여 하드 스탑(EMERGENCY_STOP) 을 회피한다.
 *
 * 강등 조건 (하나라도 충족 시 SHADOW 강등):
 *   1. DAILY_LOSS_LIMIT 초과 — 일일 손실 한도 돌파
 *   2. OCO_CANCEL_FAIL_COUNT ≥ 3 — 반대 주문 취소 연속 실패
 *   3. KIS_TOKEN_FAIL_RECENT — 최근 N분 내 토큰 재발급 실패 감지
 *   4. VKOSPI_SURGE — VKOSPI 일중 +30% 이상 급등
 *
 * 강등은 **프로세스 재시작 시 env 값으로 복원**. 운영자가 의도적으로
 * SHADOW 를 유지하려면 env `AUTO_TRADE_MODE=SHADOW` 를 직접 설정해야 한다.
 */

import {
  getTradingMode,
  setTradingMode,
  getDailyLossPct,
  setKillSwitchLast,
  type KillSwitchRecord,
} from '../state.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { safePctChange } from '../utils/safePctChange.js';

// ─── 임계값 ────────────────────────────────────────────────────────────────
const DAILY_LOSS_LIMIT_PCT = Number(process.env.DAILY_LOSS_LIMIT_PCT ?? 5);
const OCO_CANCEL_FAIL_THRESHOLD = 3;
const VKOSPI_SURGE_PCT = 30;

// ─── 누적 카운터 ────────────────────────────────────────────────────────────
let ocoCancelFailCount = 0;
export function incrementOcoCancelFail(): void {
  ocoCancelFailCount += 1;
}
export function resetOcoCancelFail(): void {
  ocoCancelFailCount = 0;
}
export function getOcoCancelFailCount(): number {
  return ocoCancelFailCount;
}

let lastKisTokenFailAt = 0;
const KIS_TOKEN_FAIL_WINDOW_MS = 10 * 60 * 1000;
export function markKisTokenFail(): void {
  lastKisTokenFailAt = Date.now();
}
export function hasRecentKisTokenFail(): boolean {
  return Date.now() - lastKisTokenFailAt < KIS_TOKEN_FAIL_WINDOW_MS;
}

let lastVkospiOpenValue = 0;
let lastVkospiCurrent = 0;
export function recordVkospiBaseline(openValue: number): void {
  lastVkospiOpenValue = openValue;
  lastVkospiCurrent = openValue;
}
export function updateVkospi(currentValue: number): void {
  lastVkospiCurrent = currentValue;
}
export function getVkospiSurgePct(): number {
  if (!lastVkospiOpenValue) return 0;
  // ADR-0049: VKOSPI 동일일자 데이터라 stale 위험 적지만 sanity bound (±90%) 으로
  // 데이터 오류·스토리지 손상 시 비상정지 트리거 오작동 차단.
  return safePctChange(lastVkospiCurrent, lastVkospiOpenValue, {
    label: 'killSwitch.vkospiSurge',
  }) ?? 0;
}

// ─── 조건 평가 ─────────────────────────────────────────────────────────────
export interface KillSwitchAssessment {
  shouldDowngrade: boolean;
  triggers: string[];
  details: {
    dailyLossPct: number;
    ocoCancelFails: number;
    kisTokenFailRecent: boolean;
    vkospiSurgePct: number;
  };
}

export function assessKillSwitch(): KillSwitchAssessment {
  const dailyLossPct = getDailyLossPct();
  const ocoFails = ocoCancelFailCount;
  const tokenFail = hasRecentKisTokenFail();
  const vkospiSurge = getVkospiSurgePct();

  const triggers: string[] = [];
  if (dailyLossPct >= DAILY_LOSS_LIMIT_PCT) {
    triggers.push(`DAILY_LOSS (${dailyLossPct.toFixed(2)}% ≥ ${DAILY_LOSS_LIMIT_PCT}%)`);
  }
  if (ocoFails >= OCO_CANCEL_FAIL_THRESHOLD) {
    triggers.push(`OCO_CANCEL_FAIL (${ocoFails} ≥ ${OCO_CANCEL_FAIL_THRESHOLD})`);
  }
  if (tokenFail) {
    triggers.push('KIS_TOKEN_FAIL_RECENT');
  }
  if (vkospiSurge >= VKOSPI_SURGE_PCT) {
    triggers.push(`VKOSPI_SURGE (+${vkospiSurge.toFixed(1)}%)`);
  }

  return {
    shouldDowngrade: triggers.length > 0,
    triggers,
    details: {
      dailyLossPct,
      ocoCancelFails: ocoFails,
      kisTokenFailRecent: tokenFail,
      vkospiSurgePct: vkospiSurge,
    },
  };
}

// ─── 강등 실행 (멱등) ──────────────────────────────────────────────────────
/**
 * 평가 결과가 `shouldDowngrade` 이고 현재 모드가 LIVE 일 때만 강등 수행.
 * 이미 SHADOW 라면 no-op. 텔레그램 CRITICAL 알림 + KillSwitchRecord 보존.
 */
export async function runKillSwitchCheck(): Promise<KillSwitchAssessment> {
  const assessment = assessKillSwitch();
  const currentMode = getTradingMode();

  if (!assessment.shouldDowngrade) return assessment;
  if (currentMode !== 'LIVE') return assessment;

  setTradingMode('SHADOW');

  const rec: KillSwitchRecord = {
    at: new Date().toISOString(),
    from: 'LIVE',
    to: 'SHADOW',
    reason: assessment.triggers.join(', '),
    triggers: assessment.triggers,
  };
  setKillSwitchLast(rec);

  await sendTelegramAlert(
    `🛑 <b>[KILL SWITCH] LIVE → SHADOW 자동 강등</b>\n` +
    `시각: ${rec.at}\n` +
    `원인:\n` +
    assessment.triggers.map(t => `  • ${t}`).join('\n') +
    `\n\n엔진은 계속 실행되나 실주문 대신 shadow 집행합니다. 원인 해결 후 수동으로 env + 재시작 시 LIVE 복귀.`,
    { priority: 'CRITICAL', dedupeKey: 'kill-switch-downgrade' },
  ).catch(console.error);

  console.warn('[KillSwitch] 🛑 LIVE → SHADOW 강등:', assessment.triggers);
  return assessment;
}
