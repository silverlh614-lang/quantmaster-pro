/**
 * @responsibility 매수 신호 생애주기 상태 전이를 검증하며 관리하는 상태머신을 제공한다.
 */

import {
  emitOperationalWarn,
  type BuyP0WarnCode,
  type OperationalWarnEmitter,
} from './operationalWarn.js';

export type BuySignalState =
  | 'NEW'
  | 'APPROVAL_REQUESTED'
  | 'APPROVED'
  | 'LIVE_ORDER_PENDING'
  | 'LIVE_ORDER_SUBMITTED'
  | 'LIVE_FILLED'
  | 'LIVE_REJECTED'
  | 'SHADOW_ORDER_CREATED'
  | 'SHADOW_PAPER_FILLED'
  | 'SHADOW_POSITION_OPENED'
  | 'SHADOW_REJECTED'
  | 'DUPLICATE_BLOCKED'
  | 'EXPIRED'
  | 'FAILED';

export type BuyExecutionMode = 'LIVE' | 'SHADOW';

export interface BuySignalTransitionRecord {
  from: BuySignalState;
  to: BuySignalState;
  reason: string;
  at: string;
  context?: Record<string, unknown>;
}

export interface BuySignalTransitionResult {
  ok: boolean;
  from: BuySignalState;
  to: BuySignalState;
  state: BuySignalState;
  reason: string;
  skipped?: boolean;
}

export interface BuySignalStateMachineOptions {
  tradeId?: string;
  stockCode?: string;
  stockName?: string;
  mode?: BuyExecutionMode;
  now?: () => Date;
  onWarn?: OperationalWarnEmitter;
}

export interface BuySignalSettleCheckInput {
  mode?: BuyExecutionMode;
  reason?: string;
  context?: Record<string, unknown>;
}

export interface BuySignalSettleCheckResult {
  ok: boolean;
  state: BuySignalState;
  emittedCodes: BuyP0WarnCode[];
}

const ALLOWED_TRANSITIONS: Record<BuySignalState, readonly BuySignalState[]> = {
  NEW: [
    'APPROVAL_REQUESTED',
    'DUPLICATE_BLOCKED',
    'EXPIRED',
    'FAILED',
  ],
  APPROVAL_REQUESTED: [
    'APPROVED',
    'LIVE_REJECTED',
    'SHADOW_REJECTED',
    'DUPLICATE_BLOCKED',
    'EXPIRED',
    'FAILED',
  ],
  APPROVED: [
    'LIVE_ORDER_PENDING',
    'SHADOW_ORDER_CREATED',
    'LIVE_REJECTED',
    'SHADOW_REJECTED',
    'DUPLICATE_BLOCKED',
    'FAILED',
  ],
  LIVE_ORDER_PENDING: [
    'LIVE_ORDER_SUBMITTED',
    'LIVE_REJECTED',
    'FAILED',
  ],
  LIVE_ORDER_SUBMITTED: [
    'LIVE_FILLED',
    'LIVE_REJECTED',
    'FAILED',
  ],
  LIVE_FILLED: [],
  LIVE_REJECTED: [],
  SHADOW_ORDER_CREATED: [
    'SHADOW_PAPER_FILLED',
    'SHADOW_REJECTED',
    'FAILED',
  ],
  SHADOW_PAPER_FILLED: [
    'SHADOW_POSITION_OPENED',
    'SHADOW_REJECTED',
    'FAILED',
  ],
  SHADOW_POSITION_OPENED: [],
  SHADOW_REJECTED: [],
  DUPLICATE_BLOCKED: [],
  EXPIRED: [],
  FAILED: [],
};

const SETTLED_AFTER_APPROVAL_STATES: ReadonlySet<BuySignalState> = new Set([
  'LIVE_ORDER_SUBMITTED',
  'LIVE_FILLED',
  'LIVE_REJECTED',
  'SHADOW_POSITION_OPENED',
  'SHADOW_REJECTED',
  'FAILED',
  // 승인 후 도달 가능한 terminal(전이 불가) 종결 상태 — 정체가 아니라 정상 종결.
  // DUPLICATE_BLOCKED 누락 시: 승인된 SHADOW 매수가 중복으로 정상 차단(shadowBuyExecutor
  // 'duplicate shadow buy blocked')됐을 때 assertSettled 가 미정착으로 오판해
  // P0_BUY_SIGNAL_STUCK + P0_SHADOW_EXECUTION_STUCK 를 false-positive 로 발행하던 결함 차단.
  // EXPIRED 도 동일하게 terminal 종결 상태이므로 정착으로 인정(전이표 변경 대비 방어적 포함).
  'DUPLICATE_BLOCKED',
  'EXPIRED',
]);

export function canTransitionBuySignal(
  from: BuySignalState,
  to: BuySignalState,
): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isBuySignalSettledAfterApproval(state: BuySignalState): boolean {
  return SETTLED_AFTER_APPROVAL_STATES.has(state);
}

export class BuySignalStateMachine {
  private stateValue: BuySignalState = 'NEW';
  private approvedReached = false;
  private readonly now: () => Date;
  private readonly warn: OperationalWarnEmitter;
  private readonly baseContext: Record<string, unknown>;
  private readonly transitionHistory: BuySignalTransitionRecord[] = [];

  constructor(options: BuySignalStateMachineOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.warn = options.onWarn ?? emitOperationalWarn;
    this.baseContext = {
      ...(options.tradeId ? { tradeId: options.tradeId } : {}),
      ...(options.stockCode ? { stockCode: options.stockCode } : {}),
      ...(options.stockName ? { stockName: options.stockName } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
    };
  }

  get state(): BuySignalState {
    return this.stateValue;
  }

  get history(): readonly BuySignalTransitionRecord[] {
    return this.transitionHistory;
  }

  transition(
    to: BuySignalState,
    reason: string,
    context?: Record<string, unknown>,
  ): BuySignalTransitionResult {
    const from = this.stateValue;
    if (from === to) {
      return { ok: true, from, to, state: this.stateValue, reason, skipped: true };
    }

    if (!canTransitionBuySignal(from, to)) {
      this.warn({
        code: 'P0_BUY_APPROVAL_POLICY_VIOLATION',
        message: `Blocked invalid BUY signal transition ${from} -> ${to}`,
        context: {
          ...this.baseContext,
          from,
          to,
          reason,
          ...(context ?? {}),
        },
      });
      return { ok: false, from, to, state: this.stateValue, reason };
    }

    const at = this.now().toISOString();
    this.stateValue = to;
    if (to === 'APPROVED') this.approvedReached = true;
    this.transitionHistory.push({
      from,
      to,
      reason,
      at,
      ...(context ? { context } : {}),
    });
    return { ok: true, from, to, state: this.stateValue, reason };
  }

  assertSettled(input: BuySignalSettleCheckInput = {}): BuySignalSettleCheckResult {
    const emittedCodes: BuyP0WarnCode[] = [];
    if (!this.approvedReached) {
      return { ok: true, state: this.stateValue, emittedCodes };
    }
    if (isBuySignalSettledAfterApproval(this.stateValue)) {
      return { ok: true, state: this.stateValue, emittedCodes };
    }

    this.emitStuckWarn(
      'P0_BUY_SIGNAL_STUCK',
      input.reason ?? 'BUY signal approved but execution did not reach a settled state',
      input,
    );
    emittedCodes.push('P0_BUY_SIGNAL_STUCK');

    const mode = input.mode ?? (this.baseContext.mode as BuyExecutionMode | undefined);
    if (mode === 'LIVE') {
      this.emitStuckWarn(
        'P0_LIVE_EXECUTION_STUCK',
        'LIVE BUY execution stopped after approval before order submission/rejection',
        input,
      );
      emittedCodes.push('P0_LIVE_EXECUTION_STUCK');
    }
    if (mode === 'SHADOW') {
      this.emitStuckWarn(
        'P0_SHADOW_EXECUTION_STUCK',
        'SHADOW BUY execution stopped after approval before paper-fill/open/rejection',
        input,
      );
      emittedCodes.push('P0_SHADOW_EXECUTION_STUCK');
    }

    return { ok: false, state: this.stateValue, emittedCodes };
  }

  private emitStuckWarn(
    code: BuyP0WarnCode,
    message: string,
    input: BuySignalSettleCheckInput,
  ): void {
    this.warn({
      code,
      message,
      context: {
        ...this.baseContext,
        state: this.stateValue,
        approvedReached: this.approvedReached,
        transitionCount: this.transitionHistory.length,
        ...(input.context ?? {}),
      },
    });
  }
}

export function createBuySignalStateMachine(
  options: BuySignalStateMachineOptions = {},
): BuySignalStateMachine {
  return new BuySignalStateMachine(options);
}
