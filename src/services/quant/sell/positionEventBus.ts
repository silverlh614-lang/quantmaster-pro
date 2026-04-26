// @responsibility quant positionEventBus 엔진 모듈
/**
 * sell/positionEventBus.ts — 포지션 이벤트 단일 버스
 *
 * sellEngine·positionLifecycleEngine·Telegram·OCO 동기화기·감사 로그가
 * 공유하는 단일 이벤트 채널. 신호 중복·알림 누락 같은 현재의 고질병을
 * 구조적으로 제거한다.
 *
 * 설계:
 *   - In-memory Pub/Sub (테스트 용이, 단일 프로세스 내 신호 동기화)
 *   - 순수 모듈 — 외부 I/O 없음, 구독자가 Telegram/KIS 어댑터를 주입
 *   - unsubscribe 반환으로 핸들러 해제 안전
 */

import type { ActivePosition, SellSignal } from '../../../types/sell';
import type { LifecycleStage, LifecycleTransition } from '../../../types/sell';

// ─── 이벤트 타입 ──────────────────────────────────────────────────────────────

export type PositionEventType =
  | 'STOP_HIT'              // L1 하드 손절
  | 'LADDER_TRIGGER'         // L1.5 사다리 단계 도달
  | 'ICHIMOKU_BREACH'        // L5 구름대 이탈
  | 'ROE_DRIFT'              // L2 ROE 퇴행
  | 'PROFIT_TAKE'            // L3 익절
  | 'TRAILING_STOP'          // L3 트레일링
  | 'EUPHORIA_SELL'          // L4 과열
  | 'PRE_MORTEM'             // L2 기타 트리거
  | 'VDA_ALERT'              // L5.5 거래량 마름
  | 'LIFECYCLE_TRANSITION'   // 생애주기 단계 전환
  | 'HIGH_WATER_MARK_UPDATED' // 신고가 갱신 → OCO 재등록 트리거
  | 'SELL_EXECUTED';         // 실제 매도 체결 후 감사 로그용

export interface PositionEvent {
  type: PositionEventType;
  positionId: string;
  stockCode: string;
  /** UTC ms */
  timestamp: number;
  /**
   * 이벤트 원인 신호 또는 생애주기 전환 등 페이로드.
   * 타입별 형태가 다르므로 핸들러가 type 기반으로 narrow하여 소비한다.
   */
  payload: PositionEventPayload;
}

export type PositionEventPayload =
  | { kind: 'SELL_SIGNAL'; signal: SellSignal; position: ActivePosition }
  | { kind: 'LIFECYCLE'; transition: LifecycleTransition; position: ActivePosition }
  | { kind: 'HIGH_WATER_MARK'; newMark: number; previousMark: number; position: ActivePosition }
  | { kind: 'EXECUTION'; signal: SellSignal; position: ActivePosition; executedRatio: number; executedPrice: number };

// ─── 핸들러 & 구독 ────────────────────────────────────────────────────────────

export type PositionEventHandler = (event: PositionEvent) => void | Promise<void>;

interface Subscription {
  /** 특정 이벤트 타입만 구독하려면 배열, 모든 타입이면 undefined */
  types?: readonly PositionEventType[];
  handler: PositionEventHandler;
}

// ─── 버스 구현 ───────────────────────────────────────────────────────────────

/**
 * 단일 프로세스 내 이벤트 버스.
 * 테스트에서 인스턴스를 격리할 수 있도록 class 기반, 기본 export는 전역 싱글톤.
 */
export class PositionEventBus {
  private subscriptions: Subscription[] = [];

  /**
   * 이벤트 구독.
   * @param handler 이벤트 처리 함수
   * @param types 특정 타입만 구독 (생략 시 모든 타입)
   * @returns unsubscribe 함수
   */
  subscribe(handler: PositionEventHandler, types?: readonly PositionEventType[]): () => void {
    const sub: Subscription = { types, handler };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }

  /**
   * 이벤트 발행.
   * 동기 핸들러는 순서 보장, 비동기 핸들러는 fire-and-forget (await 없이 병렬 실행).
   * 한 핸들러 실패가 다른 핸들러를 막지 않도록 try/catch로 격리.
   */
  publish(event: PositionEvent): void {
    for (const sub of this.subscriptions) {
      if (sub.types && !sub.types.includes(event.type)) continue;
      try {
        const ret = sub.handler(event);
        if (ret && typeof (ret as Promise<void>).catch === 'function') {
          (ret as Promise<void>).catch((err: unknown) => {
            console.error('[PositionEventBus] async handler error:', err);
          });
        }
      } catch (err) {
        console.error('[PositionEventBus] sync handler error:', err);
      }
    }
  }

  /** 테스트 격리용 — 모든 구독자 제거 */
  clear(): void {
    this.subscriptions = [];
  }

  /** 현재 구독자 수 (테스트 검증용) */
  get subscriberCount(): number {
    return this.subscriptions.length;
  }
}

// ─── 전역 싱글톤 ──────────────────────────────────────────────────────────────

/**
 * 애플리케이션 전체에서 공유되는 기본 버스.
 * 서버 부팅 시 lifecycleEngine/telegramAdapter/ocoSyncer를 여기에 구독시킨다.
 */
export const positionEventBus = new PositionEventBus();

// ─── 헬퍼: SellSignal → PositionEvent 매핑 ───────────────────────────────────

const ACTION_TO_EVENT_TYPE: Record<SellSignal['action'], PositionEventType> = {
  HARD_STOP: 'STOP_HIT',
  REVALIDATE_GATE1: 'STOP_HIT',
  PRE_MORTEM: 'PRE_MORTEM',
  PROFIT_TAKE: 'PROFIT_TAKE',
  TRAILING_STOP: 'TRAILING_STOP',
  EUPHORIA_SELL: 'EUPHORIA_SELL',
  STOP_LADDER: 'LADDER_TRIGGER',
  ICHIMOKU_EXIT: 'ICHIMOKU_BREACH',
  VDA_ALERT: 'VDA_ALERT',
};

/**
 * SellSignal 배열을 PositionEvent 배열로 변환해 일괄 발행하는 편의 함수.
 * autoTradeEngine의 sell 사이클이 매도 신호 평가 직후 호출한다.
 */
export function publishSellSignals(
  bus: PositionEventBus,
  position: ActivePosition,
  signals: readonly SellSignal[],
  now: number = Date.now(),
): void {
  for (const signal of signals) {
    bus.publish({
      type: ACTION_TO_EVENT_TYPE[signal.action],
      positionId: position.id,
      stockCode: position.stockCode,
      timestamp: now,
      payload: { kind: 'SELL_SIGNAL', signal, position },
    });
  }
}

/** 생애주기 전환을 이벤트로 발행 */
export function publishLifecycleTransition(
  bus: PositionEventBus,
  position: ActivePosition,
  transition: LifecycleTransition,
  now: number = Date.now(),
): void {
  bus.publish({
    type: 'LIFECYCLE_TRANSITION',
    positionId: position.id,
    stockCode: position.stockCode,
    timestamp: now,
    payload: { kind: 'LIFECYCLE', transition, position },
  });
}

/** 신고가 갱신 이벤트 — OCO 재등록 트리거용 */
export function publishHighWaterMark(
  bus: PositionEventBus,
  position: ActivePosition,
  newMark: number,
  previousMark: number,
  now: number = Date.now(),
): void {
  if (newMark <= previousMark) return; // 실제 신고가가 아니면 발행 생략
  bus.publish({
    type: 'HIGH_WATER_MARK_UPDATED',
    positionId: position.id,
    stockCode: position.stockCode,
    timestamp: now,
    payload: { kind: 'HIGH_WATER_MARK', newMark, previousMark, position },
  });
}

// Re-export for consumers
export type { LifecycleStage, LifecycleTransition };
