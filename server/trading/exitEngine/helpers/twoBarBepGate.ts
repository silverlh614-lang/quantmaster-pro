// @responsibility BEP_PROTECTION 영역 Two-Bar Confirmation Gate 평가 SSOT 헬퍼
/**
 * exitEngine/helpers/twoBarBepGate.ts — ADR-0085 §트랙 1 BEP 글라이드 Two-Bar
 * Confirmation 의 hardStopLoss wiring 진입점 (PR-B1-1, 지침서 7843c96f).
 *
 * `evaluateTwoBarConfirmation` 정책 함수 (ADR-0085 PR-C 트랙 1 인프라) 위에
 * 호출자 (hardStopLoss.ts) 가 사용하는 *액션 판정 + shadow update payload 합성*
 * 단일 SSOT.
 *
 * 우선순위 (결정 트리, ADR-0625 §2.4 재구조화):
 *   1. ENV `BEP_PROTECTION_DISABLED=true` → SKIP (정책 우회, 즉시 청산 진행)
 *   2. isBepProtection=true → 기존 BEP 2-bar 경로 (BEP_TWO_BAR_LIVE_ENABLED·기존 동작 100% 보존)
 *   3. isBepProtection=false 이고 손실초기 확대 게이트(a∧b∧c∧d) 충족 →
 *      신규 INITIAL_LOSS 2-bar 경로 (evaluateTwoBarConfirmation({isBepProtection:true}) 재사용·SHADOW 한정)
 *      - (a) ENV `SHAKEOUT_INITIAL_LOSS_TWOBAR_SHADOW_ENABLED === 'true'`
 *      - (b) `getTradingMode() !== 'LIVE'` (=SHADOW/PAPER) — LIVE 는 절대 우회 안 함 (불변식 #8·byte-equivalent)
 *      - (c) `stopLossExitType ∈ {INITIAL, REGIME, INITIAL_AND_REGIME}` (손실초기, PROFIT_PROTECTION 아님)
 *      - (d) 깊은하락 미발동: `returnPct > SHAKEOUT_INITIAL_LOSS_DEEP_DROP_BYPASS_PCT(-12.0)`
 *        (`returnPct <= -12%` 깊은하락=진짜 추세반전 가능성 → SKIP·기존 wick 즉시손절 유지)
 *   4. 그 외(isBepProtection=false 이고 확대 게이트 미충족) → SKIP (=기존 즉시 청산, byte-equivalent)
 *
 * 2-bar 경로(2/3) 내 evaluateTwoBarConfirmation 결과 분기:
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
  /** ADR-0625 — 손실초기 확대 게이트 분류용 (additive). */
  stopLossExitType?: 'INITIAL' | 'REGIME' | 'INITIAL_AND_REGIME' | 'PROFIT_PROTECTION';
  /** ADR-0625 — 깊은하락 우회 판정용 returnPct (additive). */
  returnPct?: number;
}

export function isBepProtectionPolicyDisabled(): boolean {
  return process.env.BEP_PROTECTION_DISABLED === 'true';
}

/**
 * ADR-0625 §2.4-d — 깊은하락 우회 임계 SSOT (본문 명시·하드코딩 금지·드리프트 차단).
 * `returnPct <= -12%` (깊은 하락=진짜 추세반전 가능성) 면 close-confirm 우회 → 즉시 손절 유지.
 */
export const SHAKEOUT_INITIAL_LOSS_DEEP_DROP_BYPASS_PCT = -12.0;

/**
 * ENV `SHAKEOUT_INITIAL_LOSS_TWOBAR_SHADOW_ENABLED=true` 정확 비교 (ADR-0157), default OFF.
 *   - `'1'` / `'TRUE'` / 임의 truthy 모두 거부 — 운영자 명시 활성화 의무.
 *   - OFF → 손실초기 확대 게이트 미진입 → 기존 wick 즉시손절 byte-equivalent.
 */
export function isInitialLossTwoBarShadowEnabled(): boolean {
  return process.env.SHAKEOUT_INITIAL_LOSS_TWOBAR_SHADOW_ENABLED === 'true';
}

/**
 * ADR-0625 §2.4-3 — 손실초기 2-bar 확대 게이트 (a∧b∧c∧d 모두 참이면 true).
 *   (a) ENV ON, (b) getTradingMode() !== 'LIVE', (c) stopLossExitType ∈ 손실초기,
 *   (d) returnPct > DEEP_DROP_BYPASS_PCT (깊은하락 미발동).
 * 어느 하나라도 거짓이면 false → 호출자는 기존 즉시 청산(SKIP, byte-equivalent).
 */
function isInitialLossExpansionGateOpen(input: TwoBarBepGateInput): boolean {
  // (a) ENV
  if (!isInitialLossTwoBarShadowEnabled()) return false;
  // (b) LIVE 절대 우회 금지 (불변식 #8·byte-equivalent)
  if (getTradingMode() === 'LIVE') return false;
  // (c) 손실초기 (PROFIT_PROTECTION 아님)
  const t = input.stopLossExitType;
  if (t !== 'INITIAL' && t !== 'REGIME' && t !== 'INITIAL_AND_REGIME') return false;
  // (d) 깊은하락 미발동 — returnPct 부재/비정상이면 보수적으로 우회(=즉시손절, 불변식 #6)
  const r = input.returnPct;
  if (typeof r !== 'number' || !Number.isFinite(r)) return false;
  if (r <= SHAKEOUT_INITIAL_LOSS_DEEP_DROP_BYPASS_PCT) return false;
  return true;
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

/**
 * evaluateTwoBarConfirmation 호출 + TwoBarBepGateResult 매핑 (BEP·INITIAL_LOSS 공용).
 * 두 경로 모두 정책 함수 입장에선 "2-bar 적용 영역" → `isBepProtection: true` 로 전달
 * (손실초기 게이트가 이미 SHADOW·INITIAL·얕은하락을 통과시킨 뒤). 두 번째 2-bar 산식 신설 0.
 */
function runTwoBarConfirmation(input: TwoBarBepGateInput): TwoBarBepGateResult {
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

export function applyTwoBarBepGate(input: TwoBarBepGateInput): TwoBarBepGateResult {
  // 1. BEP_PROTECTION_DISABLED → SKIP (정책 우회, 즉시 청산 진행).
  if (isBepProtectionPolicyDisabled()) {
    return { action: 'SKIP', reason: 'BEP_PROTECTION_DISABLED=true (정책 우회)' };
  }

  // 2. isBepProtection=true → 기존 BEP 2-bar 경로 (기존 동작 100% 보존).
  if (input.isBepProtection) {
    const isLive = getTradingMode() === 'LIVE';
    if (isLive && !isBepTwoBarLiveEnabled()) {
      return {
        action: 'SKIP',
        reason: 'LIVE 모드 + BEP_TWO_BAR_LIVE_ENABLED 미설정 — LIVE 회귀 격리',
      };
    }
    return runTwoBarConfirmation(input);
  }

  // 3. isBepProtection=false 이고 손실초기 확대 게이트(a∧b∧c∧d) 충족 →
  //    신규 INITIAL_LOSS 2-bar 경로 (SHADOW 한정·정책 함수 재사용).
  if (isInitialLossExpansionGateOpen(input)) {
    return runTwoBarConfirmation(input);
  }

  // 4. 그 외 → SKIP (=기존 즉시 청산, byte-equivalent).
  return { action: 'SKIP', reason: 'BEP_PROTECTION 분류 아님 — 즉시 청산 위임' };
}
