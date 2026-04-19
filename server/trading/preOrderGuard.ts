/**
 * preOrderGuard.ts — Phase 2차 C3: Automated Kill Switch (주문 직전 안전 검증).
 *
 * placeKisMarketBuyOrder 호출 직전에 3가지 안전 조건을 검증하여, 사람이
 * 판단하기 전에 시스템이 자신을 보호한다.
 *
 * 검증 항목:
 *   1. quantity * price > totalAssets * 1.5  → POSITION_EXPLOSION
 *   2. stopLoss >= entryPrice                → STOPLOSS_LOGIC_BROKEN
 *   3. 최근 10분간 동일 종목 주문 ≥ 3회       → ORDER_LOOP_SUSPECT
 *
 * 검증 실패 시:
 *   - incidentLogRepo.recordIncident() 영속화
 *   - setEmergencyStop(true) + cancelAllPendingOrders() (fire-and-forget)
 *   - Telegram CRITICAL 알림
 *   - throw PreOrderGuardError — 호출부는 잡아서 REJECTED 처리
 *
 * 메모리 스파이크(heap) 는 별도 heartbeat 모니터링 경로에서 다룬다 (I/O 집약
 * 주문 경로에서 측정 노이즈 과다).
 */

import { recordIncident } from '../persistence/incidentLogRepo.js';
import { setEmergencyStop } from '../state.js';
import { cancelAllPendingOrders } from '../emergency.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { sendBlastRadiusReport } from '../alerts/contaminationBlastRadius.js';

// ── 임계값 ────────────────────────────────────────────────────────────────────

/** 주문 금액이 총자산의 몇 배를 넘으면 비정상 팽창으로 간주할지. */
const POSITION_EXPLOSION_MULTIPLIER = 1.5;

/** 동일 종목 주문 중복 감지 윈도우 */
const ORDER_LOOP_WINDOW_MS = 10 * 60 * 1000;

/** 윈도우 내 동일 종목 주문 임계치 (이 수 이상이면 loop 의심). */
const ORDER_LOOP_THRESHOLD = 3;

// ── 동일 종목 주문 이력 (메모리, 프로세스 재시작 시 초기화) ───────────────────

const _recentOrders = new Map<string, number[]>();  // stockCode → [timestamp...]

function recordOrderTimestamp(stockCode: string, now: number): number {
  const arr = _recentOrders.get(stockCode) ?? [];
  // 윈도우 밖 타임스탬프 제거
  const cutoff = now - ORDER_LOOP_WINDOW_MS;
  const filtered = arr.filter(t => t >= cutoff);
  filtered.push(now);
  _recentOrders.set(stockCode, filtered);
  return filtered.length;
}

/** 테스트/진단 전용: 이력 초기화. */
export function _resetRecentOrders(): void {
  _recentOrders.clear();
}

// ── 에러 타입 ─────────────────────────────────────────────────────────────────

export type PreOrderGuardReason =
  | 'POSITION_EXPLOSION'
  | 'STOPLOSS_LOGIC_BROKEN'
  | 'ORDER_LOOP_SUSPECT';

export class PreOrderGuardError extends Error {
  constructor(public reason: PreOrderGuardReason, message: string) {
    super(message);
    this.name = 'PreOrderGuardError';
  }
}

// ── 메인 가드 ────────────────────────────────────────────────────────────────

export interface PreOrderContext {
  stockCode:  string;
  stockName:  string;
  quantity:   number;
  entryPrice: number;
  stopLoss:   number;
  /** 총자산 (KIS fetchAccountBalance 결과). null 이면 팽창 검사를 건너뛴다. */
  totalAssets: number | null;
}

/**
 * 주문 직전 최종 안전 검증. 위반 시 부작용:
 *   - incident-log.json 영속화 (샘플 자동 격리 기준)
 *   - setEmergencyStop(true) + cancelAllPendingOrders() 비동기 실행
 *   - Telegram CRITICAL 알림
 *   - PreOrderGuardError throw
 *
 * 호출부는 이 예외를 catch 해서 REJECTED 상태로 마감해야 한다.
 */
export function assertSafeOrder(ctx: PreOrderContext): void {
  // 1) 포지션 비정상 팽창
  if (ctx.totalAssets != null && ctx.totalAssets > 0) {
    const orderValue = ctx.quantity * ctx.entryPrice;
    const limit = ctx.totalAssets * POSITION_EXPLOSION_MULTIPLIER;
    if (orderValue > limit) {
      fireKillSwitch('POSITION_EXPLOSION',
        `${ctx.stockName}(${ctx.stockCode}) 주문가치 ${orderValue.toLocaleString()} > 총자산×${POSITION_EXPLOSION_MULTIPLIER} (${limit.toLocaleString()})`,
        { stockCode: ctx.stockCode, quantity: ctx.quantity, entryPrice: ctx.entryPrice, totalAssets: ctx.totalAssets },
      );
    }
  }

  // 2) 손절 논리 붕괴
  if (ctx.stopLoss >= ctx.entryPrice) {
    fireKillSwitch('STOPLOSS_LOGIC_BROKEN',
      `${ctx.stockName}(${ctx.stockCode}) stopLoss(${ctx.stopLoss}) >= entryPrice(${ctx.entryPrice})`,
      { stockCode: ctx.stockCode, stopLoss: ctx.stopLoss, entryPrice: ctx.entryPrice },
    );
  }

  // 3) 동일 종목 단기 다발 주문 (loop 의심)
  const count = recordOrderTimestamp(ctx.stockCode, Date.now());
  if (count >= ORDER_LOOP_THRESHOLD) {
    fireKillSwitch('ORDER_LOOP_SUSPECT',
      `${ctx.stockName}(${ctx.stockCode}) 최근 10분간 ${count}회 주문 — 무한 루프 의심`,
      { stockCode: ctx.stockCode, count, windowMs: ORDER_LOOP_WINDOW_MS },
    );
  }
}

// ── 내부: kill switch 발사 ───────────────────────────────────────────────────

function fireKillSwitch(
  reason: PreOrderGuardReason,
  message: string,
  context: Record<string, string | number | boolean>,
): never {
  // 1) incident 영속화 (이 시각 이후 Shadow 샘플은 자동 격리)
  const entry = recordIncident('preOrderGuard', message, 'CRITICAL', { reason, ...context });

  // 2) EmergencyStop 설정 — 동기 state 변경
  setEmergencyStop(true);

  // 3) 미체결 주문 취소 + 텔레그램 알림 + 오염 반경 리포트 (비동기 fire-and-forget)
  void (async () => {
    try { await cancelAllPendingOrders(); } catch { /* 이미 best-effort */ }
    await sendTelegramAlert(
      `🚨 <b>[PRE-ORDER KILL SWITCH] ${reason}</b>\n` +
      `시각: ${entry.at}\n` +
      `${message}\n\n` +
      `자동 매매가 중단되었고 미체결 주문은 취소 시도됐습니다. ` +
      `원인 확인 후 수동으로 setEmergencyStop(false) + 재시작하여 복귀하세요.`,
      { priority: 'CRITICAL', dedupeKey: `pre-order-guard-${reason}` },
    ).catch(console.error);
    // 오염 반경 즉시 산정 — 운용자가 "얼마나 격리해야 하나"를 한 눈에.
    await sendBlastRadiusReport(entry.at).catch(console.error);
  })();

  throw new PreOrderGuardError(reason, message);
}
