/**
 * @responsibility 후보군 파이프라인 단계별 카운트 GET 엔드포인트 (ADR-0023 PR-F)
 */

import { Router, Request, Response } from 'express';
import { getLastScanSummary } from '../trading/signalScanner.js';
import type { ScanSummary } from '../trading/signalScanner/scanDiagnostics.js';

const router = Router();

export interface PipelineStage {
  id: 'UNIVERSE' | 'CANDIDATES' | 'MOMENTUM_PASS' | 'GATE1_PASS' | 'RRR_PASS' | 'ENTRIES';
  label: string;
  count: number;
  droppedAtThisStep?: number;
  dropReason?: string;
}

export interface PipelineSummary {
  lastScanTime: string | null;
  stages: PipelineStage[];
  totals: {
    universeSize: number | null;
    candidates: number;
    entries: number;
    /** entries / candidates (candidates>0 일 때만) */
    conversionRate: number;
  };
}

const STAGE_LABELS = {
  UNIVERSE: '전체 시장',
  CANDIDATES: '거래 가능',
  MOMENTUM_PASS: '모멘텀 후보',
  GATE1_PASS: '생존 후보',
  RRR_PASS: 'RRR 통과',
  ENTRIES: '매수 후보',
} as const;

/** 음수 회피 + 정수 보정. */
function safeCount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/**
 * ScanSummary → PipelineSummary 매핑.
 * summary=null → 모든 stage count=0 + lastScanTime=null.
 *
 * 단계별 카운트 산출:
 *   CANDIDATES   = summary.candidates
 *   MOMENTUM_PASS = candidates − yahooFails
 *   GATE1_PASS    = 위 단계 − gateMisses
 *   RRR_PASS      = 위 단계 − rrrMisses
 *   ENTRIES       = summary.entries
 */
export function buildPipelineSummary(summary: ScanSummary | null): PipelineSummary {
  if (!summary) {
    const stages: PipelineStage[] = [
      { id: 'UNIVERSE',      label: STAGE_LABELS.UNIVERSE,      count: 0 },
      { id: 'CANDIDATES',    label: STAGE_LABELS.CANDIDATES,    count: 0 },
      { id: 'MOMENTUM_PASS', label: STAGE_LABELS.MOMENTUM_PASS, count: 0 },
      { id: 'GATE1_PASS',    label: STAGE_LABELS.GATE1_PASS,    count: 0 },
      { id: 'RRR_PASS',      label: STAGE_LABELS.RRR_PASS,      count: 0 },
      { id: 'ENTRIES',       label: STAGE_LABELS.ENTRIES,       count: 0 },
    ];
    return {
      lastScanTime: null,
      stages,
      totals: { universeSize: null, candidates: 0, entries: 0, conversionRate: 0 },
    };
  }

  const candidates = safeCount(summary.candidates);
  const yahooFails = safeCount(summary.yahooFails);
  const gateMisses = safeCount(summary.gateMisses);
  const rrrMisses = safeCount(summary.rrrMisses);
  const entries = safeCount(summary.entries);

  const momentumPass = Math.max(0, candidates - yahooFails);
  const gate1Pass = Math.max(0, momentumPass - gateMisses);
  const rrrPass = Math.max(0, gate1Pass - rrrMisses);

  const stages: PipelineStage[] = [
    {
      id: 'UNIVERSE',
      label: STAGE_LABELS.UNIVERSE,
      count: 0, // 정확한 universe size 인프라 부재 — 후속 PR (ADR-0023 §Out of Scope)
    },
    {
      id: 'CANDIDATES',
      label: STAGE_LABELS.CANDIDATES,
      count: candidates,
      dropReason: '워치리스트·후보군 진입',
    },
    {
      id: 'MOMENTUM_PASS',
      label: STAGE_LABELS.MOMENTUM_PASS,
      count: momentumPass,
      droppedAtThisStep: yahooFails,
      dropReason: 'Yahoo OHLCV 데이터 부재',
    },
    {
      id: 'GATE1_PASS',
      label: STAGE_LABELS.GATE1_PASS,
      count: gate1Pass,
      droppedAtThisStep: gateMisses,
      dropReason: 'Gate 1 진입 검증 탈락',
    },
    {
      id: 'RRR_PASS',
      label: STAGE_LABELS.RRR_PASS,
      count: rrrPass,
      droppedAtThisStep: rrrMisses,
      dropReason: 'RRR 최소값 미달',
    },
    {
      id: 'ENTRIES',
      label: STAGE_LABELS.ENTRIES,
      count: entries,
      droppedAtThisStep: Math.max(0, rrrPass - entries),
      dropReason: '진입 실패 (호가/사이즈/잔고)',
    },
  ];

  const conversionRate = candidates > 0 ? entries / candidates : 0;

  return {
    lastScanTime: summary.time ?? null,
    stages,
    totals: {
      universeSize: null,
      candidates,
      entries,
      conversionRate,
    },
  };
}

router.get('/pipeline-summary', (_req: Request, res: Response) => {
  try {
    const summary = getLastScanSummary();
    const result = buildPipelineSummary(summary);
    res.json(result);
  } catch (e) {
    console.error('[screenerPipelineRouter] /pipeline-summary 실패:', e);
    res.status(500).json({ error: 'pipeline_summary_failed' });
  }
});

export default router;
