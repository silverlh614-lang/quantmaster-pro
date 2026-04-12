/**
 * attributionRepo.ts — 귀인 분석 서버 저장소
 *
 * 클라이언트가 거래 종료(closeTrade) 시 POST /api/attribution/record 로 전송한
 * 27개 조건 점수 스냅샷과 최종 수익률을 보관한다.
 *
 * signalCalibrator / conditionAuditor 가 이 레코드를 읽어
 * 조건별 성과를 보완적으로 분석할 수 있다.
 *
 * 보관 한도: 최근 500건 (saveAttributionRecords 내 자동 트리밍)
 */

import fs from 'fs';
import { ATTRIBUTION_FILE, ensureDataDir } from './paths.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface ServerAttributionRecord {
  tradeId:         string;
  stockCode:       string;
  stockName:       string;
  /** 거래 종료 시각 (ISO) */
  closedAt:        string;
  returnPct:       number;
  isWin:           boolean;
  /** 진입 시점 레짐 — 클라이언트에서 전달 시 설정 (optional) */
  entryRegime?:    string;
  /** 진입 시 캡처된 27개 조건 점수 스냅샷 (conditionId → score 0~10) */
  conditionScores: Record<number, number>;
  holdingDays:     number;
  sellReason?:     string;
}

/** 조건별 집계 결과 (GET /api/attribution/stats 응답 형태) */
export interface AttributionConditionStat {
  conditionId:        number;
  totalTrades:        number;
  winRate:            number;  // %
  avgReturn:          number;  // %
  /** score ≥ 7인 거래의 평균 수익률 */
  avgReturnWhenHigh:  number;
  /** score < 5인 거래의 평균 수익률 */
  avgReturnWhenLow:   number;
}

// ── I/O ───────────────────────────────────────────────────────────────────────

export function loadAttributionRecords(): ServerAttributionRecord[] {
  ensureDataDir();
  if (!fs.existsSync(ATTRIBUTION_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(ATTRIBUTION_FILE, 'utf-8')) as ServerAttributionRecord[];
  } catch {
    return [];
  }
}

export function saveAttributionRecords(records: ServerAttributionRecord[]): void {
  ensureDataDir();
  fs.writeFileSync(ATTRIBUTION_FILE, JSON.stringify(records, null, 2));
}

export function appendAttributionRecord(record: ServerAttributionRecord): void {
  const records = loadAttributionRecords();
  // 중복 tradeId 방지
  const filtered = records.filter((r) => r.tradeId !== record.tradeId);
  filtered.push(record);
  saveAttributionRecords(filtered.slice(-500));
}

// ── 집계 유틸 ─────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function winRatePct(arr: number[]): number {
  return arr.length > 0 ? (arr.filter((r) => r > 0).length / arr.length) * 100 : 0;
}

/**
 * 저장된 귀인 레코드를 조건별로 집계하여 성과 통계를 반환한다.
 * score >= 7 → "고점수" / score < 5 → "저점수" 구간으로 분리.
 */
export function computeAttributionStats(): AttributionConditionStat[] {
  const records = loadAttributionRecords();
  if (records.length === 0) return [];

  const condMap: Record<
    number,
    { returns: number[]; highReturns: number[]; lowReturns: number[] }
  > = {};

  for (const rec of records) {
    for (const [condIdStr, score] of Object.entries(rec.conditionScores)) {
      const condId = Number(condIdStr);
      if (!condMap[condId]) condMap[condId] = { returns: [], highReturns: [], lowReturns: [] };
      condMap[condId].returns.push(rec.returnPct);
      if (score >= 7) condMap[condId].highReturns.push(rec.returnPct);
      if (score < 5)  condMap[condId].lowReturns.push(rec.returnPct);
    }
  }

  return Object.entries(condMap)
    .map(([condId, data]) => ({
      conditionId:       Number(condId),
      totalTrades:       data.returns.length,
      winRate:           parseFloat(winRatePct(data.returns).toFixed(1)),
      avgReturn:         parseFloat(avg(data.returns).toFixed(2)),
      avgReturnWhenHigh: parseFloat(avg(data.highReturns).toFixed(2)),
      avgReturnWhenLow:  parseFloat(avg(data.lowReturns).toFixed(2)),
    }))
    .sort((a, b) => a.conditionId - b.conditionId);
}
