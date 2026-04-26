/**
 * @responsibility lossReason 별 trade-level 학습 가중치 SSOT — Confidence-Weighted Learning
 *
 * ADR-0022 (PR-E): PR-D 가 부여한 lossReason 을 활용해 손실 거래의 학습 영향력을
 * 분류별로 차등 적용. STOP_TOO_TIGHT/MACRO_SHOCK 은 약화 (조건 잘못 아님),
 * OVERHEATED_ENTRY/STOP_TOO_LOOSE 는 강화 (학습 신호 명확).
 */
import type { LossReason, TradeRecord } from '../../types/portfolio';

/**
 * lossReason 별 trade-level 학습 multiplier.
 *
 * 의미:
 *  - 1.0: 기본 (UNCLASSIFIED, FALSE_BREAKOUT 등 — 조건 점검 가치 정상)
 *  - < 1.0: 학습 약화 — 손실이 조건 자체 문제가 아님 (외부 충격/손절폭 문제)
 *  - > 1.0: 학습 강화 — 진입 신호 노이즈가 명확해 더 강한 보정 필요
 *
 * STOP_TOO_TIGHT (0.3):  손절폭만 좁았음. 조건은 정상이라 학습 약화.
 * MACRO_SHOCK    (0.2):  시장 전체 급락. 종목/조건 무관, 학습 강력 약화.
 * OVERHEATED_ENTRY(1.5): 진입 신호 노이즈 확정. 관련 조건 학습 강화.
 * STOP_TOO_LOOSE (1.5):  손절 지연 문제. 손절 조건 학습 강화.
 * SECTOR_ROTATION_OUT(0.5): 섹터 자금 이탈. 종목 조건 부분 약화.
 * EARNINGS_MISS  (0.5):  외부 충격 (실적). 조건 학습 부분 약화.
 * LIQUIDITY_TRAP (0.7):  유동성 문제. 조건 학습 부분 약화.
 * FALSE_BREAKOUT (1.0):  돌파 실패. 조건 점검 가치 정상.
 * UNCLASSIFIED   (1.0):  분류 불가 시 안전하게 기본.
 */
export const LOSS_REASON_LEARNING_MULTIPLIER: Record<LossReason, number> = {
  STOP_TOO_TIGHT:      0.3,
  MACRO_SHOCK:         0.2,
  OVERHEATED_ENTRY:    1.5,
  STOP_TOO_LOOSE:      1.5,
  FALSE_BREAKOUT:      1.0,
  SECTOR_ROTATION_OUT: 0.5,
  EARNINGS_MISS:       0.5,
  LIQUIDITY_TRAP:      0.7,
  UNCLASSIFIED:        1.0,
};

/**
 * 환경 변수 — 긴급 롤백 스위치. true 면 모든 trade multiplier=1.0 으로
 * fallback (PR-E 이전 동작 복원).
 */
export function isLossReasonWeightingDisabled(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  return process.env.LEARNING_LOSS_REASON_WEIGHTING_DISABLED === 'true';
}

/**
 * 단일 거래의 학습 multiplier 를 반환한다.
 *
 * 우선순위:
 *  1. ENV 스위치 disabled → 1.0
 *  2. returnPct >= 0 (수익 거래) → 1.0 (lossReason 무관)
 *  3. lossReason 부재 (v1/v2 레코드) → 1.0
 *  4. lossReason 매핑값 (없으면 1.0 안전 fallback)
 *
 * @returns 0~∞ 범위 multiplier (현재 SSOT 는 0.2~1.5)
 */
export function getTradeLearningWeight(trade: TradeRecord): number {
  if (isLossReasonWeightingDisabled()) return 1.0;

  const returnPct = trade.returnPct ?? 0;
  if (!Number.isFinite(returnPct) || returnPct >= 0) return 1.0;

  const reason = trade.lossReason;
  if (!reason) return 1.0;

  const m = LOSS_REASON_LEARNING_MULTIPLIER[reason];
  return typeof m === 'number' && Number.isFinite(m) && m >= 0 ? m : 1.0;
}

/**
 * 거래 배열의 lossReason 분포를 집계한다.
 * UI 가 "이 조건의 손실은 주로 STOP_TOO_TIGHT 였음" 같은 진단을 표시 가능.
 *
 * @returns Partial map — 카운트 0 인 reason 은 키 자체 부재
 */
export function summarizeLossReasonBreakdown(
  trades: TradeRecord[],
): Partial<Record<LossReason, number>> {
  const breakdown: Partial<Record<LossReason, number>> = {};
  for (const t of trades) {
    if ((t.returnPct ?? 0) >= 0) continue; // 수익 거래 스킵
    const reason = t.lossReason ?? 'UNCLASSIFIED';
    breakdown[reason] = (breakdown[reason] ?? 0) + 1;
  }
  return breakdown;
}
