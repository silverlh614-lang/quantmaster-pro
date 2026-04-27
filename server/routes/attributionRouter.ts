/**
 * @responsibility 조건별 수익률 귀인 통계 + 합치도 매트릭스 GET 엔드포인트 (ADR-0035, ADR-0054)
 */

import { Router, Request, Response } from 'express';
import {
  computeAttributionStats,
  loadAttributionRecords,
  loadCurrentSchemaRecords,
  type ServerAttributionRecord,
} from '../persistence/attributionRepo.js';
import {
  REAL_DATA_CONDITIONS,
  AI_ESTIMATE_CONDITIONS,
  ALL_TIERS,
  classifyTier,
  averageScoreFor,
  type ConcordanceTier,
} from '../learning/conditionSourceMap.js';

const router = Router();

router.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = computeAttributionStats();
    const totalRecords = loadAttributionRecords().length;
    res.json({ stats, totalRecords });
  } catch (e) {
    console.error('[attributionRouter] /stats 실패:', e);
    res.status(500).json({ error: 'attribution_stats_failed' });
  }
});

// ─── ADR-0054 PR-Z6: 5×5 합치도 매트릭스 ─────────────────────────────────

interface ConcordanceCell {
  quantTier: ConcordanceTier;
  qualTier: ConcordanceTier;
  sampleCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgReturnPct: number | null;
}

interface ConcordanceStats {
  sampleCount: number;
  winRate: number | null;
  avgReturnPct: number | null;
}

interface ConcordanceMatrix {
  cells: ConcordanceCell[];
  diagonalStats: ConcordanceStats;
  offDiagonalStats: ConcordanceStats;
  totalSamples: number;
  capturedAt: string;
}

/** 25 cell 빈 grid 초기화 — 모든 tier 조합 보장. */
function initializeCells(): Map<string, ConcordanceCell> {
  const map = new Map<string, ConcordanceCell>();
  for (const quantTier of ALL_TIERS) {
    for (const qualTier of ALL_TIERS) {
      map.set(`${quantTier}|${qualTier}`, {
        quantTier,
        qualTier,
        sampleCount: 0,
        wins: 0,
        losses: 0,
        winRate: null,
        avgReturnPct: null,
      });
    }
  }
  return map;
}

/** 단건 trade 를 cell + 통계 합산 누적기에 반영 (return 합산은 sum 으로 보존). */
interface CellAccum {
  sampleCount: number;
  wins: number;
  losses: number;
  returnSum: number;
}

function ensureAccum(map: Map<string, CellAccum>, key: string): CellAccum {
  let entry = map.get(key);
  if (!entry) {
    entry = { sampleCount: 0, wins: 0, losses: 0, returnSum: 0 };
    map.set(key, entry);
  }
  return entry;
}

function statsFromAccum(accum: CellAccum): ConcordanceStats {
  if (accum.sampleCount === 0) {
    return { sampleCount: 0, winRate: null, avgReturnPct: null };
  }
  return {
    sampleCount: accum.sampleCount,
    winRate: (accum.wins / accum.sampleCount) * 100,
    avgReturnPct: accum.returnSum / accum.sampleCount,
  };
}

export function buildConcordanceMatrix(records: ServerAttributionRecord[]): ConcordanceMatrix {
  const cells = initializeCells();
  const cellAccums = new Map<string, CellAccum>();
  const diagonal: CellAccum = { sampleCount: 0, wins: 0, losses: 0, returnSum: 0 };
  const offDiagonal: CellAccum = { sampleCount: 0, wins: 0, losses: 0, returnSum: 0 };

  for (const rec of records) {
    const scores = rec.conditionScores ?? {};
    const quantAvg = averageScoreFor(scores, REAL_DATA_CONDITIONS);
    const qualAvg = averageScoreFor(scores, AI_ESTIMATE_CONDITIONS);
    const quantTier = classifyTier(quantAvg);
    const qualTier = classifyTier(qualAvg);
    const isWin = rec.isWin === true;
    const ret = Number.isFinite(rec.returnPct) ? rec.returnPct : 0;

    const key = `${quantTier}|${qualTier}`;
    const accum = ensureAccum(cellAccums, key);
    accum.sampleCount += 1;
    if (isWin) accum.wins += 1; else accum.losses += 1;
    accum.returnSum += ret;

    const target = quantTier === qualTier ? diagonal : offDiagonal;
    target.sampleCount += 1;
    if (isWin) target.wins += 1; else target.losses += 1;
    target.returnSum += ret;
  }

  // 합산 결과를 cell 출력 형태로 변환
  for (const [key, accum] of cellAccums.entries()) {
    const cell = cells.get(key);
    if (!cell) continue;
    cell.sampleCount = accum.sampleCount;
    cell.wins = accum.wins;
    cell.losses = accum.losses;
    cell.winRate = accum.sampleCount > 0 ? (accum.wins / accum.sampleCount) * 100 : null;
    cell.avgReturnPct = accum.sampleCount > 0 ? accum.returnSum / accum.sampleCount : null;
  }

  return {
    cells: Array.from(cells.values()),
    diagonalStats: statsFromAccum(diagonal),
    offDiagonalStats: statsFromAccum(offDiagonal),
    totalSamples: records.length,
    capturedAt: new Date().toISOString(),
  };
}

router.get('/concordance', (_req: Request, res: Response) => {
  try {
    const records = loadCurrentSchemaRecords();
    const matrix = buildConcordanceMatrix(records);
    res.json(matrix);
  } catch (e) {
    console.error('[attributionRouter] /concordance 실패:', e);
    res.status(500).json({ error: 'concordance_matrix_failed' });
  }
});

export default router;
