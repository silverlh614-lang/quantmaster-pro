// ─── 보유 포지션 타입 ─────────────────────────────────────────────────────────

import type { StockProfileType, RegimeLevel } from '../core';

/**
 * 자동매매 엔진이 관리하는 실시간 보유 포지션.
 * 매수 체결 시 생성, 전량 청산 시 제거.
 */
export interface ActivePosition {
  id: string;                    // 고유 ID (e.g., `pos_${Date.now()}_${stockCode}`)
  stockCode: string;
  name: string;
  profile: StockProfileType;     // A/B/C/D — 손절 기준 결정
  entryPrice: number;            // 평균 매수가 (분할 매수 시 가중평균)
  entryDate: string;             // ISO 8601
  currentPrice: number;          // 직전 체결가 / 현재가
  quantity: number;              // 잔여 보유 수량
  entryROEType?: number;         // 매수 시점 ROE 유형 (L2 전이 감지용)
  entryRegime: RegimeLevel;      // 매수 시점 레짐 (익절 기준 결정)

  // 고점 추적 (L3 트레일링 · L2 -30% 붕괴 감지용)
  highSinceEntry: number;        // 매수 이후 고점 (매 사이클 갱신 필요)

  // 트레일링 스톱 상태
  trailingEnabled: boolean;      // 마지막 LIMIT 익절 완료 후 true로 전환
  trailingHighWaterMark: number; // 트레일링 기준 고점 (신고가 갱신 시마다 업데이트)
  trailPct: number;              // 트레일링 거리 (e.g., 0.10 = -10%)
  trailingRemainingRatio: number; // 트레일링 매도 대상 잔여 비율 (e.g., 0.40)

  // Gate 1 재검증 상태 (-7% 도달 시 재검증 → 중복 방지)
  revalidated: boolean;

  // MA 전일 상태 (데드크로스 감지 — 이전 체크 시점 값 보관)
  prevMa20?: number;
  prevMa60?: number;

  // 익절 완료 추적 (중복 실행 방지)
  takenProfit: number[];         // 실현된 trigger 값 목록 (e.g., [0.12, 0.20])
}
