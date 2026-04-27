// @responsibility quant trailingOcoSyncer 엔진 모듈
/**
 * sell/trailingOcoSyncer.ts — 트레일링 OCO 동적 갱신 엔진
 *
 * 매수 시점에 등록된 OCO 손절가는 고정이지만, trailingHighWaterMark가 갱신되면
 * 손절가도 같이 끌어올려야 트레일링이 실제로 작동한다.
 *
 * 이 모듈은 "새 손절가 계산"까지만 담당하는 순수 로직이다.
 * KIS API 호출(cancel + re-register)은 호출자(autoTradeEngine)가 주입하는
 * OcoAdapter 인터페이스로 위임한다. 실패 시 Telegram 알림은 버스로 발행.
 */

import type { ActivePosition } from '../../../types/sell';
import type { PositionEventBus } from './positionEventBus';

// ─── OCO 어댑터 인터페이스 ────────────────────────────────────────────────────

/**
 * 호출자(autoTradeEngine)가 KIS API 구현을 주입한다.
 * 테스트에서는 in-memory 스텁으로 갈아끼움.
 */
export interface OcoAdapter {
  /** 기존 OCO 주문 취소 (ordNo 식별) — true=성공 */
  cancelOrder(stockCode: string, ordNo: string, quantity: number): Promise<boolean>;
  /** 새 손절가로 OCO 재등록 — 신규 ordNo 또는 null(실패) */
  registerStopLoss(stockCode: string, stockName: string, quantity: number, stopPrice: number): Promise<string | null>;
}

// ─── 새 손절가 계산 ──────────────────────────────────────────────────────────

/**
 * 트레일링 손절가 계산.
 * stopPrice = trailingHighWaterMark × (1 − trailPct)
 *
 * 단, 진입가 아래로 내려가면 매수 시점 원 손절가 대비 lock-in 보호 적용:
 *   - 수익 +5% 이상 달성 구간에서는 손절가를 진입가 위로 끌어올려 BEP 보호
 *   - 그렇지 않으면 원 손절가(entryStopPrice) 유지
 */
export interface TrailingStopInput {
  position: ActivePosition;
  /** 원래 매수 시점에 등록된 손절가 */
  entryStopPrice: number;
}

export interface TrailingStopCalcResult {
  /** 갱신 권장 손절가 */
  newStopPrice: number;
  /** 이전 손절가(= entryStopPrice)와 같으면 갱신 불필요 */
  shouldUpdate: boolean;
  /** BEP 보호 발동 여부 (+5% 수익 이상에서 손절가를 진입가 위로) */
  bepProtectionActive: boolean;
}

export function calcTrailingStopPrice(input: TrailingStopInput): TrailingStopCalcResult {
  const { position, entryStopPrice } = input;

  const high = position.trailingHighWaterMark;
  const trailPct = position.trailPct;
  const rawTrailStop = high * (1 - trailPct);

  // BEP 보호: +5% 이상일 때 손절가 최소 하한을 진입가로
  const currentReturn = (position.currentPrice - position.entryPrice) / position.entryPrice;
  const bepProtectionActive = currentReturn >= 0.05;

  let newStopPrice = rawTrailStop;
  if (bepProtectionActive) {
    newStopPrice = Math.max(newStopPrice, position.entryPrice);
  } else {
    // 트레일링 손절가가 원 손절가보다 내려가면 원 손절가 사용 (손실 확대 금지)
    newStopPrice = Math.max(newStopPrice, entryStopPrice);
  }

  const shouldUpdate = newStopPrice > entryStopPrice;

  return {
    newStopPrice: Math.round(newStopPrice),
    shouldUpdate,
    bepProtectionActive,
  };
}

// ─── 실행 (어댑터 주입형) ────────────────────────────────────────────────────

export interface SyncTrailingOcoOptions {
  position: ActivePosition;
  entryStopPrice: number;
  /** 기존 OCO 손절 주문 번호 (KIS ordNo) */
  existingOrdNo: string;
  adapter: OcoAdapter;
  /** 선택적 이벤트 버스 — 실패 시 경보 이벤트 발행 */
  bus?: PositionEventBus;
}

export interface SyncTrailingOcoResult {
  status: 'SKIPPED' | 'UPDATED' | 'CANCEL_FAILED' | 'REGISTER_FAILED';
  /** 갱신 성공 시 신규 ordNo */
  newOrdNo?: string;
  newStopPrice: number;
  message: string;
}

/**
 * 신고가 갱신 직후 OCO를 동기화.
 * 취소/재등록이 순차 실행되며, 중간 실패 시 버스로 CRITICAL 이벤트 발행 (수동 개입 요청).
 */
export async function syncTrailingOco(opts: SyncTrailingOcoOptions): Promise<SyncTrailingOcoResult> {
  const calc = calcTrailingStopPrice({
    position: opts.position,
    entryStopPrice: opts.entryStopPrice,
  });

  if (!calc.shouldUpdate) {
    return {
      status: 'SKIPPED',
      newStopPrice: calc.newStopPrice,
      message: '신 손절가가 기존 손절가 이하 — 갱신 불필요',
    };
  }

  // 1) 기존 OCO 손절 취소
  const cancelled = await opts.adapter.cancelOrder(
    opts.position.stockCode,
    opts.existingOrdNo,
    opts.position.quantity,
  );

  if (!cancelled) {
    emitCriticalFailure(opts, 'OCO 손절 취소 실패 — 수동 확인 필요');
    return {
      status: 'CANCEL_FAILED',
      newStopPrice: calc.newStopPrice,
      message: '기존 OCO 주문 취소 실패',
    };
  }

  // 2) 새 손절가로 재등록
  const newOrdNo = await opts.adapter.registerStopLoss(
    opts.position.stockCode,
    opts.position.name,
    opts.position.quantity,
    calc.newStopPrice,
  );

  if (!newOrdNo) {
    emitCriticalFailure(opts, `OCO 재등록 실패 — 현재 손절 보호 없음 (stockCode=${opts.position.stockCode})`);
    return {
      status: 'REGISTER_FAILED',
      newStopPrice: calc.newStopPrice,
      message: '신 손절가 재등록 실패 — 손절 보호 없음',
    };
  }

  return {
    status: 'UPDATED',
    newOrdNo,
    newStopPrice: calc.newStopPrice,
    message: `OCO 손절가 갱신 완료: ${calc.newStopPrice.toLocaleString()}원`
      + (calc.bepProtectionActive ? ' (BEP 보호 활성)' : ''),
  };
}

function emitCriticalFailure(opts: SyncTrailingOcoOptions, reason: string): void {
  if (!opts.bus) return;
  opts.bus.publish({
    type: 'SELL_EXECUTED',
    positionId: opts.position.id,
    stockCode: opts.position.stockCode,
    timestamp: Date.now(),
    payload: {
      kind: 'EXECUTION',
      signal: {
        action: 'HARD_STOP',
        ratio: 0,
        orderType: 'MARKET',
        severity: 'CRITICAL',
        reason: `[OCO Sync 실패] ${reason}`,
      },
      position: opts.position,
      executedRatio: 0,
      executedPrice: opts.position.currentPrice,
    },
  });
}
