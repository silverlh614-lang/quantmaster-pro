/**
 * @responsibility 연휴 복귀 첫 영업일 보수 매매 정책 SSOT — Kelly 축소 + Gate 상향 + 시초 진입 차단 (ADR-0044)
 *
 * `MarketDayClassifier` (ADR-0043) 의 POST_HOLIDAY + isLongHoliday 판정 위에
 * 올라가는 시간 정책. 호출자가 명시적으로 `apply*` 헬퍼를 호출해야 효과 발동
 * (LIVE 매매 본체 0줄 변경 보장 — 본 PR 은 정책 SSOT + 알림만, 매매 wiring 은 PR-C-2).
 *
 * BudgetPolicy(ADR-0036) 와 별개 운영. kellyMultiplier 는 BudgetPolicy 의
 * fractionalKellyCap 위에 곱해지는 추가 축소 계수.
 *
 * 외부 의존성: marketDayClassifier (read-only). state/persistence import 금지.
 */

import type { MarketDayContext } from '../utils/marketDayClassifier.js';

const KST_OFFSET_MS = 9 * 3_600_000;

export interface HolidayResumePolicy {
  /** 정책 식별자 — 백테스트 비교 시 결과에 부착 */
  id: string;
  /** 활성 사유 — 텔레그램 메시지에 사용 */
  reason: string;
  /** Fractional Kelly 추가 축소 계수 (1.0 = 무영향). BudgetPolicy 캡 위에 곱해짐. */
  kellyMultiplier: number;
  /** 진입 Gate 점수 임계값 추가분 (0 = 무영향, +1 = 5→6 으로 상향) */
  gateScoreBoost: number;
  /** 시초 진입 차단 분 (0 = 무영향, 30 = 09:00~09:30 KST 신규 진입 차단) */
  marketOpenDelayMin: number;
  /** 정책 만료 KST HH:MM (빈 문자열 = 일중 유지) */
  expirationKstTime: string;
}

/**
 * 환경 변수 기반 기본 정책. env 변경을 즉시 반영하기 위해 매 호출 시점에 새 객체.
 */
export function getDefaultHolidayResumePolicy(): HolidayResumePolicy {
  return {
    id: 'long-holiday-resume-default',
    reason: '장기 연휴 복귀 첫 영업일',
    kellyMultiplier:    parseFloat(process.env.HOLIDAY_RESUME_KELLY_MULT          ?? '0.5'),
    gateScoreBoost:     parseInt  (process.env.HOLIDAY_RESUME_GATE_BOOST          ?? '1', 10),
    marketOpenDelayMin: parseInt  (process.env.HOLIDAY_RESUME_OPEN_DELAY_MIN      ?? '30', 10),
    expirationKstTime:                process.env.HOLIDAY_RESUME_EXPIRATION_KST    ?? '12:00',
  };
}

/**
 * 활성 정책 결정 — 활성 조건 충족 시 정책 반환, 외 null.
 *
 * 활성 조건 (모두 충족):
 *   1. ctx.type === 'POST_HOLIDAY'
 *   2. ctx.isLongHoliday === true (≥ 3일 비영업 클러스터 직후)
 *   3. 만료 시각 미도달 (expirationKstTime 이 빈 문자열이 아니고 현재 KST 가 그 이후면 비활성)
 */
export function resolveHolidayResumePolicyForContext(
  ctx: MarketDayContext,
  now: Date = new Date(),
): HolidayResumePolicy | null {
  if (ctx.type !== 'POST_HOLIDAY') return null;
  if (!ctx.isLongHoliday) return null;

  const policy = getDefaultHolidayResumePolicy();

  if (policy.expirationKstTime) {
    const nowHm = kstHm(now);
    if (nowHm >= policy.expirationKstTime) return null;
  }

  return policy;
}

/**
 * Fractional Kelly multiplier 에 정책 추가 축소 적용.
 * 정책 null 시 무영향 (입력 그대로 반환).
 */
export function applyKellyMultiplierWithHolidayPolicy(
  baseKelly: number,
  policy: HolidayResumePolicy | null,
): number {
  if (!policy) return baseKelly;
  if (!Number.isFinite(baseKelly)) return 0;
  return Math.max(0, baseKelly * policy.kellyMultiplier);
}

/**
 * Gate 점수 임계값에 정책 boost 적용.
 * 정책 null 시 무영향.
 */
export function applyGateBoostWithHolidayPolicy(
  baseMinGate: number,
  policy: HolidayResumePolicy | null,
): number {
  if (!policy) return baseMinGate;
  return baseMinGate + policy.gateScoreBoost;
}

/**
 * 현재 시각이 시초 진입 차단 윈도우(09:00 ~ 09:00+marketOpenDelayMin KST) 안인지 판정.
 * 정책 null 또는 marketOpenDelayMin=0 시 false (차단 안 함).
 */
export function isWithinMarketOpenDelay(
  now: Date,
  policy: HolidayResumePolicy | null,
): boolean {
  if (!policy) return false;
  if (policy.marketOpenDelayMin <= 0) return false;
  const nowMins = kstMinutes(now);
  const openMins = 9 * 60;
  const cutoffMins = openMins + policy.marketOpenDelayMin;
  return nowMins >= openMins && nowMins < cutoffMins;
}

// ── 내부 KST 유틸 ────────────────────────────────────────────────────────────

function kstMinutes(now: Date): number {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

function kstHm(now: Date): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
