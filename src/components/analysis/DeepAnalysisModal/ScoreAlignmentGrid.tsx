// @responsibility Score concordance grid rendering for deep analysis modal.
import React from 'react';
import { cn } from '../../../ui/cn';
import type { StockRecommendation } from '../../../services/stockService';
import { buildStockAnalysisCanon } from '../../../services/stock/stockAnalysisCanon';

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
  // 분석 표시 정본(SSOT) — quantScore/concordance 가 절대 null 이 아니다(게이트 미산출 시
  // 신뢰도→AI fallback). 검색 종목처럼 gateEvaluation 이 없을 때 Gate 가 '-' 로 비고
  // concordance 블록이 통째로 숨겨지던 "final score 표시 안됨" 문제를 제거한다.
  const { aiScore, quantScore, concordance, verifiedPassCount, metCount } = buildStockAnalysisCanon(stock);

  return (
    <div className="mb-8 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <ScoreCard
          label="AI 점수"
          value={aiScore}
          scale="0~100"
          tone="orange"
          tooltip="Gemini 정성 평가"
        />
        <ScoreCard
          label="최종 점수"
          value={quantScore}
          scale="0~100"
          tone="blue"
          tooltip="27조건 가중합 정규화 (게이트 미산출 시 신뢰도·AI 대체)"
        />
        <ScoreCard
          label="체크리스트"
          value={`${verifiedPassCount}/${metCount}`}
          scale="검증/충족"
          tone="gray"
        />
      </div>
      {concordance && (
        <div className={cn(
          'rounded-2xl border px-4 py-3 text-xs',
          concordance.tier === 'EXCELLENT' || concordance.tier === 'GOOD'
            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
            : concordance.tier === 'NEUTRAL'
              ? 'border-amber-500/25 bg-amber-500/10 text-amber-200'
              : 'border-red-500/25 bg-red-500/10 text-red-200',
        )}>
          <div className="font-black">
            AI 점수 {concordance.aiScore} [{concordance.tier === 'WEAK' || concordance.tier === 'POOR' ? '⚠ ' : ''}{concordance.label}]
          </div>
          <div className="mt-1 text-[11px] opacity-85">
            AI: {concordance.aiScore} / 정량: {concordance.quantScore} · 격차 {concordance.gap}점
            {concordance.gap >= 25 ? ' — Gemini 과대평가 가능' : ' — 정성/정량 방향성 확인'}
          </div>
        </div>
      )}
    </div>
  );
}
