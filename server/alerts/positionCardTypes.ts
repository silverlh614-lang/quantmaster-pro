// @responsibility Position Card source/mode/cardType/payload/validation 타입 SSOT (ADR-0504).
/**
 * positionCardTypes.ts — Telegram Position Card 타입 SSOT (ADR-0504).
 *
 * `PositionSource` 2-value union 강제 — `BROKER_BALANCE` (실계좌 잔고) /
 * `SHADOW_POSITION_LEDGER` (Shadow 포지션 원장). 그 외 source string
 * (`WATCHLIST` / `RECOMMENDATION_HISTORY` / `SHADOW_CANDIDATE` / `RESERVED_ORDER` /
 * `COUNTERFACTUAL` / `PREVIOUS_TELEGRAM_CACHE` / `LAST_KNOWN_POSITIONS` /
 * `MORNING_SCAN_RESULT`) 는 validator 가 런타임 차단.
 */

/** Position Card 의 source layer SSOT. 그 외 값 영구 차단. */
export type PositionSource = 'BROKER_BALANCE' | 'SHADOW_POSITION_LEDGER';

/** Position Card 의 mode (REAL = 실계좌 잔고, SHADOW = Shadow 원장). */
export type PositionCardMode = 'REAL' | 'SHADOW';

/**
 * Position Card 의 cardType:
 *   POSITION_MORNING_CARD — 09:05 KST 자동 발송 (positionMorningCard.ts)
 *   POSITION_STATUS_CARD  — `/pos` 텔레그램 명령 응답 (pos.cmd.ts) + positionsRouter
 */
export type PositionCardCardType = 'POSITION_MORNING_CARD' | 'POSITION_STATUS_CARD';

/**
 * 카드 발송 시점의 execution impact:
 *   NONE  — SHADOW 카드 (실 주문 0건, 학습 표본 무관)
 *   PAPER — PAPER trading 모드 (현재 미구현, 후속 PR scope)
 *   LIVE  — 실계좌 잔고 (BROKER_BALANCE 만)
 */
export type PositionCardExecutionImpact = 'NONE' | 'PAPER' | 'LIVE';

export interface PositionCardPosition {
  stockCode: string;
  stockName: string;
  source: PositionSource;
  qty: number;
  avgEntryPrice?: number | null;
  currentPrice?: number | null;
  pnlPct?: number | null;
  entryDate?: string | null;
  /** dedupe / lot-aggregate 용 식별자 (옵셔널 — Phase 1 미사용). */
  lotId?: string | null;
}

export interface PositionCardPayload {
  cardType: PositionCardCardType;
  mode: PositionCardMode;
  positions: PositionCardPosition[];
  summary: { count: number; aggregateCount?: number };
  executionImpact: PositionCardExecutionImpact;
}

export type PositionCardValidationError =
  | 'INVALID_SHADOW_POSITION_SOURCE'
  | 'INVALID_REAL_POSITION_SOURCE'
  | 'POSITION_COUNT_MISMATCH'
  | 'INVALID_POSITION_SOURCE_BLOCKED';

export type PositionCardValidationResult =
  | { ok: true }
  | { ok: false; error: PositionCardValidationError; details: string };

/**
 * Forbidden source string literals — validator 가 source 필드에 들어왔을 때
 * 런타임 차단 (TypeScript 가 PositionSource 2-value union 만 허용하므로
 * runtime cast 우회 시도를 검출).
 */
export const FORBIDDEN_POSITION_SOURCES = Object.freeze<readonly string[]>([
  'WATCHLIST',
  'RECOMMENDATION_HISTORY',
  'SHADOW_CANDIDATE',
  'RESERVED_ORDER',
  'COUNTERFACTUAL',
  'PREVIOUS_TELEGRAM_CACHE',
  'LAST_KNOWN_POSITIONS',
  'MORNING_SCAN_RESULT',
]);
