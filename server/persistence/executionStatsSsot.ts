// @responsibility execution stats 5분류 SSOT 7일 윈도우 산출 단일 진입점
/**
 * ADR-0391 P0-A §A-5 — 5분류 통계 SSOT.
 *
 * 사용자 명시: "ghost 한 카테고리가 모든 미실행을 흡수하던 결함 차단".
 * 5분류 분리:
 *   - shadowRecorded   : 모든 ServerShadowTrade (모든 모드 always-on)
 *   - paperBuyRecorded : mode === 'PAPER'/'VTS' (영속 schema 부재 — P1 wiring 후 활성화)
 *   - liveOrderSent    : mode === 'LIVE'
 *   - liveBlocked      : LIVE 모드 한정 차단 (placeholder, P1 wiring 후 활성화)
 *   - ghost            : loadGhostPortfolio() (워치리스트 → 거래 미연결)
 *
 * P0-A 단계 — 영속 schema 변경 0. mode='PAPER'/'liveBlocked' 카운트는 0 placeholder
 * (현재 ServerShadowTrade.mode 가 'LIVE' | 'SHADOW' 만 지원, P1 ExecutionMode 도입 시 활성화).
 *
 * 후속 ADR-0263 (P1) 에서 ShadowDecisionRecord 영속 schema 도입 후 5 카운터 모두 정확화.
 */

import { loadShadowTrades, type ServerShadowTrade } from './shadowTradeRepo.js';
import { loadGhostPortfolio } from './reflectionRepo.js';

/** 5분류 통계 — `/exec_matrix` 명령 + 후속 진단 도구 단일 입력. */
export interface ExecutionStats7d {
  /** 모든 ServerShadowTrade — 모든 모드 always-on 학습 베이스라인. */
  readonly shadowRecorded: number;
  /** PAPER/VTS 가상 체결 (P0-A 단계 placeholder, P1 wiring 후 활성화). */
  readonly paperBuyRecorded: number;
  /** LIVE KIS 실주문 발사. */
  readonly liveOrderSent: number;
  /** LIVE 모드인데 차단됨 (P0-A 단계 placeholder, P1 wiring 후 활성화). */
  readonly liveBlocked: number;
  /** 워치리스트 → 거래 미연결 (학습 도구). */
  readonly ghost: number;
  /** 평가된 총 신호 (shadowRecorded + ghost). */
  readonly evaluated: number;
}

/** 7일 윈도우 ms — 사용자 명시 "actual 7d". */
export const EXECUTION_STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ServerShadowTrade 의 signalTime / GhostPosition 의 signalDate 가 윈도우 안인지 검증.
 * 잘못된 ISO / NaN 안전 fallback false.
 */
function isWithinWindow(iso: string | undefined, cutoffMs: number): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return false;
  return ts >= cutoffMs;
}

/**
 * mode 분류 — ServerShadowTrade.mode 옵셔널 + 'LIVE'/'SHADOW' 만 영속.
 * P0-A 단계 placeholder — PAPER/VTS 는 항상 0.
 */
function classifyMode(mode: ServerShadowTrade['mode']): 'LIVE' | 'PAPER' | 'SHADOW' {
  if (mode === 'LIVE') return 'LIVE';
  // P1 wiring 후 (mode as string === 'PAPER' || mode === 'VTS') 활성화
  return 'SHADOW';
}

/**
 * 7일 윈도우 5분류 통계 산출 SSOT.
 *
 * @param now 기준 시각 (테스트 격리용, 미명시 시 `new Date()`).
 * @param shadowsOverride 영속 read 우회 (테스트용).
 * @param ghostsOverride 영속 read 우회 (테스트용).
 */
export function compute7dExecutionStats(opts?: {
  now?: Date;
  shadowsOverride?: ReadonlyArray<ServerShadowTrade>;
  ghostsOverride?: ReadonlyArray<{ signalDate?: string }>;
}): ExecutionStats7d {
  const nowMs = (opts?.now ?? new Date()).getTime();
  const cutoffMs = nowMs - EXECUTION_STATS_WINDOW_MS;

  const shadows = opts?.shadowsOverride ?? loadShadowTrades();
  const ghosts = opts?.ghostsOverride ?? loadGhostPortfolio();

  const recentShadows = shadows.filter(s => isWithinWindow(s.signalTime, cutoffMs));
  const recentGhosts = ghosts.filter(g => isWithinWindow(g.signalDate, cutoffMs));

  let liveOrderSent = 0;
  // shadowRecorded = 모든 recent shadow (mode 무관)
  const shadowRecorded = recentShadows.length;
  for (const s of recentShadows) {
    if (classifyMode(s.mode) === 'LIVE') liveOrderSent += 1;
  }

  // P0-A placeholder — PAPER/VTS 영속 부재 시 0 / liveBlocked 영속 부재 시 0.
  // P1 ShadowDecisionRecord wiring 후 활성화.
  const paperBuyRecorded = 0;
  const liveBlocked = 0;

  const ghost = recentGhosts.length;
  const evaluated = shadowRecorded + ghost;

  return {
    shadowRecorded,
    paperBuyRecorded,
    liveOrderSent,
    liveBlocked,
    ghost,
    evaluated,
  };
}

/**
 * 진단 텍스트 자동 생성 — 사용자 명시 4 패턴.
 *
 * - `evaluated > 0 && shadowRecorded === 0` → 🚨 shadowLedger not always-on
 * - LIVE 모드 + `liveOrderSent === 0 && liveBlocked > 0` → ⚠️ Kill switch / Gate 결함
 * - `ghost > shadowRecorded × 2` → ⚠️ 워치리스트 거래 단계 차단
 * - 그 외 → ✅ 일치
 */
export interface DiagnosisInputs {
  readonly stats: ExecutionStats7d;
  readonly mode: 'LIVE' | 'PAPER' | 'SHADOW' | 'MANUAL';
}

export function buildExecutionDiagnosis(input: DiagnosisInputs): readonly string[] {
  const { stats, mode } = input;
  const diag: string[] = [];

  if (stats.evaluated > 0 && stats.shadowRecorded === 0) {
    diag.push('🚨 shadowRecorded=0 while evaluated>0 → shadow ledger not always-on');
  }
  if (mode === 'LIVE' && stats.liveOrderSent === 0 && stats.liveBlocked > 0) {
    diag.push('⚠️ Live 모드인데 모든 주문 차단 — Kill switch 또는 Gate 결함');
  }
  if (stats.shadowRecorded > 0 && stats.ghost > stats.shadowRecorded * 2) {
    diag.push('⚠️ ghost가 shadow의 2배 초과 — 워치리스트 거래 단계 차단');
  }
  if (diag.length === 0) {
    diag.push('✅ 기대 vs 실제 일치');
  }

  return diag;
}
