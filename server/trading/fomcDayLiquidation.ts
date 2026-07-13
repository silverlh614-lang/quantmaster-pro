// @responsibility FOMC DAY 청산 모듈 — 제거됨 (FOMC_LIQUIDATION_REMOVED). Stub only.

import type { LiquidationGuardReason } from './fomcCalendar.js';

interface LiquidationItemResult {
  tradeId: string;
  stockCode: string;
  stockName: string;
  qty: number;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  reason?: string;
}

export interface FomcLiquidationResult {
  /** 가드 통과 후 실제 루프 진입 여부 — false 면 guardReason 으로 차단 사유. */
  executed: boolean;
  guardReason: LiquidationGuardReason;
  totalActive: number;
  results: LiquidationItemResult[];
  successCount: number;
  failedCount: number;
  dryRun: boolean;
}

/**
 * FOMC DAY 청산이 제거되었습니다. 항상 skipped 결과를 반환합니다.
 */
export async function liquidateAllForFomc(
  _now: Date = new Date(),
  _opts?: { dryRunOverride?: boolean },
): Promise<FomcLiquidationResult> {
  return {
    executed: false,
    guardReason: 'DISABLED',
    totalActive: 0,
    results: [],
    successCount: 0,
    failedCount: 0,
    dryRun: false,
  };
}

export interface LiquidationResultMessageInput {
  totalActive: number;
  results: LiquidationItemResult[];
  successCount: number;
  failedCount: number;
  dryRun: boolean;
}

/** 청산 결과 텔레그램 메시지 빌더 (단위 테스트 가능). */
export function formatLiquidationResultMessage(input: LiquidationResultMessageInput): string {
  const header = input.dryRun
    ? '[FOMC DAY 청산 — dryRun]'
    : input.failedCount > 0
      ? '[FOMC DAY 청산 — 일부 실패]'
      : '[FOMC DAY 청산 완료]';

  const summary = input.dryRun
    ? `대상: ${input.totalActive}건 (실행 안 됨)`
    : `성공: ${input.successCount}건 / 실패: ${input.failedCount}건 (총 ${input.totalActive}건)`;

  const tail = !input.dryRun && input.failedCount > 0
    ? `\n실패 종목 수동 청산 필요`
    : '';

  return `${header}\n${summary}${tail}`;
}

/**
 * FOMC 청산 제거됨. no-op stub.
 */
export async function runFomcDayMorningAlert(_now: Date = new Date()): Promise<void> {
  // FOMC_LIQUIDATION_REMOVED — no-op
}

/**
 * FOMC 청산 제거됨. no-op stub.
 */
export async function runFomcDayPreLiquidationAlert(_now: Date = new Date()): Promise<void> {
  // FOMC_LIQUIDATION_REMOVED — no-op
}
