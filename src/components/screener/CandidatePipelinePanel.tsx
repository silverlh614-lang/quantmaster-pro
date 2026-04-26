// @responsibility 후보군 파이프라인 5단계 funnel 시각화 (ADR-0023 PR-F)

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, ChevronDown, ChevronUp, ArrowDown } from 'lucide-react';
import { cn } from '../../ui/cn';
import {
  fetchPipelineSummary,
  type ClientPipelineStage,
  type PipelineStageId,
} from '../../api/screenerPipelineClient';

const STAGE_TONE: Record<PipelineStageId, string> = {
  UNIVERSE:      'bg-white/5     border-white/10  text-white/70',
  CANDIDATES:    'bg-blue-500/15 border-blue-500/30 text-blue-200',
  MOMENTUM_PASS: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-200',
  GATE1_PASS:    'bg-amber-500/15 border-amber-500/30 text-amber-200',
  RRR_PASS:      'bg-orange-500/15 border-orange-500/30 text-orange-200',
  ENTRIES:       'bg-green-500/20 border-green-500/40 text-green-200',
};

function StageRow({ stage }: { stage: ClientPipelineStage }) {
  const isUniverse = stage.id === 'UNIVERSE';
  const showDropped = stage.droppedAtThisStep != null && stage.droppedAtThisStep > 0;
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        'flex-1 rounded border px-3 py-2 flex items-center justify-between',
        STAGE_TONE[stage.id],
      )}>
        <span className="text-[11px] font-bold uppercase tracking-wider opacity-80">
          {stage.label}
        </span>
        <span className="text-base sm:text-lg font-black font-num">
          {isUniverse && stage.count === 0 ? '—' : stage.count.toLocaleString('ko-KR')}
        </span>
      </div>
      {showDropped && (
        <div className="hidden sm:flex items-center gap-1 text-[10px] text-white/50 w-32 shrink-0">
          <ArrowDown className="w-3 h-3" />
          <span className="font-bold">−{stage.droppedAtThisStep}</span>
          <span className="opacity-70 truncate" title={stage.dropReason}>
            {stage.dropReason}
          </span>
        </div>
      )}
    </div>
  );
}

interface CandidatePipelinePanelProps {
  className?: string;
}

/**
 * 후보군 파이프라인 5단계 funnel.
 * - GET /api/screener/pipeline-summary 60초 staleTime + retry 2.
 * - 데이터 부재(스캔 미실행) 시 placeholder.
 * - 펼치기 토글로 stage detail.
 */
export function CandidatePipelinePanel({ className }: CandidatePipelinePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['screener', 'pipeline-summary'],
    queryFn: fetchPipelineSummary,
    staleTime: 60_000,
    retry: 2,
  });

  return (
    <div
      className={cn('rounded border border-white/10 bg-black/20 p-3 sm:p-4', className)}
      role="region"
      aria-label="후보군 파이프라인"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-black uppercase tracking-widest opacity-70 flex items-center gap-1.5">
          <Filter className="w-3 h-3" /> 후보군 파이프라인
        </span>
        <div className="flex items-center gap-2">
          {data?.lastScanTime && (
            <span className="text-[10px] text-white/50 font-num hidden sm:inline">
              마지막 스캔 {data.lastScanTime}
            </span>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-white/80 transition-opacity"
            aria-label="새로고침"
          >
            {isFetching ? '…' : '↻'}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-white/40 hover:text-white/80 transition-opacity"
            aria-expanded={expanded}
            aria-label={expanded ? '접기' : '펼치기'}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-xs text-white/50">로드 중…</div>
      ) : isError ? (
        <div className="text-xs text-red-300 rounded border border-red-500/30 bg-red-950/30 p-2">
          파이프라인 통계 로드 실패
        </div>
      ) : !data ? (
        <div className="text-xs text-white/50">통계 데이터 없음</div>
      ) : (
        <>
          {/* 항상 표시 — Top + Bottom 만 컴팩트 */}
          <div className="space-y-1.5">
            {/* CANDIDATES (시작점) */}
            <StageRow stage={data.stages.find(s => s.id === 'CANDIDATES')!} />
            {/* ENTRIES (최종) */}
            <StageRow stage={data.stages.find(s => s.id === 'ENTRIES')!} />
          </div>

          {/* 변환률 */}
          <div className="mt-2 flex items-center justify-between text-[10px] text-white/60">
            <span>변환률 (entries / candidates)</span>
            <span className="font-black font-num text-white/90">
              {(data.totals.conversionRate * 100).toFixed(1)}%
            </span>
          </div>

          {/* 펼치기 — 전 단계 */}
          {expanded && (
            <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5">
              {data.stages.map(stage => (
                <StageRow key={stage.id} stage={stage} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
