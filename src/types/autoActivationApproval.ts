// @responsibility ADR-0636 운영자 승인 활성화 ledger 영속 저장형 공유 타입 — repo·엔진·telegram cmd 단일 소스. LIVE_ADJACENT_REVIEW 전용. 비즈니스 로직 0.
/**
 * autoActivationApproval.ts — ADR-0636 운영자 승인 활성화 영속 저장형.
 *
 * ADR-0635 가 등재한 LIVE_ADJACENT_REVIEW(T2) lever 4종은 LIVE-인접 동작을 바꿔
 * 자가 활성(ADR-0633 evaluator)이 금지된 "운영자 1-체크포인트" 영역이다. 본 타입은
 * 운영자가 1-클릭으로 명시 승인한 lever 의 승인 상태를 재배포·재시작 후에도 보존하기
 * 위한 영속 저장형이다. 단일 소스 — server/persistence/autoActivationApprovalRepo,
 * server/trading/selfValidationAutoActivationAdr0633(reapply), telegram cmd 가 본
 * 타입을 import 한다(중복 선언 금지).
 *
 * 안전 invariant (ADR-0634 autoActivationStreakRepo 동형):
 *   - 빈 상태 `{}` 가 기본(승인 0건) — 휘발·손상 시 self-heal 로 빈 상태 복귀.
 *   - 빈 상태 = 부팅 재적용 no-op = byte-identical(default LIVE 동작 무변경).
 *   - 승인은 master flag(AUTO_TRADE_ENABLED·KIS_IS_REAL)와 독립한 운영자 명시 행위다.
 */

/** lever 1건의 승인 상태. */
export interface AutoActivationApprovalEntry {
  /** 운영자가 승인한 ISO8601 시각. */
  approvedAt: string;
  /** 승인한 운영자 식별자 (Telegram userId 또는 'operator'/'admin'/'system'). */
  approvedBy: string;
}

/** leverId → 승인 상태. 휘발/손상 시 빈 `{}` self-heal(승인 0건 = byte-identical). */
export type AutoActivationApprovalStore = Record<string, AutoActivationApprovalEntry>;
