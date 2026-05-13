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
  sendTelegramAlert,
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
  const modeEmoji = params.mode === 'LIVE' ? '🔴' : '⚡';
  const modeLabel = params.mode === 'LIVE' ? 'LIVE' : 'Shadow';
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

  return `${modeEmoji} <b>[${modeLabel}] ${escapeHtml(params.stockName)} 매수 신호</b>\n`
    + `━━━━━━━━━━━━━━━━\n`
    + `현재가: ${formatWon(params.currentPrice)} × ${params.quantity}주\n`
    + `손절: ${formatWon(params.stopLoss)} | 목표: ${formatWon(params.targetPrice)}\n`
    + `RRR: ${formatNullableNumber(rrrRatio, 2)} | Gate: ${formatNullableNumber(params.gateScore, 2)}\n`
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

/**
 * 매수 신호 알림을 인라인 키보드와 함께 전송하고, 사용자 응답을 기다린다.
 * timeout 내 응답 없으면 자동 승인.
 *
 * @returns 'APPROVE' | 'REJECT' | 'SKIP'
 */
export async function requestBuyApproval(params: {
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
}): Promise<ApprovalAction> {
  const {
    tradeId, stockCode, stockName,
    currentPrice, quantity, stopLoss, targetPrice, mode, gateScore, enemyCheck,
    regime, preMortem, signalId, tradeDate, marketSession, sourceLane, rrr,
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
        // 이미 APPROVED 면 'APPROVE' resolve (caller buyPipeline 의 SHADOW 분기 정상 수행).
        // 그 외 (PENDING/REJECTED/SKIPPED/EXPIRED) 는 'SKIP' — caller 가 onRejected 처리.
        return existing.state === 'APPROVED' ? 'APPROVE' : 'SKIP';
      }
      // DEDUPED state 도 같은 session 안에서 새 카드 발송 금지.
      if (existing.state === 'DEDUPED') {
        recordDuplicateSuppressed(stockCode, stockName);
        return 'SKIP';
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

  const msgId = await sendTelegramAlert(message, {
    priority: 'HIGH',
    dedupeKey: `buy_approval:${stockCode}`,
    replyMarkup,
  });

  if (!msgId) {
    // 메시지 전송 실패 시 자동 승인
    console.warn(`[BuyApproval] 메시지 전송 실패 — 자동 승인: ${stockName}`);
    return 'APPROVE';
  }

  return new Promise<ApprovalAction>((resolve) => {
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
}

/**
 * Telegram callbackQuery 처리 — 인라인 키보드 버튼 클릭 시 호출.
 * webhookHandler.ts에서 callback_query를 감지하여 이 함수로 라우팅.
 *
 * @returns true if handled, false if not a buy approval callback
 */
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
    if (action === 'APPROVE') markShadowApprovalApproved(pending.shadowDedupeKey);
    else if (action === 'REJECT') markShadowApprovalRejected(pending.shadowDedupeKey);
    else if (action === 'SKIP') markShadowApprovalSkipped(pending.shadowDedupeKey);
  }

  const actionLabel = action === 'APPROVE' ? '✅ 승인' : action === 'REJECT' ? '❌ 거부' : '⏸ 스킵';
  const actionEmoji = action === 'APPROVE' ? '✅' : action === 'REJECT' ? '❌' : '⏸';

  // Patch-SHADOW-APPROVAL-DEDUP-001 — Shadow 승인 시 사용자 §D 형식
  // (liveOrderPlaced=false / shadowRecorded=true 명시) + LIVE 모드는 기존 메시지 보존.
  const completionMessage =
    pending.mode === 'SHADOW' && action === 'APPROVE'
      ? `${actionEmoji} <b>[Shadow 승인 처리됨]</b> ${escapeHtml(pending.stockName)}\n` +
        `현재가: ${pending.currentPrice.toLocaleString()}원 × ${pending.quantity}주\n` +
        `실매수 주문: 없음\n` +
        `liveOrderPlaced=false\n` +
        `shadowRecorded=true`
      : `${actionEmoji} <b>[${escapeHtml(pending.stockName)}] ${actionLabel} 처리됨</b>\n` +
        `현재가: ${pending.currentPrice.toLocaleString()}원 × ${pending.quantity}주`;

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
