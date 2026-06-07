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
    'border-white/[0.07] bg-white/5 text-white/70';
  return (
    <div className={cn('rounded-2xl border p-4 min-w-0', toneClass)} title={tooltip}>
      <div className="text-[10px] font-semibold tracking-tight opacity-70">{label}</div>
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
  // 최종 점수 = 검증 가중(weightedScore) — 후보 카드와 동일 정본 값. 합치도(concordance)도
  // 정본에서 AI vs 최종(가중) 비교로 통일돼, 후보 카드 배지와 동일 판정을 보인다.
  const { aiScore, weightedScore, verifiedPassCount, evaluableCount, intrinsicAiCount, concordance } = buildStockAnalysisCanon(stock);

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
          value={weightedScore}
          scale="0~100"
          tone="blue"
          tooltip={`검증 가능 항목 중 검증된 비율 (검증=1·AI추정=0.5·미달=0) ÷ ${evaluableCount}. 정성-AI ${intrinsicAiCount}개는 분모 제외 — 후보 카드와 동일 값`}
        />
        <ScoreCard
          label="체크리스트"
          value={`${verifiedPassCount}/${evaluableCount}`}
          scale="검증/검증가능"
          tone="gray"
          tooltip={`정성-AI ${intrinsicAiCount}개 별도(점수 분모 제외)`}
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
            AI: {concordance.aiScore} / 최종: {concordance.quantScore} · 격차 {concordance.gap}점
            {concordance.gap >= 25 ? ' — Gemini 과대평가 가능 (검증 부족)' : ' — 정성/검증 방향성 확인'}
          </div>
        </div>
      )}
    </div>
  );
}
