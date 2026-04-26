// @responsibility context 도메인 타입 정의
// ─── SellContext — 매도 레이어가 공유하는 단일 데이터 파이프라인 ───────────────
//
// 모든 매도 레이어(L1~L5 및 향후 추가)는 이 단일 컨텍스트에서 필요한 필드만
// 선택적으로 소비한다. 호출자(autoTradeEngine)는 사이클당 한 번만 컨텍스트를
// 빌드하므로 데이터 페칭 중복이 제거된다.

import type { RegimeLevel, ROEType } from '../core';
import type { ActivePosition } from './position';

/** evaluatePreMortems()에 주입하는 현재 시장 데이터 (하위 호환용) */
export interface PreMortemData {
  currentROEType?: number;       // 현재 ROE 유형 (undefined = 조회 불가, skip)
  foreignNetBuy5d: number;       // 외국인 5일 누적 순매수 (억원, 음수 = 순매도)
  ma20: number;                  // 현재 20일 이동평균
  ma60: number;                  // 현재 60일 이동평균
  currentRegime: RegimeLevel;
}

/** evaluateEuphoria()에 주입하는 과열 지표 데이터 (하위 호환용) */
export interface EuphoriaData {
  rsi14: number;                  // 14일 RSI
  volumeRatio: number;            // 당일 거래량 / 20일 평균 (e.g., 3.0 = 300%)
  retailRatio: number;            // 개인 매수 비율 0~1 (e.g., 0.65 = 65%)
  analystUpgradeCount30d: number; // 30일 내 증권사 목표가 상향 건수
}

/**
 * 매도 사이클 컨텍스트 — 단일 데이터 파이프라인
 *
 * autoTradeEngine 서버는 runSellCycle 진입 시 1회 빌드해 모든 레이어에 주입한다.
 * 각 레이어는 자신이 필요로 하는 필드만 소비하고, 미존재 필드는 자체적으로 skip.
 *
 * Phase 3~4에서 추가되는 필드:
 *   - roeTypeHistory     (ROE 퇴행 단일 출처용)
 *   - assetTurnoverHistory
 *   - candles            (일목균형표용)
 *   - volumeStats        (VDA용)
 */
export interface SellContext {
  /** 평가 대상 포지션 */
  position: ActivePosition;
  /** 현재 레짐 */
  regime: RegimeLevel;

  // ─── L2 Pre-Mortem 데이터 ─────────────────────────────────────────────────
  /** 기존 PreMortemData — 단일 시점 스냅샷 (하위 호환) */
  preMortem: PreMortemData;
  /** ROE 유형 히스토리 (최근→최신). roeEngine.detectROETransition 입력 */
  roeTypeHistory?: ROEType[];
  /** 총자산회전율 히스토리 (QoQ 하락 감지용) */
  assetTurnoverHistory?: number[];

  // ─── L4 과열 데이터 ───────────────────────────────────────────────────────
  /** 당일 데이터 수집 실패 또는 이미 체크 완료 시 null */
  euphoria: EuphoriaData | null;

  // ─── L5 일목균형표 데이터 (Phase 3에서 채워짐) ────────────────────────────
  /** 일목균형표 계산에 필요한 최근 OHLC 캔들 (최소 52봉 필요) */
  candles?: readonly OHLCCandle[];

  // ─── Volume Dry-up Alert (Phase 4) ───────────────────────────────────────
  /** VDA 모듈이 필요로 하는 거래량·변동성 통계 */
  volumeStats?: VolumeStats;
}

// ─── 보조 타입 (Phase 3~4에서 모듈과 공유) ────────────────────────────────────

/** 일봉 OHLC 캔들 — utils/ichimoku에서 공유 */
export interface OHLCCandle {
  /** ISO 8601 날짜 */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** VDA 판정용 거래량·변동성 통계 */
export interface VolumeStats {
  /** 20일 평균 거래량 */
  avgVolume20d: number;
  /** 60일 평균 거래량 */
  avgVolume60d: number;
  /** 20일 종가 표준편차 */
  priceStd20d: number;
  /** 60일 종가 표준편차 */
  priceStd60d: number;
}
