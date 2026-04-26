/**
 * @responsibility 후보군 파이프라인 통계 fetch (ADR-0023 PR-F)
 */

export type PipelineStageId =
  | 'UNIVERSE'
  | 'CANDIDATES'
  | 'MOMENTUM_PASS'
  | 'GATE1_PASS'
  | 'RRR_PASS'
  | 'ENTRIES';

export interface ClientPipelineStage {
  id: PipelineStageId;
  label: string;
  count: number;
  droppedAtThisStep?: number;
  dropReason?: string;
}

export interface ClientPipelineSummary {
  lastScanTime: string | null;
  stages: ClientPipelineStage[];
  totals: {
    universeSize: number | null;
    candidates: number;
    entries: number;
    conversionRate: number;
  };
}

export async function fetchPipelineSummary(): Promise<ClientPipelineSummary> {
  const res = await fetch('/api/screener/pipeline-summary');
  if (!res.ok) {
    throw new Error(`fetch /api/screener/pipeline-summary failed: ${res.status}`);
  }
  return await res.json();
}

// ─── PR-J: 단계별 종목 드릴다운 ───────────────────────────────────────────

export type DrilldownStage =
  | 'CANDIDATES' | 'MOMENTUM_PASS' | 'GATE1_PASS' | 'RRR_PASS' | 'ENTRIES';

export interface ClientPipelineStockEntry {
  stock: string;
  name: string;
  outcome: 'PASSED' | 'DROPPED' | 'EXECUTED';
  dropReason?: string;
}

export interface PipelineStocksResponse {
  stage: DrilldownStage;
  passed: ClientPipelineStockEntry[];
  dropped: ClientPipelineStockEntry[];
  counts: { passed: number; dropped: number };
}

export async function fetchPipelineStocks(stage: DrilldownStage): Promise<PipelineStocksResponse> {
  const res = await fetch(`/api/screener/pipeline-stocks?stage=${encodeURIComponent(stage)}`);
  if (!res.ok) {
    throw new Error(`fetch /api/screener/pipeline-stocks failed: ${res.status}`);
  }
  return await res.json();
}
