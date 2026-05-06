// @responsibility BEP_PROTECTION 영역 Two-Bar Confirmation Gate 평가 SSOT 헬퍼
/**
 * exitEngine/helpers/twoBarBepGate.ts — ADR-0085 §트랙 1 BEP 글라이드 Two-Bar
 * Confirmation 의 hardStopLoss wiring 진입점 (PR-B1-1, 지침서 7843c96f).
 *
 * `evaluateTwoBarConfirmation` 정책 함수 (ADR-0085 PR-C 트랙 1 인프라) 위에
 * 호출자 (hardStopLoss.ts) 가 사용하는 *액션 판정 + shadow update payload 합성*
 * 단일 SSOT.
 *
 * 우선순위 (결정 트리):
 *   1. ENV `BEP_PROTECTION_DISABLED=true` → SKIP (정책 우회, 즉시 청산 진행)
 *   2. isBepProtection=false → SKIP (BEP_PROTECTION 분류 아님 — 일반 LOSS_STOP)
 *   3. LIVE 모드 + ENV `BEP_TWO_BAR_LIVE_ENABLED` 미설정 → SKIP (LIVE 회귀 격리,
 *      운영자가 SHADOW 1주 검증 후 명시 활성화)
 *   4. evaluateTwoBarConfirmation 결과 분기:
 *      - PASS  → SKIP (NaN/Infinity 입력 등)
 *      - WAIT  → WAIT (호출자가 bepGlideTouchAt 영속 + 청산 보류)
 *      - RESET → RESET (호출자가 bepGlideTouchAt 초기화 + 청산 미수행)
 *      - CONFIRM_EXIT → CONTINUE_EXIT (2개 봉 경과, 청산 진행)
 *
 * 호출자 책임:
 *   - WAIT/RESET 반환 시 `result.shadowUpdate` 가 있으면 `updateShadow(shadow, patch)`
 *     호출 후 `return NO_OP` (청산 미수행).
 *   - CONTINUE_EXIT/SKIP 반환 시 기존 청산 흐름 진행 (fallthrough).
 */

import {
  evaluateTwoBarConfirmation,
  type TwoBarDecision,
} from '../../twoBarConfirmation.js';
import { kstBusinessDateStr } from './ma60.js';
import { getTradingMode } from '../../../state.js';
import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';

export type TwoBarBepGateAction = 'CONTINUE_EXIT' | 'WAIT' | 'RESET' | 'SKIP';

export interface TwoBarBepGateResult {
  action: TwoBarBepGateAction;
  /** updateShadow 에 전달할 patch — undefined 면 영속 변경 없음 (호출자 no-op) */
  shadowUpdate?: Partial<ServerShadowTrade>;
  /** 진단 로그용 사유 */
  reason: string;
  /** 원본 TwoBarDecision (디버깅·테스트용, SKIP 시 undefined) */
  decision?: TwoBarDecision;
}

export interface TwoBarBepGateInput {
  shadow: ServerShadowTrade;
  currentPrice: number;
  hardStopLoss: number;
  /** stopLossExitType === 'PROFIT_PROTECTION' (ADR-0079 BEP 글라이드 영역) */
  isBepProtection: boolean;
}

export function isBepProtectionPolicyDisabled(): boolean {
  return process.env.BEP_PROTECTION_DISABLED === 'true';
}

/**
 * ENV `BEP_TWO_BAR_LIVE_ENABLED` default ON (운영자 명시 활성화 결정 — PR-P0-Activation, 2026-05-06).
 *   - `'false'` 정확 비교 시만 비활성 (ADR-0157 정확 비교 의무)
 *   - 미설정 / `'true'` / 임의 truthy 모두 default ON — LIVE 모드 BEP_PROTECTION 분기 활성화
 *   - 회귀 발견 시 ENV `=false` 1줄 즉시 롤백 → ADR-0085 default OFF 동작 복원
 */
export function isBepTwoBarLiveEnabled(): boolean {
  return process.env.BEP_TWO_BAR_LIVE_ENABLED !== 'false';
}

export function applyTwoBarBepGate(input: TwoBarBepGateInput): TwoBarBepGateResult {
  if (isBepProtectionPolicyDisabled()) {
    return { action: 'SKIP', reason: 'BEP_PROTECTION_DISABLED=true (정책 우회)' };
  }
  if (!input.isBepProtection) {
    return { action: 'SKIP', reason: 'BEP_PROTECTION 분류 아님 — 즉시 청산 위임' };
  }
  const isLive = getTradingMode() === 'LIVE';
  if (isLive && !isBepTwoBarLiveEnabled()) {
    return {
      action: 'SKIP',
      reason: 'LIVE 모드 + BEP_TWO_BAR_LIVE_ENABLED 미설정 — LIVE 회귀 격리',
    };
  }

  const decision = evaluateTwoBarConfirmation({
    currentPrice: input.currentPrice,
    stopLoss: input.hardStopLoss,
    entryPrice: input.shadow.shadowEntryPrice,
    entryATR14: input.shadow.entryATR14,
    isBepProtection: true,
    bepGlideTouchAt: input.shadow.bepGlideTouchAt,
    currentDateKst: kstBusinessDateStr(0),
  });

  if (decision.action === 'PASS') {
    return { action: 'SKIP', reason: decision.reason, decision };
  }
  if (decision.action === 'WAIT') {
    const touchAt = decision.touchAt;
    const needsUpdate = !!touchAt && input.shadow.bepGlideTouchAt !== touchAt;
    return {
      action: 'WAIT',
      shadowUpdate: needsUpdate ? { bepGlideTouchAt: touchAt } : undefined,
      reason: decision.reason,
      decision,
    };
  }
  if (decision.action === 'RESET') {
    const needsUpdate = !!input.shadow.bepGlideTouchAt;
    return {
      action: 'RESET',
      shadowUpdate: needsUpdate ? { bepGlideTouchAt: undefined } : undefined,
      reason: decision.reason,
      decision,
    };
  }
  // CONFIRM_EXIT
  return { action: 'CONTINUE_EXIT', reason: decision.reason, decision };
}
