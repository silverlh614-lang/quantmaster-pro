// @responsibility positionTruth 영속 SSOT — 보유 포지션 진실 단일 출처 + drift 검출.
/**
 * positionTruth.ts — Open Positions SSOT (ADR-0191)
 *
 * 사용자 5/6 SHADOW 12회 가짜 매수 사고 후속 — 보유 포지션 카운트가 3 경로에서
 * 다른 답을 줄 수 있던 결함 차단:
 *   (a) loadShadowTrades().filter(isOpen)        — diagnostics.ts:218 (단순 status 필터)
 *   (b) aggregateAllPositions().filter(stage!=CLOSED) — positionsRouter / Morning Card
 *   (c) computePositionStats()                    — 통계 모듈 내부
 *
 * 본 SSOT 는 (a) 경로 (단순 status 기반) 의 정형화된 view 를 제공하고,
 * (b) 경로 (이벤트 집계) 와의 divergence 를 자동 검출한다.
 *
 * 절대 규칙:
 *   - 영속 수정 0건 (read-only)
 *   - LIVE 매매 본체 의존 0 (positionAggregator 결함 시 본 SSOT 흐름 차단 안 됨)
 *   - try/catch 격리 (load 실패 시 빈 배열 fallback)
 */
import {
  loadShadowTrades,
  getRemainingQty,
  type ServerShadowTrade,
} from './shadowTradeRepo.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';
import { aggregateAllPositions } from '../trading/positionAggregator.js';

// ─── 타입 ────────────────────────────────────────────────────────────────

export interface OpenPositionView {
  positionId: string;
  stockCode: string;
  stockName: string;
  status: ServerShadowTrade['status'];
  remainingQty: number;
  signalTime: string;
  mode: 'LIVE' | 'SHADOW';
}

export interface PositionTruthDivergenceReport {
  shadowOpenCount: number;
  aggregateActiveCount: number;
  divergent: boolean;
  divergentStockCodes: string[];
  /** detect 자체 실패 시 사유 (positionAggregator throw 등). */
  detectError?: string;
}

// ─── ENV gate ────────────────────────────────────────────────────────────

/**
 * Position Truth Divergence 체크 활성화 — default ON. ADR-0157 정확 비교 의무.
 * 회귀 발견 시 ENV `=true` 1줄 즉시 롤백.
 */
export function isPositionTruthDivergenceCheckDisabled(): boolean {
  return process.env.POSITION_TRUTH_DIVERGENCE_CHECK_DISABLED === 'true';
}

// ─── (a) 경로: 단순 status 기반 SSOT ────────────────────────────────────

/**
 * 현재 보유 중인 포지션 목록을 반환. (a) 경로의 정형화된 view.
 *
 * 활성 status (PENDING / ORDER_SUBMITTED / PARTIALLY_FILLED / ACTIVE /
 * EUPHORIA_PARTIAL) + remainingQty > 0 만 포함.
 *
 * REJECTED / HIT_TARGET / HIT_STOP 자동 제외.
 *
 * 영속 load 실패 시 빈 배열 fallback (안전).
 *
 * LEGITIMATE 분리 (중복정리 #3 확정): 본 함수와 shadowPositionLedger.getOpenPositions 는
 * 동일 shadow-trades.json 영속을 읽되 필터 강도가 다르다 — 본 함수는 divergence 검출
 * (detectPositionTruthDivergence) 의 (a) 비교 기준선용 경량 view(2가드: open status /
 * remainingQty>0), getOpenPositions 는 표시/진입용 엄격 view(5가드, NEAR_BREAKOUT·orphan
 * 차단 포함). 기준선은 의도적으로 가드를 약하게 둬 (b) 이벤트 집계와의 차이를 드러낸다.
 * 통합 금지 — "엄격 표시 view vs divergence 경량 기준선" 의 목적 차이가 분리의 본질이다.
 */
export function loadOpenPositions(): OpenPositionView[] {
  let shadows: ServerShadowTrade[] = [];
  try {
    shadows = loadShadowTrades();
  } catch (e) {
    console.warn('[PositionTruth] loadShadowTrades 실패 — 빈 배열 fallback:', e);
    return [];
  }
  return shadows
    .filter((t) => isOpenShadowStatus(t.status) && getRemainingQty(t) > 0)
    .map((t) => ({
      positionId: t.id,
      stockCode: t.stockCode,
      stockName: t.stockName,
      status: t.status,
      remainingQty: getRemainingQty(t),
      signalTime: t.signalTime,
      mode: t.mode === 'LIVE' ? 'LIVE' : 'SHADOW',
    }));
}

/**
 * 종목별 보유 포지션 카운트. 동일 stockCode 다중 보유 (12회 매수 시나리오) 검출용.
 */
export function countOpenByStockCode(positions: OpenPositionView[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of positions) {
    counts.set(p.stockCode, (counts.get(p.stockCode) ?? 0) + 1);
  }
  return counts;
}

// ─── (a) vs (b) divergence 검출 ─────────────────────────────────────────

/**
 * (a) loadShadowTrades().filter(isOpen) 와 (b) aggregateAllPositions().filter(stage!=CLOSED)
 * 의 카운트·종목 비교 → divergence 검출.
 *
 * positionAggregator 가 throw 해도 본 함수 자체는 detectError 에 사유 기록 후
 * divergent=false 반환 (Morning Card / health 흐름 차단 안 됨).
 *
 * ENV `POSITION_TRUTH_DIVERGENCE_CHECK_DISABLED=true` 시 즉시 정합 결과 반환.
 */
export function detectPositionTruthDivergence(): PositionTruthDivergenceReport {
  if (isPositionTruthDivergenceCheckDisabled()) {
    return {
      shadowOpenCount: 0,
      aggregateActiveCount: 0,
      divergent: false,
      divergentStockCodes: [],
    };
  }

  const shadowOpen = loadOpenPositions();
  const shadowOpenCodes = new Set(shadowOpen.map((p) => p.stockCode));

  let aggregateActiveCodes = new Set<string>();
  let aggregateActiveCount = 0;
  let detectError: string | undefined;

  try {
    // top-level import — positionAggregator 는 이미 shadowTradeRepo 의존이라 추가 결합 없음.
    // throw 시 detectError 기록 후 divergent 평가 계속 (Morning Card / health 흐름 차단 안 됨).
    const all = aggregateAllPositions();
    const active = all.filter((p) => p.stage !== 'CLOSED');
    aggregateActiveCount = active.length;
    aggregateActiveCodes = new Set(active.map((p) => p.stockCode));
  } catch (e) {
    /* SDS-ignore: aggregate position failure is converted to detectError diagnostic and does not alter runtime policy. */
    detectError = e instanceof Error ? e.message : String(e);
  }

  const divergentSet = new Set<string>();
  for (const code of shadowOpenCodes) {
    if (!aggregateActiveCodes.has(code)) divergentSet.add(code);
  }
  for (const code of aggregateActiveCodes) {
    if (!shadowOpenCodes.has(code)) divergentSet.add(code);
  }

  const divergent = shadowOpen.length !== aggregateActiveCount || divergentSet.size > 0;

  return {
    shadowOpenCount: shadowOpen.length,
    aggregateActiveCount,
    divergent,
    divergentStockCodes: Array.from(divergentSet).sort(),
    ...(detectError ? { detectError } : {}),
  };
}
