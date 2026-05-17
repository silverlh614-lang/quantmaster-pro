// @responsibility Score concordance grid rendering for deep analysis modal.
import React from 'react';
import { cn } from '../../../ui/cn';
import type { StockRecommendation } from '../../../services/stockService';
import {
  classifyScoreConcordance,
  getQuantGateScore,
} from '../../../utils/recommendationScore';
import { getPassedConditionCount } from './MasterRadarChart';

interface Props {
  stock: StockRecommendation;
}

interface ScoreCardProps {
  label: string;
  value: string | number;
  scale: string;
  tone: 'orange' | 'blue' | 'gray';
  tooltip?: string;
}

function ScoreCard({ label, value, scale, tone, tooltip }: ScoreCardProps) {
  const toneClass =
    tone === 'orange' ? 'border-orange-500/20 bg-orange-500/10 text-orange-300' :
    tone === 'blue' ? 'border-blue-500/20 bg-blue-500/10 text-blue-300' :
    'border-white/10 bg-white/5 text-white/70';
  return (
    <div className={cn('rounded-2xl border p-4 min-w-0', toneClass)} title={tooltip}>
      <div className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-black tracking-tighter font-num">{value}</span>
        <span className="text-[10px] font-bold opacity-60">{scale}</span>
      </div>
      {tooltip && <div className="mt-1 text-[10px] opacity-60">{tooltip}</div>}
    </div>
  );
}

export function ScoreAlignmentGrid({ stock }: Props) {
  const aiScore = stock.aiConvictionScore?.totalScore ?? 0;
  const quant = getQuantGateScore(stock);
  const concordance = quant ? classifyScoreConcordance(aiScore, quant.normalized) : null;
  const checkedCount = getPassedConditionCount(stock);

  return (
    <div className="mb-8 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <ScoreCard
          label="AI Score"
          value={aiScore}
          scale="0~100"
          tone="orange"
          tooltip="Gemini 정성 평가"
        />
        <ScoreCard
          label="Gate"
          value={quant ? quant.normalized : '-'}
          scale="0~100"
          tone="blue"
          tooltip="27조건 가중합 정규화"
        />
        <ScoreCard
          label="Checklist"
          value={checkedCount}
          scale="/27"
          tone="gray"
        />
      </div>
      {quant && concordance && (
        <div className={cn(
          'rounded-2xl border px-4 py-3 text-xs',
          concordance.tier === 'EXCELLENT' || concordance.tier === 'GOOD'
            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
            : concordance.tier === 'NEUTRAL'
              ? 'border-amber-500/25 bg-amber-500/10 text-amber-200'
              : 'border-red-500/25 bg-red-500/10 text-red-200',
        )}>
          <div className="font-black">
            AI Score {concordance.aiScore} [{concordance.tier === 'WEAK' || concordance.tier === 'POOR' ? '⚠ ' : ''}{concordance.label}]
          </div>
          <div className="mt-1 text-[11px] opacity-85">
            AI: {concordance.aiScore} / Quant: {concordance.quantScore} · 격차 {concordance.gap}점
            {concordance.gap >= 25 ? ' — Gemini 과대평가 가능' : ' — 정성/정량 방향성 확인'}
          </div>
        </div>
      )}
    </div>
  );
}
