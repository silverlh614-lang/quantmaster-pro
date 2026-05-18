// @responsibility buyApproval 텔레그램 모듈
/**
 * buyApproval.ts — 매수 신호 인라인 키보드 승인/거부/스킵 처리
 *
 * 매수 신호 발생 시 텔레그램 인라인 버튼을 표시하고,
 * 일정 시간(AUTO_APPROVE_TIMEOUT) 내 응답 없으면 자동 승인 처리.
 *
 * 버튼 구성:
 *   [✅ 승인]  [❌ 거부]  [⏸ 스킵]
 */

import {
  answerCallbackQuery,
  editMessageText,
  escapeHtml,
} from '../alerts/telegramClient.js';
import type { WatchlistEntry } from '../persistence/watchlistRepo.js';
import {
  buildPreMortem,
  formatEnemyCheckSummary,
  type EnemyCheckResult,
  type PreMortem,
} from '../clients/enemyCheckClient.js';
import { formatNullableNumber, formatWon } from '../utils/nullableFormatters.js';
import type { RegimeLevel } from '../../src/types/core.js';
import { markUserApproved, markBlocked } from '../persistence/tradeSignalStatusRepo.js';
import {
  formatLiveBuyExecutionNotice,
  formatShadowBuyAlertTitle,
  formatShadowBuyExecutionNotice,
} from './positionDisplayTags.js';
import { deliverApprovalRequest } from './approval/approvalDeliveryService.js';
import { resolveLiveApprovalPolicy } from './approval/liveApprovalPolicy.js';
import { resolveShadowApprovalPolicy } from './approval/shadowApprovalPolicy.js';
import type {
  ApprovalDecision,
  ApprovalDeliveryResult,
  NormalizedApprovalDecision,
} from './approval/approvalTypes.js';
// Patch-SHADOW-APPROVAL-DEDUP-001 — Shadow approval 중복 발송 차단.
// diagnostic/dedup only — LIVE 매매 본체 무수정, KIS 주문 함수 import 0.
import {
  buildShadowApprovalDedupeKey,
  getShadowApprovalRecord,
  recordPendingShadowApproval,
  markShadowApprovalApproved,
  markShadowApprovalRejected,
  markShadowApprovalSkipped,
  markShadowApprovalAutoApproved,
  recordDuplicateSuppressed,
  type ShadowApprovalSourceLane,
} from './shadowApprovalDedupeStore.js';
import {
  mapShadowApprovalSourceLaneToAuditTriggerSource,
  markShadowGateAuditApprovalState,
  recordShadowApprovalCardAudit,
} from './shadowGateAuditStore.js';

/** 자동 승인까지 대기 시간 (ms) — 기본(레짐 미지정 시) 3분 */
const AUTO_APPROVE_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * 레짐별 자동 승인 타임아웃 (ms).
 *   R1 TURBO   — 빠른 체결이 생명 (1분)
 *   R2 BULL    — 1.5분
 *   R3 EARLY   — 2분
 *   R4 NEUTRAL — 3분 (기존 고정값)
 *   R5 CAUTION — 신중하게 5분
 *   R6 DEFENSE — 자동 승인 없음(수동만) — 사실상 무제한이지만 R6는 상위 레이어에서 매수가 차단되므로 안전
 */
const TIMEOUT_BY_REGIME: Record<RegimeLevel, number> = {
  R1_TURBO:    60_000,
  R2_BULL:     90_000,
  R3_EARLY:   120_000,
  R4_NEUTRAL: 180_000,
  R5_CAUTION: 300_000,
  R6_DEFENSE:      0,  // 0 = 자동 승인 비활성 (수동 승인만 허용)
};

/** 레짐별 타임아웃 조회. 미전달·미지원 레짐 → 기본 3분. */
export function getAutoApproveTimeoutMs(regime?: string): number {
  if (!regime) return AUTO_APPROVE_TIMEOUT_MS;
  const v = TIMEOUT_BY_REGIME[regime as RegimeLevel];
  return v === undefined ? AUTO_APPROVE_TIMEOUT_MS : v;
}

export type ApprovalAction = 'APPROVE' | 'REJECT' | 'SKIP';

export interface BuyApprovalRequestParams {
  tradeId: string;
  stockCode: string;
  stockName: string;
  currentPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  mode: 'LIVE' | 'SHADOW';
  gateScore?: number;
  enemyCheck?: EnemyCheckResult | null;
  regime?: string;
  preMortem?: string | PreMortem | null;
  signalId?: string;
  tradeDate?: string;
  marketSession?: string;
  sourceLane?: ShadowApprovalSourceLane;
  rrr?: number;
  mtas?: number;
  compressionScore?: number;
  signalType?: string;
  gateBandNormal?: number;
  gateBandStrong?: number;
}

export interface BuyApprovalRequestResult {
  action: ApprovalAction;
  telegramDelivered: boolean;
  deliveryFailureReason?: string;
  dedupeBlocked?: boolean;
  approvalDecision?: ApprovalDecision;
  normalizedApproval?: NormalizedApprovalDecision;
  deliveryResult?: ApprovalDeliveryResult;
  approvalDeliveryFailed?: boolean;
  approvalRejected?: boolean;
  approvalExpired?: boolean;
  executionFailed?: boolean;
  statusWriteFailed?: boolean;
}

export function normalizePreMortemForDisplay(preMortem: string | PreMortem | null | undefined): PreMortem | null {
  if (!preMortem) return null;
  if (typeof preMortem !== 'string') return preMortem;
  const lines = preMortem.split('\n').map((line) => line.trim()).filter(Boolean);
  return buildPreMortem({ lines });
}

export function formatPreMortemForDisplay(preMortem: string | PreMortem | null | undefined): string | null {
  const normalized = normalizePreMortemForDisplay(preMortem);
  if (!normalized) return null;
  const title = normalized.source === 'DATA_DRIVEN'
    ? `⚠️ 실패 시나리오(DATA_DRIVEN / ${normalized.confidence})`
    : `⚠️ 실패 시나리오(Shadow 가설 / ${normalized.confidence})`;
  const suffix = normalized.source === 'AI_GENERATED_HYPOTHESIS'
    ? '\n※ 데이터 미검증 가설이며 실거래 판단에는 미반영'
    : '';
  return `${title}\n${normalized.lines.join('\n')}${suffix}`;
}

export function buildBuyApprovalMessage(params: {
  stockName: string;
  currentPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  mode: 'LIVE' | 'SHADOW';
  gateScore?: number;
  enemyCheck?: EnemyCheckResult | null;
  preMortem?: string | PreMortem | null;
  timeoutLine: string;
}): string {
  const header = params.mode === 'LIVE'
    ? `✅ <b>[LIVE 실매수 신호]</b>`
    : formatShadowBuyAlertTitle();
  const executionNotice = params.mode === 'LIVE'
    ? formatLiveBuyExecutionNotice()
    : formatShadowBuyExecutionNotice();
  const risk = params.currentPrice - params.stopLoss;
  const rrrRatio = risk > 0 ? (params.targetPrice - params.currentPrice) / risk : null;
  let enemySummary: string | null = null;
  try {
    enemySummary = params.enemyCheck ? formatEnemyCheckSummary(params.enemyCheck) : null;
  } catch (error) {
    console.warn('[BuyApproval] 역검증 표시 생성 실패 — trading engine 계속 진행', error);
  }
  const enemySection = enemySummary
    ? `━━━━━━━━━━━━━━━━\n<i>[역검증 참고]\n${escapeHtml(enemySummary)}</i>\n`
    : '';
  let preMortemDisplay: string | null = null;
  try {
    preMortemDisplay = formatPreMortemForDisplay(params.preMortem);
  } catch (error) {
    console.warn('[BuyApproval] Pre-Mortem 표시 생성 실패 — trading engine 계속 진행', error);
  }
  const preMortemSection = preMortemDisplay
    ? `━━━━━━━━━━━━━━━━\n${escapeHtml(preMortemDisplay)}\n`
    : '';

  return `${header} ${escapeHtml(params.stockName)} 매수 신호\n`
    + `━━━━━━━━━━━━━━━━\n`
    + `현재가: ${formatWon(params.currentPrice)} × ${params.quantity}주\n`
    + `손절: ${formatWon(params.stopLoss)} | 목표: ${formatWon(params.targetPrice)}\n`
    + `RRR: ${formatNullableNumber(rrrRatio, 2)} | Gate: ${formatNullableNumber(params.gateScore, 2)}\n`
    + `${executionNotice}\n`
    + enemySection
    + preMortemSection
    + `━━━━━━━━━━━━━━━━\n`
    + params.timeoutLine;
}


interface PendingApproval {
  tradeId: string;
  stockCode: string;
  stockName: string;
  currentPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  messageId: number;
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (action: ApprovalAction) => void;
  /** ADR-0077 — 호출자가 buildSignalId 결과를 전달하면 USER_APPROVED/BLOCKED 영속 가능 */
  signalId?: string;
  /** Patch-SHADOW-APPROVAL-DEDUP-001 — Shadow lane dedupe wiring (SHADOW 모드에서만 set). */
  shadowDedupeKey?: string;
  /** Patch-SHADOW-APPROVAL-DEDUP-001 — mode tag for callback path. */
  mode?: 'LIVE' | 'SHADOW';
}

/** 대기 중인 승인 요청 (tradeId → PendingApproval) */
const pendingApprovals = new Map<string, PendingApproval>();

const SYNTHETIC_DELIVERED_APPROVAL: ApprovalDeliveryResult = {
  kind: 'DELIVERED',
  messageId: 'deduped',
};

function resolveApprovalPolicyForMode(
  mode: 'LIVE' | 'SHADOW',
  action: ApprovalAction,
  delivery: ApprovalDeliveryResult,
  reason?: string,
): NormalizedApprovalDecision {
  return mode === 'LIVE'
    ? resolveLiveApprovalPolicy({ action, delivery, reason })
    : resolveShadowApprovalPolicy({ action, delivery, reason });
}

function buildApprovalRequestResult(input: {
  mode: 'LIVE' | 'SHADOW';
  action: ApprovalAction;
  delivery: ApprovalDeliveryResult;
  dedupeBlocked?: boolean;
  reason?: string;
}): BuyApprovalRequestResult {
  const normalizedApproval = resolveApprovalPolicyForMode(
    input.mode,
    input.action,
    input.delivery,
    input.reason,
  );
  return {
    action: normalizedApproval.action,
    telegramDelivered: input.delivery.kind === 'DELIVERED',
    ...(input.delivery.kind === 'DELIVERY_FAILED' ? { deliveryFailureReason: input.delivery.reason } : {}),
    ...(input.dedupeBlocked !== undefined ? { dedupeBlocked: input.dedupeBlocked } : {}),
    approvalDecision: normalizedApproval.decision,
    normalizedApproval,
    deliveryResult: input.delivery,
    approvalDeliveryFailed: normalizedApproval.approvalDeliveryFailed,
    approvalRejected: normalizedApproval.approvalRejected,
    approvalExpired: normalizedApproval.approvalExpired,
    executionFailed: normalizedApproval.executionFailed,
    statusWriteFailed: normalizedApproval.statusWriteFailed,
  };
}

/**
 * 매수 신호 알림을 인라인 키보드와 함께 전송하고, 사용자 응답을 기다린다.
 * timeout 내 응답 없으면 자동 승인.
 *
 * @returns 'APPROVE' | 'REJECT' | 'SKIP'
 */
export async function requestBuyApprovalWithDelivery(params: {
  tradeId: string;
  stockCode: string;
  stockName: string;
  currentPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  mode: 'LIVE' | 'SHADOW';
  gateScore?: number;
  /** 역검증 참고 데이터 — 자동 감점/차단 없이 표시만 함 */
  enemyCheck?: EnemyCheckResult | null;
  /** 레짐별 가변 타임아웃 결정용. 미전달 시 기본 3분. */
  regime?: string;
  /** 매수 실패 시나리오 사전 체크리스트(Gemini Pre-Mortem). 있으면 메시지에 표시. */
  preMortem?: string | PreMortem | null;
  /** ADR-0077 — TradeSignalRecord id (`${signalTimeIso}:${stockCode}`). 전달 시 USER_APPROVED/BLOCKED 영속 */
  signalId?: string;
  /** Patch-SHADOW-APPROVAL-DEDUP-001 — Shadow lane dedupe 키 구성 필드. SHADOW 모드 + 전달 시 dedup guard 활성. */
  tradeDate?: string;
  marketSession?: string;
  sourceLane?: ShadowApprovalSourceLane;
  /** Patch-SHADOW-APPROVAL-DEDUP-001 — RRR (dedupe 진단 lastRrr 기록 용도. dedupeKey 에는 포함 안 됨). */
  rrr?: number;
  /** Patch-SHADOW-GATE-AUDIT-001 — Shadow Gate raw diagnostics (audit only). */
  mtas?: number;
  compressionScore?: number;
  signalType?: string;
  gateBandNormal?: number;
  gateBandStrong?: number;
}): Promise<BuyApprovalRequestResult> {
  const {
    tradeId, stockCode, stockName,
    currentPrice, quantity, stopLoss, targetPrice, mode, gateScore, enemyCheck,
    regime, preMortem, signalId, tradeDate, marketSession, sourceLane, rrr,
    mtas, compressionScore, signalType, gateBandNormal, gateBandStrong,
  } = params;

  // ─── Patch-SHADOW-APPROVAL-DEDUP-001 — Shadow lane dedupe guard ─────────────
  // SHADOW 모드 + dedupe 필수 필드 전달 시에만 활성. LIVE 모드는 본 가드 미적용
  // (LIVE 는 buyPipeline 단에서 이미 entryFailCount/blacklist/cooldown 등 별도 가드).
  // 안전 invariants — diagnostic/dedup only, executionImpact='NONE', liveOrderPlaced=false.
  let shadowDedupeKey: string | undefined;
  if (mode === 'SHADOW' && tradeDate && marketSession) {
    const lane: ShadowApprovalSourceLane = sourceLane ?? 'SHADOW';
    shadowDedupeKey = buildShadowApprovalDedupeKey({
      tradeDate,
      marketSession,
      symbol: stockCode,
      sourceLane: lane,
      approvalKind: 'BUY_APPROVAL',
    });
    const existing = getShadowApprovalRecord(shadowDedupeKey);
    if (existing) {
      const blockingStates = ['PENDING', 'APPROVED', 'REJECTED', 'SKIPPED', 'EXPIRED'] as const;
      if ((blockingStates as readonly string[]).includes(existing.state)) {
        // dedupe — Telegram 장문 발송 금지, logger compact 만.
        recordDuplicateSuppressed(stockCode, stockName);
        // lastSeenAt / lastPrice / lastGateScore / lastRrr 갱신 — record 상태는 보존.
        recordPendingShadowApproval({
          dedupeKey: shadowDedupeKey,
          tradeDate,
          marketSession,
          symbol: stockCode,
          name: stockName,
          sourceLane: lane,
          approvalKind: 'BUY_APPROVAL',
          ...(currentPrice !== undefined ? { price: currentPrice } : {}),
          ...(gateScore !== undefined ? { gateScore } : {}),
          ...(rrr !== undefined ? { rrr } : {}),
        });
        console.log(
          '[ShadowApprovalDedup] duplicate suppressed',
          JSON.stringify({
            symbol: stockCode,
            name: stockName,
            dedupeKey: shadowDedupeKey,
            previousState: existing.state,
            lastPrice: existing.lastPrice,
            newPrice: currentPrice,
            reason: 'ALREADY_APPROVED_OR_PENDING_IN_SESSION',
            executionImpact: 'NONE',
            liveOrderPlaced: false,
          }),
        );
        recordShadowApprovalCardAudit({
          symbol: stockCode,
          name: stockName,
          tradeDate,
          marketSession,
          rawGateScore: gateScore,
          mtas,
          compressionScore,
          rrr,
          signalType,
          gateBandNormal,
          gateBandStrong,
          approvalCardEmitted: false,
          approvalState: 'DEDUPED',
          shadowRecorded: existing.state === 'APPROVED',
          triggerSource: mapShadowApprovalSourceLaneToAuditTriggerSource(lane),
          dedupeKey: shadowDedupeKey,
        });
        // 이미 APPROVED 면 'APPROVE' resolve (caller buyPipeline 의 SHADOW 분기 정상 수행).
        // 그 외 (PENDING/REJECTED/SKIPPED/EXPIRED) 는 'SKIP' — caller 가 onRejected 처리.
        return buildApprovalRequestResult({
          mode,
          action: existing.state === 'APPROVED' ? 'APPROVE' : 'SKIP',
          delivery: SYNTHETIC_DELIVERED_APPROVAL,
          dedupeBlocked: true,
          reason: existing.state === 'APPROVED'
            ? 'DUPLICATE_REQUEST_ALREADY_APPROVED'
            : 'DUPLICATE_APPROVAL_REQUEST_BLOCKED',
        });
      }
      // DEDUPED state 도 같은 session 안에서 새 카드 발송 금지.
      if (existing.state === 'DEDUPED') {
        recordDuplicateSuppressed(stockCode, stockName);
        recordShadowApprovalCardAudit({
          symbol: stockCode, name: stockName, tradeDate, marketSession,
          rawGateScore: gateScore, mtas, compressionScore, rrr, signalType, gateBandNormal, gateBandStrong,
          approvalCardEmitted: false, approvalState: 'DEDUPED', shadowRecorded: false,
          triggerSource: mapShadowApprovalSourceLaneToAuditTriggerSource(lane), dedupeKey: shadowDedupeKey,
        });
        return buildApprovalRequestResult({
          mode,
          action: 'SKIP',
          delivery: SYNTHETIC_DELIVERED_APPROVAL,
          dedupeBlocked: true,
          reason: 'DUPLICATE_APPROVAL_REQUEST_DEDUPED',
        });
      }
    }
    // 새 record 생성 — state='PENDING' 으로 시작. timerId 는 아래에서 setTimeout 후 별도 갱신.
    recordPendingShadowApproval({
      dedupeKey: shadowDedupeKey,
      tradeDate,
      marketSession,
      symbol: stockCode,
      name: stockName,
      sourceLane: lane,
      approvalKind: 'BUY_APPROVAL',
      ...(currentPrice !== undefined ? { price: currentPrice } : {}),
      ...(gateScore !== undefined ? { gateScore } : {}),
      ...(rrr !== undefined ? { rrr } : {}),
    });
    recordShadowApprovalCardAudit({
      symbol: stockCode,
      name: stockName,
      tradeDate,
      marketSession,
      rawGateScore: gateScore,
      mtas,
      compressionScore,
      rrr,
      signalType,
      gateBandNormal,
      gateBandStrong,
      approvalCardEmitted: true,
      approvalState: 'PENDING',
      shadowRecorded: false,
      triggerSource: mapShadowApprovalSourceLaneToAuditTriggerSource(lane),
      dedupeKey: shadowDedupeKey,
    });
  }
  // ──────────────────────────────────────────────────────────────────────────

  const timeoutMs = getAutoApproveTimeoutMs(regime);
  const autoApproveDisabled = timeoutMs === 0;
  const timeoutSec = Math.round(timeoutMs / 1000);
  const timeoutLine = autoApproveDisabled
    ? `<i>🛑 자동 승인 비활성 (레짐 ${escapeHtml(regime ?? '')}) — 수동 승인 필수</i>`
    : `<i>${timeoutSec}초 내 미응답 시 자동 승인${regime ? ` (레짐 ${escapeHtml(regime)})` : ''}</i>`;
  const message = buildBuyApprovalMessage({
    stockName,
    currentPrice,
    quantity,
    stopLoss,
    targetPrice,
    mode,
    gateScore,
    enemyCheck,
    preMortem,
    timeoutLine,
  });

  const replyMarkup = {
    inline_keyboard: [[
      { text: '✅ 승인', callback_data: `buy_approve:${tradeId}` },
      { text: '❌ 거부', callback_data: `buy_reject:${tradeId}` },
      { text: '⏸ 스킵', callback_data: `buy_skip:${tradeId}` },
    ]],
  };

  const deliveryResult = await deliverApprovalRequest({
    message,
    options: {
      priority: 'HIGH',
      dedupeKey: `buy_approval:${stockCode}`,
      replyMarkup,
    },
  });

  if (deliveryResult.kind === 'DELIVERY_FAILED') {
    if (mode === 'SHADOW' && shadowDedupeKey) {
      markShadowApprovalAutoApproved(shadowDedupeKey);
      markShadowGateAuditApprovalState({
        dedupeKey: shadowDedupeKey,
        approvalState: 'APPROVED',
        shadowRecorded: true,
        triggerSource: 'SHADOW_APPROVAL_CARD',
      });
    }
    return buildApprovalRequestResult({
      mode,
      action: 'APPROVE',
      delivery: deliveryResult,
    });
  }

  const msgId = Number(deliveryResult.messageId);

  const action = await new Promise<ApprovalAction>((resolve) => {
    // R6 등 타임아웃 0 → 자동 승인 비활성. 타이머 생성하지 않고 수동 승인만 대기.
    const timer = autoApproveDisabled
      ? (setTimeout(() => { /* no-op */ }, 0) as ReturnType<typeof setTimeout>)
      : setTimeout(async () => {
          const pending = pendingApprovals.get(tradeId);
          if (!pending) return;

          // Patch-SHADOW-APPROVAL-DEDUP-001 — Shadow lane 의 경우 dedupe state 가 PENDING 일
          // 때만 자동 승인 진행. APPROVED/REJECTED/SKIPPED/DEDUPED 면 메시지 발송 0건.
          // (사용자 §E 규약 — timerFiredAfterManualApproval 인 경우 logger 만 남김.)
          if (pending.shadowDedupeKey) {
            const dedupeRec = getShadowApprovalRecord(pending.shadowDedupeKey);
            if (dedupeRec && dedupeRec.state !== 'PENDING') {
              console.log(
                '[ShadowApprovalDedup] auto timer fired after state transition — suppressed',
                JSON.stringify({
                  symbol: pending.stockCode,
                  dedupeKey: pending.shadowDedupeKey,
                  state: dedupeRec.state,
                  reason: 'TIMER_FIRED_AFTER_MANUAL_APPROVAL_OR_TRANSITION',
                  executionImpact: 'NONE',
                  liveOrderPlaced: false,
                }),
              );
              pendingApprovals.delete(tradeId);
              return;
            }
            // PENDING — auto-approval 진행 + state APPROVED 전이.
            markShadowApprovalAutoApproved(pending.shadowDedupeKey);
            markShadowGateAuditApprovalState({
              dedupeKey: pending.shadowDedupeKey,
              approvalState: 'APPROVED',
              shadowRecorded: true,
              triggerSource: 'SHADOW_APPROVAL_CARD',
            });
          }

          pendingApprovals.delete(tradeId);

          // 자동 승인 시 메시지 업데이트
          await editMessageText(
            msgId,
            message.replace(
              timeoutLine,
              `✅ <b>자동 승인 (${timeoutSec}초 타임아웃)</b>`,
            ),
          );

          console.log(`[BuyApproval] 자동 승인 (타임아웃): ${stockName} — ${timeoutSec}초`);
          resolve('APPROVE');
        }, timeoutMs);

    if (autoApproveDisabled) clearTimeout(timer);

    pendingApprovals.set(tradeId, {
      tradeId,
      stockCode,
      stockName,
      currentPrice,
      quantity,
      stopLoss,
      targetPrice,
      messageId: msgId,
      createdAt: Date.now(),
      timer,
      resolve,
      signalId,
      ...(shadowDedupeKey !== undefined ? { shadowDedupeKey } : {}),
      mode,
    });

    // Patch-SHADOW-APPROVAL-DEDUP-001 — dedupe record 의 timerId 갱신 (수동 승인 시 clearTimeout 위함).
    if (shadowDedupeKey && !autoApproveDisabled) {
      const rec = getShadowApprovalRecord(shadowDedupeKey);
      if (rec && rec.state === 'PENDING') {
        // mutate 형태로 timerId 갱신 — Map 내부 reference 직접 갱신.
        rec.timerId = timer;
      }
    }
  });
  return buildApprovalRequestResult({
    mode,
    action,
    delivery: deliveryResult,
  });
}

/**
 * Telegram callbackQuery 처리 — 인라인 키보드 버튼 클릭 시 호출.
 * webhookHandler.ts에서 callback_query를 감지하여 이 함수로 라우팅.
 *
 * @returns true if handled, false if not a buy approval callback
 */
export async function requestBuyApproval(params: BuyApprovalRequestParams): Promise<ApprovalAction> {
  const result = await requestBuyApprovalWithDelivery(params);
  return result.action;
}

export async function handleBuyApprovalCallback(
  callbackQueryId: string,
  data: string,
): Promise<boolean> {
  if (!data.startsWith('buy_approve:') && !data.startsWith('buy_reject:') && !data.startsWith('buy_skip:')) {
    return false;
  }

  const [actionStr, tradeId] = data.split(':');
  const actionMap: Record<string, ApprovalAction> = {
    buy_approve: 'APPROVE',
    buy_reject: 'REJECT',
    buy_skip: 'SKIP',
  };
  const action = actionMap[actionStr];
  if (!action || !tradeId) {
    await answerCallbackQuery(callbackQueryId, '잘못된 요청입니다.');
    return true;
  }

  const pending = pendingApprovals.get(tradeId);
  if (!pending) {
    await answerCallbackQuery(callbackQueryId, '이미 처리된 요청입니다.');
    return true;
  }

  // 타이머 정리 및 맵에서 제거
  clearTimeout(pending.timer);
  pendingApprovals.delete(tradeId);

  // Patch-SHADOW-APPROVAL-DEDUP-001 — Shadow lane dedupe state 전이 + timer clearTimeout.
  // dedupe store 내부 timer 도 함께 cleartimeout (방어). liveOrderPlaced=false 강제.
  if (pending.shadowDedupeKey && pending.mode === 'SHADOW') {
    if (action === 'APPROVE') {
      markShadowApprovalApproved(pending.shadowDedupeKey);
      markShadowGateAuditApprovalState({
        dedupeKey: pending.shadowDedupeKey,
        approvalState: 'APPROVED',
        shadowRecorded: true,
        triggerSource: 'DECISION_BROKER_MANUAL_APPROVAL',
      });
    } else if (action === 'REJECT') {
      markShadowApprovalRejected(pending.shadowDedupeKey);
      markShadowGateAuditApprovalState({
        dedupeKey: pending.shadowDedupeKey,
        approvalState: 'REJECTED',
        shadowRecorded: false,
      });
    } else if (action === 'SKIP') {
      markShadowApprovalSkipped(pending.shadowDedupeKey);
      markShadowGateAuditApprovalState({
        dedupeKey: pending.shadowDedupeKey,
        approvalState: 'SKIPPED',
        shadowRecorded: false,
      });
    }
  }

  const actionLabel = action === 'APPROVE' ? '✅ 승인' : action === 'REJECT' ? '❌ 거부' : '⏸ 스킵';
  const actionEmoji = action === 'APPROVE' ? '✅' : action === 'REJECT' ? '❌' : '⏸';

  // Patch-SHADOW-APPROVAL-DEDUP-001 — Shadow 승인 시 사용자 §D 형식
  // (liveOrderPlaced=false / shadowRecorded=true 명시) + LIVE 모드는 기존 메시지 보존.
  const completionMessage =
    pending.mode === 'SHADOW' && action === 'APPROVE'
      ? `${actionEmoji} <b>[SHADOW 가상매수 승인 처리됨]</b> ${escapeHtml(pending.stockName)}\n` +
        `현재가: ${pending.currentPrice.toLocaleString()}원 × ${pending.quantity}주\n` +
        `실주문 아님 / liveOrderSent=false / executionImpact=NONE\n` +
        `liveOrderPlaced=false\n` +
        `shadowRecorded=true`
      : `${actionEmoji} <b>[${escapeHtml(pending.stockName)}] ${actionLabel} 처리됨</b>\n` +
        `현재가: ${pending.currentPrice.toLocaleString()}원 × ${pending.quantity}주` +
        (pending.mode === 'LIVE' && action === 'APPROVE'
          ? `\n${formatLiveBuyExecutionNotice()}`
          : '');

  await editMessageText(pending.messageId, completionMessage);

  await answerCallbackQuery(callbackQueryId, `${actionLabel} 완료`);
  console.log(`[BuyApproval] ${actionLabel}: ${pending.stockName} (${pending.stockCode})`);

  // ADR-0077 wiring — USER_APPROVED / BLOCKED 영속 (영속 실패 시 매매 결정 차단 안 함)
  if (pending.signalId) {
    try {
      if (action === 'APPROVE') {
        markUserApproved({ id: pending.signalId, approvedBy: 'telegram' });
      } else if (action === 'REJECT') {
        markBlocked({
          id: pending.signalId,
          gate: 'USER_REJECT',
          reason: '사용자 거부 (텔레그램)',
        });
      }
      // SKIP 은 상태 전이 없음 — 같은 신호가 다음 사이클에 다시 평가될 수 있음
    } catch (e) {
      console.warn('[TradeSignalStatus] buyApproval callback wiring failed', e);
    }
  }

  pending.resolve(action);
  return true;
}

/** 대기 중인 승인 요청 수 */
export function getPendingApprovalCount(): number {
  return pendingApprovals.size;
}

/** 특정 종목의 대기 중인 승인 있는지 확인 */
export function hasPendingApproval(stockCode: string): boolean {
  for (const [, p] of pendingApprovals) {
    if (p.stockCode === stockCode) return true;
  }
  return false;
}

/** UI용 대기 승인 목록 — 민감 정보 없이 스냅샷만 반환. */
export function listPendingApprovals(): Array<{
  tradeId: string;
  stockCode: string;
  stockName: string;
  currentPrice: number;
  quantity: number;
  stopLoss: number;
  targetPrice: number;
  createdAt: number;
  ageMs: number;
}> {
  const now = Date.now();
  return Array.from(pendingApprovals.values()).map((p) => ({
    tradeId: p.tradeId,
    stockCode: p.stockCode,
    stockName: p.stockName,
    currentPrice: p.currentPrice,
    quantity: p.quantity,
    stopLoss: p.stopLoss,
    targetPrice: p.targetPrice,
    createdAt: p.createdAt,
    ageMs: now - p.createdAt,
  }));
}

/**
 * UI(관제실)에서 승인/거부 버튼을 눌렀을 때 호출되는 외부 resolver.
 * 텔레그램 callback 과 동일 경로를 거친다 — 타이머 정리 + pending 맵 제거.
 * @returns resolved 여부 (false = 이미 만료/처리됨)
 */
export async function resolvePendingApproval(
  tradeId: string,
  action: ApprovalAction,
  source: 'UI' | 'TELEGRAM' = 'UI',
): Promise<boolean> {
  const pending = pendingApprovals.get(tradeId);
  if (!pending) return false;

  clearTimeout(pending.timer);
  pendingApprovals.delete(tradeId);

  if (pending.shadowDedupeKey && pending.mode === 'SHADOW') {
    if (action === 'APPROVE') {
      markShadowApprovalApproved(pending.shadowDedupeKey);
      markShadowGateAuditApprovalState({ dedupeKey: pending.shadowDedupeKey, approvalState: 'APPROVED', shadowRecorded: true, triggerSource: 'DECISION_BROKER_MANUAL_APPROVAL' });
    } else if (action === 'REJECT') {
      markShadowApprovalRejected(pending.shadowDedupeKey);
      markShadowGateAuditApprovalState({ dedupeKey: pending.shadowDedupeKey, approvalState: 'REJECTED', shadowRecorded: false });
    } else if (action === 'SKIP') {
      markShadowApprovalSkipped(pending.shadowDedupeKey);
      markShadowGateAuditApprovalState({ dedupeKey: pending.shadowDedupeKey, approvalState: 'SKIPPED', shadowRecorded: false });
    }
  }

  const actionLabel = action === 'APPROVE' ? '✅ 승인' : action === 'REJECT' ? '❌ 거부' : '⏸ 스킵';
  const actionEmoji = action === 'APPROVE' ? '✅' : action === 'REJECT' ? '❌' : '⏸';

  // 텔레그램 원본 메시지 업데이트 — 실패해도 UI 경로는 계속.
  await editMessageText(
    pending.messageId,
    `${actionEmoji} <b>[${escapeHtml(pending.stockName)}] ${actionLabel} (${source}) 처리됨</b>\n` +
    `현재가: ${pending.currentPrice.toLocaleString()}원 × ${pending.quantity}주`,
  ).catch(() => { /* 원본 메시지 편집 실패는 치명적이지 않음 */ });

  console.log(`[BuyApproval/${source}] ${actionLabel}: ${pending.stockName} (${pending.stockCode})`);
  pending.resolve(action);
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// ADR-0508 — SIGTERM Graceful Inflight Approval Drain
// ════════════════════════════════════════════════════════════════════════════
//
// 결함: process restart 시점에 모듈 로컬 `pendingApprovals` Map + dedupe store
// (in-memory) 가 휘발 → 사용자가 클릭한 승인 메시지의 Promise 가 영원히 unresolved →
// `await requestBuyApproval` 무한 대기 → Shadow trade 영속 0건 + 다음 사이클 동일
// 종목 카드 재발송 (PR #923 Patch-SHADOW-APPROVAL-DEDUP-001 가 다룬 결함의 *재배포
// 사각지대*).
//
// 정책 (사용자 명시 절대 변경 금지):
//   - 모든 inflight approval 을 'SKIP' 으로 resolve (LIVE / SHADOW 동일)
//   - clearTimeout(timer) 의무 (auto-approval timer 차단, 잔존 타이머 발화 0)
//   - shadowDedupeKey 있으면 markShadowApprovalSkipped (state 전이 + dedupe timer
//     clearTimeout) — 부팅 후 동일 dedupeKey 의 PENDING 흔적 0 보장 (영속 ledger
//     자체는 휘발 in-memory 라 다음 부팅에서 fresh, 그러나 본 PR 의 의미론 일관성
//     보존을 위해 상태 전이 의무)
//   - LIVE 주문 호출 0건 (drain 은 'SKIP' resolve 만, KIS order path 무관)
//   - executionImpact: 'NONE' literal (호출자 측 invariant 자동 충족)
//   - 단일 호출 idempotent (이미 비어 있는 Map 재호출 시 drained=0 + errors=0)
//
// 안전 invariants:
//   - LIVE 매매 본체 0줄 변경 (signalScanner / entryEngine / exitEngine / kisClient
//     / orchestrator / autoTradeEngine / trancheExecutor / buyPipeline 모두 무수정)
//   - KIS 주문 함수 5종 (placeKisMarketOrder / placeKisSellOrder /
//     placeKisStopLossOrder / placeKisTakeProfitOrder / cancelKisOrder) import 0건
//   - autoTradeEngine / orderExecutor / trancheExecutor import 0건
//   - 외부 API (fetch / axios / node-fetch) 호출 0건
//   - Gate threshold + condition weight + STRONG_BUY 조건 + requiredScore + UNKNOWN
//     penalty 변경 0
//   - ENV `INFLIGHT_APPROVAL_DRAIN_DISABLED=true` (default OFF, ADR-0157 정확 비교)
//     1줄 즉시 legacy 동작 (drain skip) 복원
//   - 호출자 측 inline ENV 검사 0건 (`isInflightApprovalDrainDisabled()` SSOT 위임)
//
// ════════════════════════════════════════════════════════════════════════════

export interface InflightApprovalDrainSummary {
  drained: number;
  liveDrained: number;
  shadowDrained: number;
  shadowDedupeKeysMarkedSkipped: number;
  errors: number;
  drainedAtIso: string;
  signal?: string;
  reason: 'GRACEFUL_SHUTDOWN' | 'OPERATOR_INITIATED' | 'TEST';
  executionImpact: 'NONE';
  liveOrderPlaced: false;
  disabled?: boolean;
}

/**
 * ADR-0508 — ENV gate (default OFF, ADR-0157 정확 비교 의무).
 * `=== 'true'` — `'1'` / `'TRUE'` / `'yes'` / 빈 문자열 모두 default 동작 유지.
 */
export function isInflightApprovalDrainDisabled(): boolean {
  return process.env.INFLIGHT_APPROVAL_DRAIN_DISABLED === 'true';
}

/**
 * ADR-0508 — SIGTERM graceful approval drain SSOT.
 *
 * 모든 inflight `pendingApprovals` 를 'SKIP' 으로 resolve + clearTimeout + (SHADOW
 * 모드 + dedupeKey 있을 시) markShadowApprovalSkipped 호출.
 *
 * 호출 시점:
 *   - `server/index.ts` shutdown() 진입 직후 (SIGTERM/SIGINT 양쪽)
 *   - 운영자 수동 트리거 (drain reason='OPERATOR_INITIATED', 후속 PR scope)
 *   - 회귀 테스트 (drain reason='TEST')
 *
 * 단일 호출 idempotent — 이미 비어 있는 Map 재호출 시 drained=0 + errors=0 안전.
 *
 * @returns drain summary (telemetry/test)
 */
export function drainPendingApprovals(opts?: {
  signal?: string;
  reason?: 'GRACEFUL_SHUTDOWN' | 'OPERATOR_INITIATED' | 'TEST';
}): InflightApprovalDrainSummary {
  const drainedAtIso = new Date().toISOString();
  const reason = opts?.reason ?? 'GRACEFUL_SHUTDOWN';
  const signal = opts?.signal;

  if (isInflightApprovalDrainDisabled()) {
    return {
      drained: 0,
      liveDrained: 0,
      shadowDrained: 0,
      shadowDedupeKeysMarkedSkipped: 0,
      errors: 0,
      drainedAtIso,
      signal,
      reason,
      executionImpact: 'NONE',
      liveOrderPlaced: false,
      disabled: true,
    };
  }

  let drained = 0;
  let liveDrained = 0;
  let shadowDrained = 0;
  let shadowDedupeKeysMarkedSkipped = 0;
  let errors = 0;

  // Map 스냅샷 — drain 진행 중 외부 callback 이 동일 Map mutate 하지 않도록 정렬된
  // 키 배열로 작업 (방어적 패턴).
  const tradeIds = Array.from(pendingApprovals.keys());

  for (const tradeId of tradeIds) {
    const pending = pendingApprovals.get(tradeId);
    if (!pending) continue;
    try {
      // 1) auto-approval timer 차단 (SIGTERM 후에도 잔존 타이머 발화 0 보장)
      try { clearTimeout(pending.timer); } catch { /* ignore */ }

      // 2) Shadow dedupe state 전이 — 부팅 후 동일 dedupeKey 의 PENDING 흔적 0
      if (pending.shadowDedupeKey && pending.mode === 'SHADOW') {
        try {
          const transitioned = markShadowApprovalSkipped(pending.shadowDedupeKey);
          if (transitioned) shadowDedupeKeysMarkedSkipped += 1;
        } catch {
          // dedupe store throw 가 drain 전체 차단 금지 — 다음 entry 계속.
          errors += 1;
        }
      }

      // 3) Map 에서 제거 (resolve 보다 먼저 — resolve 가 동기적으로 다른 흐름을
      //    invoke 해도 Map 재방문 영향 0).
      pendingApprovals.delete(tradeId);

      // 4) Promise resolve('SKIP') — 호출자 (buyPipeline.createBuyTask) 가 'SKIP'
      //    경로로 진입 → KIS 주문 호출 0건 + Shadow trade 영속 0건 + tradeSignalStatus
      //    `markBlocked` 호출 0건 (resolve 후 호출자 측 분기 그대로).
      try { pending.resolve('SKIP'); } catch { errors += 1; }

      drained += 1;
      if (pending.mode === 'LIVE') liveDrained += 1;
      else shadowDrained += 1;
    } catch (e) {
      errors += 1;
      try {
        console.warn(
          '[InflightApprovalDrain] error draining tradeId',
          tradeId,
          e instanceof Error ? e.message : String(e),
        );
      } catch { /* ignore */ }
    }
  }

  return {
    drained,
    liveDrained,
    shadowDrained,
    shadowDedupeKeysMarkedSkipped,
    errors,
    drainedAtIso,
    signal,
    reason,
    executionImpact: 'NONE',
    liveOrderPlaced: false,
  };
}
