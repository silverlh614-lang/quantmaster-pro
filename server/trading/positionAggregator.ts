// @responsibility positionAggregator 매매 엔진 모듈
/**
 * positionAggregator.ts — 포지션 생애주기 집계 서비스
 *
 * shadow-log.json의 이벤트 스트림을 positionId(shadow.id)별로 그룹핑하여
 * UI가 소비할 완성된 PositionSummary[]를 생성한다.
 *
 * 설계 원칙:
 *   - shadow-trades.json은 "최종 상태"만 저장 (truncated view)
 *   - shadow-log.json은 "이벤트 스트림" (source of truth)
 *   - 이 집계기는 이벤트 스트림으로부터 진실을 재구성한다
 *
 * 페르소나 원칙:
 *   - 원칙 3: 다신호 합치 — 이벤트 vs 최종 상태 교차 검증
 *   - 원칙 16: 데이터 신뢰도 구분 — 실계산(이벤트) > 최종 상태
 */

import fs from 'fs';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { SHADOW_LOG_FILE } from '../persistence/paths.js';

// ─── 타입 정의 ────────────────────────────────────────────────────────────────

/** 실현 손익 계산에 포함되는 매도 이벤트 */
export const SELL_EVENTS = new Set([
  'RRR_COLLAPSE_PARTIAL',
  'PROFIT_TRANCHE',
  'EUPHORIA_PARTIAL',
  'CASCADE_HALF_SELL',
  'DIVERGENCE_PARTIAL',
  'HIT_STOP',
  'HIT_TARGET',
  'FULLY_CLOSED_TRANCHES',
  'MA60_DEATH_FORCE_EXIT',
  'R6_EMERGENCY_EXIT',
  'CASCADE_STOP_FINAL',
  'CASCADE_STOP_BLACKLIST',
]);

/** 포지션의 현재 생애주기 단계 */
export type PositionStage =
  | 'ENTRY'       // 진입 완료, 매도 이벤트 없음
  | 'PARTIAL'     // 일부 청산 완료, 잔여 있음
  | 'CLOSED';     // 전량 청산 완료

/** 한 개 매도 이벤트의 요약 */
export interface ExitEventSummary {
  ts: string;
  event: string;
  soldQty: number;
  exitPrice?: number;
  returnPct?: number;
  exitRuleTag?: string;
  realizedPnL: number;        // 이 이벤트로 실현된 손익 (원)
}

/** 매도 사유별 분류 집계 */
export interface ExitBreakdown {
  /** 이익 확정 매도 (익절) */
  takeProfit: { qty: number; pnl: number };
  /** 손실 손절 (hard stop) */
  stopLoss: { qty: number; pnl: number };
  /** 이익 보호 손절 (BEP/trailing) */
  profitProtection: { qty: number; pnl: number };
  /** 리스크 재평가 매도 (RRR collapse 등) */
  riskReassessment: { qty: number; pnl: number };
  /** 비상 청산 (R6 / MA60 death) */
  emergency: { qty: number; pnl: number };
}

/** 포지션 생애주기 집계 결과 */
export interface PositionSummary {
  positionId: string;
  stockCode: string;
  stockName: string;
  
  // 진입 정보
  entryPrice: number;
  entryDate: string;
  entryRegime?: string;
  profileType?: string;
  originalQuantity: number;
  
  // 집계 결과
  stage: PositionStage;
  realizedQty: number;        // 누적 매도 수량
  remainingQty: number;       // 잔여 보유 수량
  totalRealizedPnL: number;   // 누적 실현 손익 (원)
  weightedReturnPct: number;  // 가중평균 수익률 (%) — PnL ÷ (entryPrice × originalQty)
  
  // 이벤트 타임라인
  exitEvents: ExitEventSummary[];
  exitBreakdown: ExitBreakdown;
  
  // 메타
  holdingDays: number;
  entryTime: string;
  closedTime?: string;
  mode?: 'LIVE' | 'SHADOW';
  
  // 현재 스냅샷 (shadow-trades.json 기반, 검증용)
  snapshotQuantity?: number;
  snapshotStatus?: string;
  snapshotReturnPct?: number;
  
  // 정합성 이슈 (빈 배열 = 정합)
  integrityIssues: string[];
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function loadShadowLogs(): any[] {
  if (!fs.existsSync(SHADOW_LOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SHADOW_LOG_FILE, 'utf-8'));
  } catch (e) {
    console.error('[PositionAggregator] shadow-log.json 파싱 실패:', e);
    return [];
  }
}

/** 매도 이벤트를 분류별로 매핑 */
function classifyExit(event: string, exitRuleTag?: string, stopLossExitType?: string): keyof ExitBreakdown {
  // 이익 보호 손절 (BEP protection)
  if (stopLossExitType === 'PROFIT_PROTECTION') return 'profitProtection';
  
  // 비상 청산
  if (event === 'R6_EMERGENCY_EXIT' || event === 'MA60_DEATH_FORCE_EXIT') return 'emergency';
  if (event === 'CASCADE_STOP_FINAL' || event === 'CASCADE_STOP_BLACKLIST') return 'emergency';
  
  // 리스크 재평가
  if (event === 'RRR_COLLAPSE_PARTIAL' || event === 'DIVERGENCE_PARTIAL') return 'riskReassessment';
  if (event === 'CASCADE_HALF_SELL') return 'riskReassessment';
  if (event === 'EUPHORIA_PARTIAL') return 'riskReassessment';
  
  // 익절
  if (event === 'PROFIT_TRANCHE' || event === 'HIT_TARGET' || event === 'FULLY_CLOSED_TRANCHES') {
    return 'takeProfit';
  }
  
  // 손실 손절
  if (event === 'HIT_STOP' && exitRuleTag === 'HARD_STOP') return 'stopLoss';
  
  return 'stopLoss'; // 분류 실패 시 보수적으로 손실로
}

function emptyBreakdown(): ExitBreakdown {
  return {
    takeProfit: { qty: 0, pnl: 0 },
    stopLoss: { qty: 0, pnl: 0 },
    profitProtection: { qty: 0, pnl: 0 },
    riskReassessment: { qty: 0, pnl: 0 },
    emergency: { qty: 0, pnl: 0 },
  };
}

// ─── 메인 집계 함수 ───────────────────────────────────────────────────────────

/**
 * 단일 positionId에 대한 집계.
 */
export function aggregatePosition(
  positionId: string,
  logs: any[],
  snapshot: any | null,
): PositionSummary {
  const related = logs
    .filter((l) => l.id === positionId)
    .sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));

  if (related.length === 0) {
    // 스냅샷만 있는 고립 포지션
    if (snapshot) {
      return {
        positionId,
        stockCode: snapshot.stockCode ?? 'UNKNOWN',
        stockName: snapshot.stockName ?? 'UNKNOWN',
        entryPrice: snapshot.shadowEntryPrice ?? 0,
        entryDate: snapshot.signalTime ?? '',
        entryRegime: snapshot.entryRegime,
        profileType: snapshot.profileType,
        originalQuantity: snapshot.originalQuantity ?? snapshot.quantity ?? 0,
        stage: snapshot.status === 'HIT_STOP' || snapshot.status === 'HIT_TARGET' ? 'CLOSED' : 'ENTRY',
        realizedQty: 0,
        remainingQty: snapshot.quantity ?? 0,
        totalRealizedPnL: 0,
        weightedReturnPct: snapshot.returnPct ?? 0,
        exitEvents: [],
        exitBreakdown: emptyBreakdown(),
        holdingDays: 0,
        entryTime: snapshot.signalTime ?? '',
        mode: snapshot.mode,
        snapshotQuantity: snapshot.quantity,
        snapshotStatus: snapshot.status,
        snapshotReturnPct: snapshot.returnPct,
        integrityIssues: ['이벤트 로그 없음 — 스냅샷만 존재 (고립 포지션)'],
      };
    }
    throw new Error(`positionId ${positionId}에 대한 데이터 없음`);
  }

  const first = related[0];
  const entryPrice = first.shadowEntryPrice ?? 0;
  const originalQuantity = first.originalQuantity ?? first.quantity ?? 0;
  const entryTime = first.signalTime ?? first.ts ?? '';

  const summary: PositionSummary = {
    positionId,
    stockCode: first.stockCode ?? 'UNKNOWN',
    stockName: first.stockName ?? 'UNKNOWN',
    entryPrice,
    entryDate: entryTime,
    entryRegime: first.entryRegime,
    profileType: first.profileType,
    originalQuantity,
    stage: 'ENTRY',
    realizedQty: 0,
    remainingQty: originalQuantity,
    totalRealizedPnL: 0,
    weightedReturnPct: 0,
    exitEvents: [],
    exitBreakdown: emptyBreakdown(),
    holdingDays: 0,
    entryTime,
    mode: first.mode,
    snapshotQuantity: snapshot?.quantity,
    snapshotStatus: snapshot?.status,
    snapshotReturnPct: snapshot?.returnPct,
    integrityIssues: [],
  };

  // ── 매도 이벤트 순회 집계 ──
  for (const log of related) {
    if (!SELL_EVENTS.has(log.event)) continue;

    // soldQty 결정
    let soldQty = log.soldQty ?? 0;
    if (soldQty === 0) {
      // HIT_STOP/HIT_TARGET 등 전량 매도 이벤트 — quantity 사용 (매도 전 기록일 경우)
      if (log.event === 'HIT_STOP' || log.event === 'HIT_TARGET' || log.event === 'FULLY_CLOSED_TRANCHES') {
        // 이전까지 매도된 수량을 제외한 잔여 = originalQty - (이전 realizedQty)
        soldQty = originalQuantity - summary.realizedQty;
      }
    }
    if (soldQty <= 0) {
      summary.integrityIssues.push(
        `${log.event} 이벤트의 soldQty 확정 불가 (${log.ts})`,
      );
      continue;
    }

    // exitPrice 결정 — 없으면 returnPct로 역산
    let exitPrice = log.exitPrice;
    if (exitPrice === undefined && log.returnPct !== undefined && entryPrice > 0) {
      exitPrice = entryPrice * (1 + log.returnPct / 100);
      summary.integrityIssues.push(
        `${log.event} 에 exitPrice 누락 — returnPct(${log.returnPct})로 역산 (${log.ts})`,
      );
    }
    if (exitPrice === undefined) {
      summary.integrityIssues.push(
        `${log.event} 실현손익 계산 불가 — exitPrice 및 returnPct 모두 없음 (${log.ts})`,
      );
      continue;
    }

    const realizedPnL = (exitPrice - entryPrice) * soldQty;

    summary.exitEvents.push({
      ts: log.ts,
      event: log.event,
      soldQty,
      exitPrice,
      returnPct: log.returnPct,
      exitRuleTag: log.exitRuleTag,
      realizedPnL,
    });

    summary.totalRealizedPnL += realizedPnL;
    summary.realizedQty += soldQty;

    // 분류별 집계
    const category = classifyExit(log.event, log.exitRuleTag, log.stopLossExitType);
    summary.exitBreakdown[category].qty += soldQty;
    summary.exitBreakdown[category].pnl += realizedPnL;

    // 최종 종료 시각
    if (['HIT_STOP', 'HIT_TARGET', 'FULLY_CLOSED_TRANCHES', 'CASCADE_STOP_FINAL', 'CASCADE_STOP_BLACKLIST'].includes(log.event)) {
      summary.closedTime = log.ts;
    }
  }

  // ── 후처리 ──
  summary.remainingQty = originalQuantity - summary.realizedQty;
  summary.weightedReturnPct =
    originalQuantity > 0 && entryPrice > 0
      ? (summary.totalRealizedPnL / (entryPrice * originalQuantity)) * 100
      : 0;

  // 생애주기 단계 결정
  if (summary.realizedQty === 0) {
    summary.stage = 'ENTRY';
  } else if (summary.realizedQty < originalQuantity) {
    summary.stage = 'PARTIAL';
  } else {
    summary.stage = 'CLOSED';
  }

  // 보유 기간
  if (entryTime) {
    const endTime = summary.closedTime ?? new Date().toISOString();
    summary.holdingDays = Math.floor(
      (new Date(endTime).getTime() - new Date(entryTime).getTime()) / 86_400_000,
    );
  }

  // ── 정합성 검증 ──
  if (summary.stage === 'CLOSED' && summary.realizedQty !== originalQuantity) {
    summary.integrityIssues.push(
      `CLOSED 상태이나 realizedQty(${summary.realizedQty}) !== originalQuantity(${originalQuantity})`,
    );
  }
  if (snapshot && snapshot.returnPct !== undefined) {
    const drift = Math.abs(snapshot.returnPct - summary.weightedReturnPct);
    if (drift > 0.5) {
      summary.integrityIssues.push(
        `snapshot.returnPct(${snapshot.returnPct.toFixed(2)}%) != 가중평균(${summary.weightedReturnPct.toFixed(2)}%) — UI 왜곡 원인`,
      );
    }
  }

  return summary;
}

/**
 * 모든 포지션에 대한 집계 — API 핵심 호출.
 */
export function aggregateAllPositions(): PositionSummary[] {
  const shadows = loadShadowTrades();
  const logs = loadShadowLogs();

  // positionId 집합 수집 (snapshots + logs)
  const snapshotIds = new Set(shadows.map((s) => s.id));
  const logIds = new Set(logs.filter((l) => l.id).map((l) => l.id as string));
  const allIds = Array.from(new Set([...snapshotIds, ...logIds]));

  const summaries: PositionSummary[] = [];
  for (const id of allIds) {
    if (typeof id !== 'string') continue;
    const snapshot = shadows.find((s) => s.id === id) ?? null;
    try {
      summaries.push(aggregatePosition(id, logs, snapshot));
    } catch (e: any) {
      console.error(`[PositionAggregator] ${id} 집계 실패:`, e.message);
    }
  }

  // 진입일 역순 정렬 (최신 순)
  return summaries.sort((a, b) => (b.entryDate ?? '').localeCompare(a.entryDate ?? ''));
}

/**
 * 요약 통계 계산 (대시보드용).
 */
export function computePositionStats(summaries: PositionSummary[]) {
  const closed = summaries.filter((s) => s.stage === 'CLOSED');
  const wins = closed.filter((s) => s.totalRealizedPnL > 0);
  const losses = closed.filter((s) => s.totalRealizedPnL < 0);

  const totalPnL = closed.reduce((sum, s) => sum + s.totalRealizedPnL, 0);
  const avgReturn =
    closed.length > 0
      ? closed.reduce((sum, s) => sum + s.weightedReturnPct, 0) / closed.length
      : 0;

  return {
    totalPositions: summaries.length,
    activePositions: summaries.filter((s) => s.stage !== 'CLOSED').length,
    closedPositions: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    totalRealizedPnL: totalPnL,
    avgReturnPct: avgReturn,
    // 분류별 합계
    totalTakeProfit: summaries.reduce((sum, s) => sum + s.exitBreakdown.takeProfit.pnl, 0),
    totalStopLoss: summaries.reduce((sum, s) => sum + s.exitBreakdown.stopLoss.pnl, 0),
    totalProfitProtection: summaries.reduce((sum, s) => sum + s.exitBreakdown.profitProtection.pnl, 0),
    totalRiskReassessment: summaries.reduce((sum, s) => sum + s.exitBreakdown.riskReassessment.pnl, 0),
    totalEmergency: summaries.reduce((sum, s) => sum + s.exitBreakdown.emergency.pnl, 0),
  };
}
