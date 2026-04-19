/**
 * alertTiers.ts — Telegram 알림 3-티어 체계.
 *
 * 참뮌 스펙:
 *   Tier 1 🚨 ALARM   즉각 행동 필요 (매매 집행·시스템 생존)
 *   Tier 2 📊 REPORT  정기 리포트 (읽고 소화)
 *   Tier 3 📋 DIGEST  다이제스트 요약 (배경 라디오)
 *
 * "경보에는 침묵의 여백이 있어야 다음 경보가 들린다" — 3개 아이콘만 허용하여
 * 메시지 첫 글자만 봐도 "지금 봐야 하는가"가 즉시 결정되도록 한다.
 */
import type { AlertPriority } from './telegramClient.js';

export type AlertTier = 'T1_ALARM' | 'T2_REPORT' | 'T3_DIGEST';

/** 티어별 대표 아이콘 — 메시지 선두에 배타적으로 배치된다. */
export const TIER_ICON: Record<AlertTier, string> = {
  T1_ALARM:  '🚨',
  T2_REPORT: '📊',
  T3_DIGEST: '📋',
};

/** 티어별 배경 설명 — /help, 알림 감사 리포트에서 사용. */
export const TIER_LABEL: Record<AlertTier, string> = {
  T1_ALARM:  '즉각 행동 필요',
  T2_REPORT: '정기 리포트',
  T3_DIGEST: '다이제스트 요약',
};

/**
 * priority → tier 자동 매핑.
 *
 * CRITICAL → T1 (매매 개입·시스템 생존 임계)
 * HIGH     → T2 (기본값 — 보조 리포트 성격이 많음)
 * NORMAL   → T2
 * LOW      → T3
 *
 * 특정 HIGH 경보가 실제로 T1 수준이면 호출부에서 `tier: 'T1_ALARM'`을 명시한다.
 */
export function priorityToTier(priority?: AlertPriority): AlertTier {
  switch (priority) {
    case 'CRITICAL': return 'T1_ALARM';
    case 'LOW':      return 'T3_DIGEST';
    case 'HIGH':
    case 'NORMAL':
    default:         return 'T2_REPORT';
  }
}

/**
 * 호출부가 `tier`를 명시하면 그것을 사용하고, 아니면 priority로 추정한다.
 */
export function deriveTier(opts?: { tier?: AlertTier; priority?: AlertPriority }): AlertTier {
  if (opts?.tier) return opts.tier;
  return priorityToTier(opts?.priority);
}

/**
 * 선두 아이콘 스트립 대상 — 이전에 난립했던 레거시 글리프 집합.
 * 이 목록에 해당하는 글자 + 변이형(⚠️의 variation selector 등)이 메시지 선두에 있으면
 * 제거하고 티어 아이콘으로 교체한다. 본문 중간의 아이콘은 건드리지 않는다.
 */
const LEGACY_LEADING_ICONS = [
  '🚨', '🔴', '⚠️', '🌡️', '🔥', '🛑', '📊', '📋',
  '📡', '📈', '📉', '🩺', '🌐', '🐻', '🎯', '🎭',
  '🤖', '🧭', '🔔', '⏳', '🚫', '🔄', '🔍', '🧪',
  '🩸', '🧊', '✅', '❌', '❓', '📢', '💎',
];

/** 선두 아이콘 + 공백·줄바꿈을 제거하고 티어 아이콘을 prepend. */
export function applyTierPrefix(message: string, tier: AlertTier): string {
  const icon = TIER_ICON[tier];
  // 이미 정확한 티어 아이콘으로 시작하면 중복 부여 금지.
  if (message.startsWith(icon + ' ') || message.startsWith(icon + '\n')) {
    return message;
  }
  const stripped = stripLeadingLegacyIcon(message);
  return `${icon} ${stripped}`;
}

function stripLeadingLegacyIcon(message: string): string {
  let s = message.replace(/^[\s\u200B-\u200D\uFEFF]+/, '');
  for (const glyph of LEGACY_LEADING_ICONS) {
    if (s.startsWith(glyph)) {
      s = s.slice(glyph.length).replace(/^[\s\uFE0F\u200B-\u200D]+/, '');
      break; // 하나만 제거 — 연속 중첩은 본문 의도로 간주.
    }
  }
  return s;
}

/**
 * 카테고리 추정 — dedupeKey prefix에서 도메인 추출.
 * 알림 감사 리포트가 "가장 빈발한 카테고리"를 집계할 때 사용한다.
 */
export function inferCategory(dedupeKey?: string): string {
  if (!dedupeKey) return 'uncategorized';
  // 'oco-cancel-fail:123' → 'oco-cancel-fail'
  const colonIdx = dedupeKey.indexOf(':');
  if (colonIdx > 0) return dedupeKey.slice(0, colonIdx);
  // 'regime_switch:A->B' 처럼 '_' 로 갈라진 경우 첫 토큰 사용.
  return dedupeKey.split(/[_:]/)[0];
}
