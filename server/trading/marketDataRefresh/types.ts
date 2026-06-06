// @responsibility ADR-0580 marketDataRefresh type declarations (extracted for ACMA 1500-line limit; type-only, byte-equivalent)

import type { MacroState } from '../../persistence/macroStateRepo.js';

type MacroRefreshReason = 'SCHEDULED' | 'MANUAL' | 'R6_RECOVERY_CHECK';
type ProgramMarketRawUnitAssumption = 'UNVERIFIED' | 'KRW' | 'KRW_1K' | 'KRW_1M';
type ProgramMarketFinalStatus =
  | 'OFFICIAL_PARAMS_VERIFIED'
  | 'SINGLE_RESPONSE_VERIFIED'
  | 'SNAPSHOT_INCONSISTENT'
  | 'UNIT_UNVERIFIED'
  | 'MAPPING_VERIFIED';
type MarketRefreshComputed = Partial<MacroState>;

/**
 * 공매도 비율 데이터 출처 — Phase 1 운영 가시화. KRX_DIRECT/KRX_OTP(L1) ·
 * KIS_PROXY(L1, ADR-0543 daily-short-sale 프록시 ETF, ENV gated) · KIS_ESTIMATE(L4 휴리스틱, 최후).
 */
export type ShortSellingSource = 'KRX_DIRECT' | 'KRX_OTP' | 'KIS_PROXY' | 'KIS_ESTIMATE';

export interface ShortSellingResult {
  /** 공매도 비율 (%) */
  ratio: number;
  /** 어느 fallback 단계에서 데이터를 얻었는지 */
  source: ShortSellingSource;
  /** 조회 성공 시각 (ISO) — 운영자가 신선도 확인 */
  fetchedAt: string;
}

/** Yahoo Finance 일봉 원본 — close / timestamp 정렬쌍. 실패 시 null. */
export interface DailyBar {
  /** Unix epoch seconds (Yahoo 원본 단위) */
  ts: number;
  close: number;
  open?: number;
  high?: number;
  low?: number;
}

export interface YahooHealthSnapshot {
  lastSuccessAt: number;     // epoch ms (0 = 미수집)
  lastFailureAt: number;     // epoch ms (0 = 실패 없음)
  consecutiveFailures: number;
  /** 'OK' | 'STALE' | 'DOWN' | 'UNKNOWN' — 호출자 편의를 위해 사전 분류. */
  status: 'OK' | 'STALE' | 'DOWN' | 'UNKNOWN';
}

export type {
  MacroRefreshReason,
  ProgramMarketRawUnitAssumption,
  ProgramMarketFinalStatus,
  MarketRefreshComputed,
};
