// @responsibility ADR-0394 P1.5 용어 정리 SSOT 매핑 + 표시 라벨 단일 통로
/**
 * ADR-0394 P1.5 — 용어 SSOT.
 *
 * 사용자 명시 메타 모델 정합:
 *   - "방향은 OFF/PAPER/LIVE + shadowLedger always-on"
 *   - "SHADOW 는 실행 모드가 아니라 학습 layer"
 *
 * 목적: 외부 노출 (텔레그램·UI·문서·운영자 메시지) 의 용어 통일 — *내부 식별자는 점진*.
 *
 * 사용자 명시 매핑:
 *   - `shadow buy`   → `shadowDecisionRecorded` (학습 영속 단위)
 *   - `shadow trade` → `shadowDecision` (학습 단일 결정)
 *   - `paper trade`  → `paperBuyRecorded` (가상 체결)
 *   - `live trade`   → `liveOrderSent` (실주문 발사)
 *   - `shadowMode`   → `shadowLedgerEnabled` (항상 true 상수)
 *   - `simulation`   → `decisionRecord` (모호한 용어 제거)
 *
 * 본 모듈은 *외부 노출 라벨 SSOT* — 코드 식별자 일괄 리네이밍은 회귀 위험 격리를 위해
 * 별도 PR 매 분기마다 점진 마이그레이션 (P1.5-Code-Rename-N 후속).
 */

/**
 * 사용자 명시 용어 매핑 SSOT.
 * 호출자가 legacy 용어 → 신규 용어 변환 시 본 매핑 사용.
 */
export const TERMINOLOGY_MAP = {
  // 학습 layer (영속 단위)
  shadowBuy: 'shadowDecisionRecorded',
  shadowTrade: 'shadowDecision',
  // 실행 단위
  paperTrade: 'paperBuyRecorded',
  liveTrade: 'liveOrderSent',
  // 정책 상수
  shadowMode: 'shadowLedgerEnabled',
  simulation: 'decisionRecord',
} as const;

export type LegacyTerm = keyof typeof TERMINOLOGY_MAP;
export type ModernTerm = (typeof TERMINOLOGY_MAP)[LegacyTerm];

/**
 * 텔레그램·UI 표시용 한국어 라벨 SSOT.
 * /exec_matrix / /mode_consistency / /gate_audit 등 외부 메시지에서 사용.
 */
export const DISPLAY_LABELS = {
  shadowDecisionRecorded: '🌑 학습 기록',
  paperBuyRecorded: '🟡 가상 체결',
  liveOrderSent: '🟢 실주문 발사',
  liveBlocked: '🔴 LIVE 차단',
  ghost: '👻 워치리스트 미연결',
  shadowLedgerEnabled: '학습 ledger (always-on)',
  decisionRecord: '결정 기록',
} as const;

export type DisplayKey = keyof typeof DISPLAY_LABELS;

/**
 * `shadowLedger always-on` 정책 상수 — 모든 모드에서 학습 영속 의무.
 *
 * ADR-0393 P1 의 ExecutionMode 가 OFF/PAPER/LIVE 어느 값이든 shadowLedger 는 always-on.
 * 본 상수는 정책 SSOT — 미래 *학습 layer 비활성* 옵션 검토 시 단일 변경 지점.
 *
 * P1.5 명시: `shadowMode` (분기 변수) → `shadowLedgerEnabled` (정책 상수) 의미 격상.
 * 코드에서 `shadowMode` 분기를 제거하지 않고, 정책 라벨링만 정합화.
 */
export const SHADOW_LEDGER_ENABLED = true as const;

/**
 * legacy 용어 → 신규 용어 변환 헬퍼.
 * 운영자 메시지 / 로그 합성 시 사용 — 코드 내부 식별자는 무영향.
 */
export function modernizeTerm(legacy: LegacyTerm): ModernTerm {
  return TERMINOLOGY_MAP[legacy];
}

/**
 * 외부 표시 라벨 조회 SSOT.
 * 텔레그램·UI 메시지 빌더가 본 함수만 호출 — 라벨 변경 시 단일 위치.
 */
export function getDisplayLabel(key: DisplayKey): string {
  return DISPLAY_LABELS[key];
}

/**
 * 외부 노출 영역에서 legacy 용어 사용 여부 검증 헬퍼 (정책 가드).
 * 신규 텔레그램 메시지·UI 라벨 작성 시 본 함수로 검증 → 점진 마이그레이션 회귀 차단.
 *
 * @returns 위반 발견 시 legacy 용어 배열, 위반 없으면 빈 배열.
 */
export function detectLegacyTerms(text: string): readonly LegacyTerm[] {
  const violations: LegacyTerm[] = [];
  const legacyPatterns: Record<LegacyTerm, RegExp> = {
    shadowBuy: /\bshadow\s+buy\b/i,
    shadowTrade: /\bshadow\s+trade\b/i,
    paperTrade: /\bpaper\s+trade\b/i,
    liveTrade: /\blive\s+trade\b/i,
    shadowMode: /\bshadowMode\b/,
    simulation: /\bsimulation\b/i,
  };

  for (const [term, pattern] of Object.entries(legacyPatterns) as [LegacyTerm, RegExp][]) {
    if (pattern.test(text)) violations.push(term);
  }
  return violations;
}
