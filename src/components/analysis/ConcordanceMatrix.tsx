// @responsibility Quant×Qual 5×5 합치도 매트릭스 — 정량 vs 정성 일치 시 승률 검증 (ADR-0054 PR-Z6)

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitMerge, Activity } from 'lucide-react';
import { Section } from '../../ui/section';
import { cn } from '../../ui/cn';
import {
  fetchAttributionConcordance,
  ALL_CONCORDANCE_TIERS,
  type ConcordanceCell,
  type ConcordanceMatrix as MatrixData,
  type ConcordanceTier,
} from '../../api/concordanceClient';

const TIER_LABEL: Record<ConcordanceTier, string> = {
  EXCELLENT: '우수',
  GOOD: '양호',
  NEUTRAL: '중립',
  WEAK: '약함',
  POOR: '미흡',
};

const TIER_SHORT: Record<ConcordanceTier, string> = {
  EXCELLENT: '8+',
  GOOD: '6+',
  NEUTRAL: '4+',
  WEAK: '2+',
  POOR: '<2',
};

const MIN_SIGNIFICANT_SAMPLES = 30;

function cellColor(cell: ConcordanceCell): string {
  if (cell.sampleCount === 0) return 'bg-zinc-800/30 text-zinc-600';
  const wr = cell.winRate ?? 0;
  if (wr >= 60) return 'bg-emerald-500/30 text-emerald-100';
  if (wr >= 40) return 'bg-amber-500/25 text-amber-100';
  return 'bg-red-500/25 text-red-100';
}

function fmtRate(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(0)}%`;
}

function fmtReturn(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function findCell(matrix: MatrixData, quant: ConcordanceTier, qual: ConcordanceTier): ConcordanceCell {
  const c = matrix.cells.find((c) => c.quantTier === quant && c.qualTier === qual);
  return c ?? {
    quantTier: quant,
    qualTier: qual,
    sampleCount: 0, wins: 0, losses: 0, winRate: null, avgReturnPct: null,
  };
}

function MetaRuleBox({ matrix }: { matrix: MatrixData }) {
  const d = matrix.diagonalStats;
  const o = matrix.offDiagonalStats;
  const insufficient = matrix.totalSamples < MIN_SIGNIFICANT_SAMPLES;

  if (insufficient) {
    return (
      <div className="rounded-lg bg-amber-500/10 border border-amber-400/30 px-3 py-2 text-xs text-amber-200">
        ⚠️ 표본 {matrix.totalSamples}건 (최소 {MIN_SIGNIFICANT_SAMPLES}건 필요) — 통계적 신뢰도 부족
      </div>
    );
  }

  const delta = (d.winRate ?? 0) - (o.winRate ?? 0);
  const tone =
    delta >= 10 ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-100' :
    delta >= 0  ? 'bg-amber-500/10 border-amber-400/30 text-amber-100' :
                  'bg-red-500/10 border-red-400/30 text-red-100';

  return (
    <div className={cn('rounded-lg border px-3 py-2 text-xs space-y-1', tone)} data-testid="concordance-meta-rule">
      <div className="font-semibold">메타 룰 검증 — 정량·정성 일치 시 승률</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">일치 (대각선)</div>
          <div className="text-sm font-mono">{fmtRate(d.winRate)} ({d.sampleCount}건)</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-70">불일치</div>
          <div className="text-sm font-mono">{fmtRate(o.winRate)} ({o.sampleCount}건)</div>
        </div>
      </div>
      <div className="text-[11px] mt-1 opacity-90">
        Δ {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%p
        {delta >= 10 ? ' — "두 시스템 일치 = 강한 신호" 가설 지지' :
         delta >= 0  ? ' — 약한 양성 (추가 표본 필요)' :
                       ' — 가설 반대 (재검토 필요)'}
      </div>
    </div>
  );
}

export function ConcordanceMatrix() {
  const { data, isLoading, isError } = useQuery<MatrixData>({
    queryKey: ['attribution-concordance'],
    queryFn: fetchAttributionConcordance,
    staleTime: 5 * 60_000,
    retry: 2,
  });

  if (isLoading && !data) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <Activity className="h-4 w-4 animate-pulse" />
          <span>합치도 매트릭스 로딩 중…</span>
        </div>
      </Section>
    );
  }

  if (isError || !data) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-zinc-400 text-sm">
          <Activity className="h-4 w-4" />
          <span>합치도 데이터를 불러올 수 없습니다 — 5분 뒤 자동 재시도.</span>
        </div>
      </Section>
    );
  }

  return (
    <Section>
      <div className="flex items-center gap-2 mb-3">
        <GitMerge className="h-4 w-4 text-zinc-400" />
        <span className="text-sm font-bold text-zinc-100">정량 × 정성 합치도 매트릭스</span>
        <span className="text-[10px] text-zinc-500">총 {data.totalSamples}건</span>
      </div>

      <div className="overflow-x-auto" data-testid="concordance-matrix">
        <table className="w-full min-w-[480px] border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="text-left text-zinc-500 font-semibold pb-1">
                정량(가로) ↓ / 정성(세로) →
              </th>
              {ALL_CONCORDANCE_TIERS.map((t) => (
                <th key={t} className="text-center text-zinc-400 font-medium pb-1">
                  <div>{TIER_LABEL[t]}</div>
                  <div className="text-[9px] text-zinc-500">{TIER_SHORT[t]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_CONCORDANCE_TIERS.map((quantTier) => (
              <tr key={quantTier}>
                <td className="text-zinc-400 font-medium pr-2">
                  {TIER_LABEL[quantTier]}
                  <div className="text-[9px] text-zinc-500">{TIER_SHORT[quantTier]}</div>
                </td>
                {ALL_CONCORDANCE_TIERS.map((qualTier) => {
                  const cell = findCell(data, quantTier, qualTier);
                  const isDiagonal = quantTier === qualTier;
                  return (
                    <td
                      key={qualTier}
                      className={cn(
                        'rounded-md text-center px-1.5 py-2',
                        cellColor(cell),
                        isDiagonal && cell.sampleCount > 0 && 'ring-2 ring-violet-400/60',
                      )}
                      data-testid={`concordance-cell-${quantTier}-${qualTier}`}
                      data-tier={`${quantTier}|${qualTier}`}
                      data-sample={cell.sampleCount}
                      title={`${cell.sampleCount}건 (승 ${cell.wins} / 패 ${cell.losses}) · 평균 ${fmtReturn(cell.avgReturnPct)}`}
                    >
                      <div className="text-sm font-mono font-semibold">
                        {fmtRate(cell.winRate)}
                      </div>
                      <div className="text-[10px] opacity-80">
                        {cell.sampleCount > 0 ? `n=${cell.sampleCount}` : '—'}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <MetaRuleBox matrix={data} />
      </div>

      <div className="mt-2 text-[10px] text-zinc-500">
        가로축 = 정량 9 조건 (실계산) 평균 · 세로축 = 정성 18 조건 (AI 추정) 평균 · 보라색 ring = 두 시스템 일치
      </div>
    </Section>
  );
}
