// ─── 매도 엔진 도메인 타입 ─────────────────────────────────────────────────────

import type { StockProfileType, RegimeLevel } from './core';

// ─── 보유 포지션 ──────────────────────────────────────────────────────────────

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

// ─── 매도 신호 ────────────────────────────────────────────────────────────────

export type SellAction =
  | 'HARD_STOP'         // L1: 기계적 손절 (전량 시장가)
  | 'REVALIDATE_GATE1'  // L1: -7% 경보 → Gate 1 재검증 요청
  | 'PRE_MORTEM'        // L2: 펀더멘털 붕괴 조건 발동
  | 'PROFIT_TAKE'       // L3: 분할 익절 타겟 도달
  | 'TRAILING_STOP'     // L3: 트레일링 스톱 발동
  | 'EUPHORIA_SELL';    // L4: 과열 탐지 익절

export interface SellSignal {
  action: SellAction;
  ratio: number;                 // 매도 비율 0~1 (1.0 = 전량)
  orderType: 'MARKET' | 'LIMIT';
  price?: number;                // LIMIT 주문 가격 (MARKET 시 불필요)
  reason: string;                // 텔레그램 알림 메시지용
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// ─── L2 Pre-Mortem 타입 ───────────────────────────────────────────────────────

export type PreMortemType =
  | 'ROE_DRIFT'         // ROE 유형 3 → 4 이상 전이
  | 'FOREIGN_SELLOUT'   // 외국인 5일 연속 순매도
  | 'MA_DEATH_CROSS'    // 20일선 < 60일선 교차
  | 'REGIME_DEFENSE'    // 레짐 R6 전환
  | 'TREND_COLLAPSE';   // 고점 대비 -30% 추세 붕괴

export interface PreMortemTrigger {
  type: PreMortemType;
  severity: 'MEDIUM' | 'HIGH' | 'CRITICAL';
  sellRatio: number;
  reason: string;
}

/** evaluatePreMortems()에 주입하는 현재 시장 데이터 */
export interface PreMortemData {
  currentROEType?: number;       // 현재 ROE 유형 (undefined = 조회 불가, skip)
  foreignNetBuy5d: number;       // 외국인 5일 누적 순매수 (억원, 음수 = 순매도)
  ma20: number;                  // 현재 20일 이동평균
  ma60: number;                  // 현재 60일 이동평균
  currentRegime: RegimeLevel;
}

// ─── L3 익절 타겟 ─────────────────────────────────────────────────────────────

export interface TakeProfitTarget {
  trigger: number | null;        // 수익률 임계값 (null = 트레일링 스톱)
  ratio: number;                 // 해당 트랜치 매도 비율 0~1
  type: 'LIMIT' | 'TRAILING';
  trailPct?: number;             // TRAILING 타입 전용 — 고점 대비 하락 허용 폭
}

// ─── L4 과열 탐지 데이터 ──────────────────────────────────────────────────────

/** evaluateEuphoria()에 주입하는 과열 지표 데이터 */
export interface EuphoriaData {
  rsi14: number;                  // 14일 RSI
  volumeRatio: number;            // 당일 거래량 / 20일 평균 (e.g., 3.0 = 300%)
  retailRatio: number;            // 개인 매수 비율 0~1 (e.g., 0.65 = 65%)
  analystUpgradeCount30d: number; // 30일 내 증권사 목표가 상향 건수
}

// ─── 매도 사이클 컨텍스트 ────────────────────────────────────────────────────

/** runSellCycle() 실행 시 필요한 포트폴리오 수준 상태 */
export interface SellCycleContext {
  positions: ActivePosition[];
  currentRegime: RegimeLevel;
  todayPnLRate: number;          // 당일 손익률 (e.g., -0.025 = -2.5%)
}
