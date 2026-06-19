// @responsibility 레짐 전환 Telegram 알림 판정·문구 SSOT — 진동 억제·정직한 전환 사유·무변화 라벨. 표시 전용, 실행 권한 0.

import type { RegimeLevel } from '../../../src/types/core.js';

export interface RegimeNoticeConfig {
  kellyMultiplier: number;
  maxPositions: number;
}

export type RegimeTransitionKind = 'UPGRADE' | 'DOWNGRADE' | 'RELABEL_NO_CHANGE';

export interface RegimeTransitionClassification {
  kind: RegimeTransitionKind;
  label: string;
  emoji: string;
  materialChange: boolean;
}

/**
 * ③ 전환 방향·실질 변화 분류.
 * REGIME_ORDER 인덱스 비교(isDowngrade)는 호출자가 계산해 주입(순환 import 회피).
 * prevCfg/currCfg 의 Kelly·maxPositions 가 동일하면 "정책 무변경" — 인덱스만 바뀐 표시용 전환.
 * (예: R6_DEFENSE↔R5_CAUTION 은 둘 다 Kelly ×0.3 / 한도 3개 → "공격 전환" 오라벨 금지.)
 */
export function classifyRegimeTransition(args: {
  isDowngrade: boolean;
  prevCfg: RegimeNoticeConfig;
  currCfg: RegimeNoticeConfig;
}): RegimeTransitionClassification {
  const { isDowngrade, prevCfg, currCfg } = args;
  const materialChange =
    prevCfg.kellyMultiplier !== currCfg.kellyMultiplier ||
    prevCfg.maxPositions !== currCfg.maxPositions;

  if (!materialChange) {
    return { kind: 'RELABEL_NO_CHANGE', label: '정책 무변경(표시 단계만)', emoji: '⚪', materialChange: false };
  }
  return isDowngrade
    ? { kind: 'DOWNGRADE', label: '방어 강화', emoji: '🔴', materialChange: true }
    : { kind: 'UPGRADE', label: '공격 전환', emoji: '🟢', materialChange: true };
}

export interface NotifiedRegimeDeparture {
  regime: RegimeLevel;
  at: number; // epoch ms
}

/**
 * ① 진동(flip-flop) 판정 — 최근 dwell 창 안에서 떠났던 레짐으로 되돌아오면 oscillation.
 * 예: R5→R6 직후 R6→R5(되돌림) → target=R5 가 최근 departed → true.
 * dwellMs<=0 이면 항상 false(억제 비활성·legacy 동작).
 */
export function isOscillationReversal(
  recentDepartures: readonly NotifiedRegimeDeparture[],
  targetRegime: RegimeLevel,
  nowMs: number,
  dwellMs: number,
): boolean {
  if (dwellMs <= 0) return false;
  return recentDepartures.some(d => d.regime === targetRegime && nowMs - d.at < dwellMs);
}

/** dwell 창 밖(또는 미래 skew) 항목 제거 — 배열 무한 성장 방지. */
export function pruneDepartures(
  departures: readonly NotifiedRegimeDeparture[],
  nowMs: number,
  dwellMs: number,
): NotifiedRegimeDeparture[] {
  if (dwellMs <= 0) return [];
  return departures.filter(d => nowMs - d.at < dwellMs && nowMs - d.at >= 0);
}

export interface RegimeTransitionMessageInput {
  prevRegime: RegimeLevel;
  currRegime: RegimeLevel;
  prevCfg: RegimeNoticeConfig;
  currCfg: RegimeNoticeConfig;
  prevMhs: number | null;
  currMhs: number | null;
  prevVkospi: number | null;
  currVkospi: number | null;
  transitionReason: string;
  r6RecoveryStatus: string;
  classification: RegimeTransitionClassification;
  resetNote: string;
}

/**
 * 전환 알림 본문 빌더(playbook 제외 — 호출자가 append).
 * ② 정직한 사유: transitionReason / r6RecoveryStatus 항상 노출. MHS/VKOSPI 변화 0 이면 명시
 *    ("거시 지표 변화 없음") — 운영자가 지표가 움직인 줄 오해하지 않도록.
 * ③ 무변화: materialChange=false 면 "정책 변경 없음" 단일 라인 + 중립 라벨.
 */
export function buildRegimeTransitionMessage(input: RegimeTransitionMessageInput): string {
  const c = input.classification;
  const mhsDelta = (input.currMhs != null && input.prevMhs != null) ? input.currMhs - input.prevMhs : null;
  const vkospiDelta = (input.currVkospi != null && input.prevVkospi != null) ? input.currVkospi - input.prevVkospi : null;
  const macroFlat = (mhsDelta === null || mhsDelta === 0) && (vkospiDelta === null || vkospiDelta === 0);

  let msg =
    `⚠️ <b>[레짐 전환]</b> ${input.prevRegime} → ${input.currRegime} ${c.emoji}\n` +
    `━━━━━━━━━━━━━━━━\n`;

  // ② 전환 사유(실제 드라이버) — 거시 지표가 아니라 상태기계/latch 일 수 있음.
  msg += `전환 사유: ${input.transitionReason}`;
  if (input.r6RecoveryStatus && input.r6RecoveryStatus !== 'NONE') {
    msg += ` | 복구상태: ${input.r6RecoveryStatus}`;
  }
  msg += `\n`;

  if (mhsDelta !== null) {
    msg += `MHS: ${input.prevMhs} → ${input.currMhs} (${mhsDelta >= 0 ? '+' : ''}${mhsDelta}pt)\n`;
  }
  if (vkospiDelta !== null) {
    msg += `VKOSPI: ${input.prevVkospi?.toFixed(1)} → ${input.currVkospi?.toFixed(1)} ` +
           `(${vkospiDelta >= 0 ? '+' : ''}${vkospiDelta.toFixed(1)})\n`;
  }
  if (macroFlat) {
    msg += `<i>(거시 지표 변화 없음 — 상태/latch 기반 전환)</i>\n`;
  }

  if (c.materialChange) {
    msg += `\n<b>변경사항 (${c.label}):</b>\n`;
    msg += `• Kelly 배율: ×${input.prevCfg.kellyMultiplier} → ×${input.currCfg.kellyMultiplier} 자동 적용\n`;
    msg += `• 신규 진입 한도: ${input.prevCfg.maxPositions}개 → ${input.currCfg.maxPositions}개\n`;
    msg += `• 손절 기준: ${c.kind === 'DOWNGRADE' ? '강화' : '완화'} 모드 전환\n`;
  } else {
    msg += `\n<b>변경사항 (${c.label}):</b>\n`;
    msg += `• 정책 변경 없음 — Kelly ×${input.currCfg.kellyMultiplier} · 신규 진입 한도 ${input.currCfg.maxPositions}개 동일\n`;
  }

  if (input.resetNote) msg += input.resetNote;

  msg += `━━━━━━━━━━━━━━━━\n`;
  msg += c.kind === 'DOWNGRADE' ? `📌 현재 보유 포지션 점검 권고` : `📌 신규 진입 기회 탐색 권고`;
  return msg;
}

/**
 * ① ENV `REGIME_NOTIFY_MIN_DWELL_MIN`(분) → ms. 기본 10분 · 0=진동 억제 비활성(legacy) · 상한 120분.
 * 음수/NaN 은 기본값으로 안전 fallback.
 */
export function resolveRegimeNotifyDwellMs(): number {
  const raw = Number(process.env.REGIME_NOTIFY_MIN_DWELL_MIN);
  if (!Number.isFinite(raw) || raw < 0) return 10 * 60_000;
  return Math.min(120, Math.trunc(raw)) * 60_000;
}

/**
 * D2 — 장외(마감 후/장전/휴장) 레짐 전환 알림 억제 판정.
 * 3분 TTL refresh 가 장외에서 intraday 신선도 flapping(R3↔R4)으로 전환을 토글하는 것을 차단.
 * R6_DEFENSE 진입(블랙스완)은 안전상 항상 통과 — 오버나잇/장전 위기 경보 보존.
 */
export function shouldSuppressClosedMarketNotice(args: { marketOpen: boolean; isR6Entry: boolean }): boolean {
  if (args.marketOpen) return false;
  if (args.isR6Entry) return false;
  return true;
}

/** ENV `REGIME_NOTIFY_WHEN_CLOSED=true` → 장외에도 전환 알림 발송(legacy 복원). 기본 OFF=장외 억제. */
export function isRegimeNotifyWhenClosedEnabled(): boolean {
  return process.env.REGIME_NOTIFY_WHEN_CLOSED === 'true';
}
